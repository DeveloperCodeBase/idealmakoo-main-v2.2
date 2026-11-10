#!/usr/bin/env python3
"""Build reviewed release images, granting only an explicitly selected CA file.

Recent Compose delegates builds to Bake but does not expose Bake's --allow flag.
An external BuildKit secret therefore needs a private Compose-generated plan and
an explicit file-read entitlement. No filesystem check or TLS check is disabled.
"""
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
from urllib.parse import urlsplit


def reviewed_registry(value):
    try:
        parsed = urlsplit(value)
        if (len(value) > 2048 or any(ord(c) < 33 or ord(c) > 126 for c in value)
                or parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.query or parsed.fragment or (parsed.port is not None and not 1 <= parsed.port <= 65535)):
            raise ValueError()
    except (ValueError, TypeError):
        raise ValueError('BUILD_NPM_REGISTRY must be a credential-free HTTPS registry URL') from None
    return value


def reviewed_ca(value):
    path = Path(value)
    if not path.is_absolute() or path.resolve() != path or path.is_symlink():
        raise ValueError('Build CA must be an absolute regular file without symlink traversal')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or not 1 <= metadata.st_size <= 1024 * 1024:
            raise ValueError('Build CA must be a regular PEM certificate file of at most 1 MiB')
        contents = os.read(descriptor, 1024 * 1024 + 1)
    finally:
        os.close(descriptor)
    if b'-----BEGIN CERTIFICATE-----' not in contents or b'PRIVATE KEY-----' in contents:
        raise ValueError('Build CA must contain public PEM certificates, never a private key')
    return str(path)


def main():
    root, filename, *services = sys.argv[1:]
    if not services or not set(services) <= {'app', 'proxy', 'clamav'} or len(set(services)) != len(services):
        raise ValueError('Select distinct release services: app, proxy, clamav')
    spec = importlib.util.spec_from_file_location('idealmakoo_compose_build', Path(__file__).with_name('compose.py'))
    compose = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(compose)
    environment = compose.environment(root, filename, dict(os.environ))
    environment['BUILD_NPM_REGISTRY'] = reviewed_registry(environment.get('BUILD_NPM_REGISTRY') or 'https://registry.npmjs.org')
    environment['BUILDX_BAKE_ENTITLEMENTS_FS'] = '1'
    mode = environment.get('INSTALL_NETWORK_MODE', 'online')
    if mode not in ('online', 'local-images'):
        raise ValueError('INSTALL_NETWORK_MODE must be online or local-images')
    pulls = ['--pull'] if mode == 'online' else []
    if mode == 'local-images':
        for key, fallback in [('NODE_IMAGE', 'node:24-bookworm-slim'), ('CADDY_IMAGE', 'caddy:2-alpine'), *([('CLAMAV_IMAGE', 'clamav/clamav:stable_base')] if 'clamav' in services else [])]:
            image = environment.get(key) or fallback
            if subprocess.run(['docker', 'image', 'inspect', image], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30).returncode:
                raise ValueError('A required reviewed base image is not loaded locally')
    command = ['docker', 'compose', '--env-file', '/dev/null', '--project-directory', root,
               '-f', str(Path(root) / 'docker-compose.yml')]
    override = os.environ.get('IDEALMAKOO_COMPOSE_OVERRIDE')
    if override:
        command += ['-f', override]
    certificate = environment.get('BUILD_CA_CERT_FILE', '')
    if not certificate:
        raise SystemExit(subprocess.run([*command, 'build', *pulls, *services],
                                        cwd=root, env=environment, check=False).returncode)
    certificate = reviewed_ca(certificate)
    # Capture instead of logging a reusable build plan. Build arguments and
    # secret paths are not emitted by this helper on validation failure.
    result = subprocess.run([*command, 'build', '--print', *pulls, *services],
                            cwd=root, env=environment, capture_output=True, check=False)
    if result.returncode:
        raise ValueError('The selected build CA requires Compose build --print support; update the official Compose plugin')
    try:
        plan = json.loads(result.stdout)
    except (ValueError, UnicodeDecodeError):
        raise ValueError('Compose returned an invalid private build plan') from None
    if not isinstance(plan, dict) or not isinstance(plan.get('target'), dict) or not set(services) <= set(plan['target']):
        raise ValueError('Compose build plan does not contain the selected release services')
    # Read permission is limited to the already reviewed CA. Other unexpected
    # external contexts/secrets continue to fail Bake's entitlement checks.
    raise SystemExit(subprocess.run(['docker', 'buildx', 'bake', '--file', '-', '--load', *pulls,
                                     '--allow', 'fs.read=' + certificate, *services],
                                    input=result.stdout, cwd=root, env=environment, check=False).returncode)


if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        raise SystemExit('Image build configuration failed: ' + str(error)) from None
    except OSError:
        raise SystemExit('Image build execution failed; check Docker access and the reviewed CA path') from None
