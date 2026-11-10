#!/usr/bin/env python3
"""Invoke Compose with protected files authoritative over ambient shell values.

No dotenv expression is evaluated. No secret appears in argv or generated output.
The service environment remains the explicit allowlist in docker-compose.yml.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


EXISTING_SERVICES = ('app', 'worker', 'proxy', 'mailserver', 'clamav')
EXISTING_LIST_FORMAT = ('{"id":{{json .ID}},'
                        '"service":{{json (.Label "com.docker.compose.service")}}}')


def environment(root, filename, inherited):
    spec = importlib.util.spec_from_file_location('idealmakoo_env', Path(__file__).with_name('env-file.py'))
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    values = reader.read(filename)
    values.update(reader.health_budgets(values))
    values.update(reader.runtime_proxy(values))
    values['MAIL_SERVER_MODE'] = reader.mail_mode(values)
    profiles = [p for p in values.get('COMPOSE_PROFILES', '').split(',') if p and p != 'mail']
    if values.get('MAIL_SERVER_MODE') == 'local': profiles.append('mail')
    values['COMPOSE_PROFILES'] = ','.join(profiles)
    values['MAIL_DATA_DIR'] = values.get('MAIL_DATA_DIR') or str(Path(values.get('INSTALL_ROOT', '/var/www/idealmakoo')) / 'mail-server')
    release = Path(root) / '.release.env'
    if release.is_file():
        metadata = reader.read(release)
        if not set(metadata) <= {'APP_IMAGE', 'PROXY_IMAGE', 'CLAMAV_RUNTIME_IMAGE', 'RELEASE_SHA'}:
            raise ValueError('Unexpected key in release image metadata')
        values.update(metadata)
    override = inherited.get('IDEALMAKOO_COMPOSE_OVERRIDE', '')
    files = [Path(root) / 'docker-compose.yml']
    if override:
        files.append(Path(override))
    controlled = set(values)
    for file in files:
        controlled.update(re.findall(r'\$\{([A-Z][A-Z0-9_]*)', file.read_text()))
    env = {key: value for key, value in inherited.items()
           if key not in controlled and not key.startswith('COMPOSE_')}
    env.update(values)
    # Backup may need the image observed from the deployed container, independent
    # of the release directory from which the operator invoked it.
    for name in ('APP_IMAGE', 'PROXY_IMAGE'):
        image = inherited.get('IDEALMAKOO_OBSERVED_' + name, '')
        if image:
            if not re.fullmatch(r'[a-zA-Z0-9._:/@-]{1,255}', image):
                raise ValueError('Invalid observed runtime image')
            env[name] = image
    env['COMPOSE_DISABLE_ENV_FILE'] = 'true'
    env['COMPOSE_MENU'] = 'false'
    return env


def existing_list_arguments(arguments):
    """Recognize only the fixed deployment inventory used by our lifecycle."""
    if not arguments or arguments[0] != 'list-existing':
        return None
    services = arguments[1:]
    if (not services or len(services) > len(EXISTING_SERVICES)
            or len(set(services)) != len(services)
            or any(service not in EXISTING_SERVICES for service in services)):
        raise ValueError('Select unique supported deployed services for existing-container discovery')
    return tuple(services)


def list_existing(env, services):
    """Stream fixed-project identities without Compose's redundant inspections.

    This internal operation is not a general Compose ps replacement. The
    lifecycle filters multi-service membership and still strictly inspects all
    selected identities and states. Keep one-offs and duplicates observable.
    """
    project = env.get('COMPOSE_PROJECT_NAME', 'idealmakoo')
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', project):
        raise ValueError('Invalid existing-container project name')
    command = ['docker', 'container', 'ls', '--all', '--no-trunc',
               '--filter', 'label=com.docker.compose.project=' + project,
               '--filter', 'label=com.docker.compose.config-hash']
    if len(services) == 1:
        command += ['--filter', 'label=com.docker.compose.service=' + services[0]]
    command += ['--format', EXISTING_LIST_FORMAT]
    # Replace this process so the lifecycle's existing process-group deadline,
    # output limit and termination checks apply directly to the Docker client.
    # Use exactly the protected effective environment, never raw ambient env.
    os.execvpe('docker', command, env)


def existing_run_arguments(arguments):
    """Recognize our explicit one-off operation, never a container's arguments."""
    index = 0
    profiles = []
    while index < len(arguments):
        if arguments[index] == '--profile':
            if index + 1 >= len(arguments):
                return None
            profiles.extend(arguments[index:index + 2])
            index += 2
        elif arguments[index].startswith('--profile='):
            profiles.append(arguments[index])
            index += 1
        else:
            break
    if index >= len(arguments) or arguments[index] != 'run-existing':
        return None

    # These are the operational options actually needed by backup, restore,
    # provisioning and their documented one-off commands. Do not accept options
    # which can build/pull images, start dependencies or detach the operation.
    values = {'-e', '--env', '--entrypoint', '-v', '--volume', '-u', '--user', '-w', '--workdir'}
    flags = {'--rm', '--no-deps', '-T', '--no-tty'}
    selected = []
    index += 1
    while index < len(arguments) and arguments[index].startswith('-'):
        option = arguments[index]
        if option in flags:
            # The final command supplies these invariants exactly once.
            index += 1
        elif option == '--pull':
            if index + 1 >= len(arguments) or arguments[index + 1] != 'never':
                raise ValueError('Existing-image operations only permit --pull never')
            index += 2
        elif option == '--pull=never':
            index += 1
        elif option in values:
            if index + 1 >= len(arguments):
                raise ValueError('An existing-image operation option is missing its value')
            selected.extend(arguments[index:index + 2])
            index += 2
        elif option.partition('=')[0] in values and '=' in option:
            selected.append(option)
            index += 1
        else:
            raise ValueError('Unsupported option before the existing-image service')
    if index >= len(arguments) or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}', arguments[index]):
        raise ValueError('Select one existing-image service')
    service = arguments[index]
    # Everything after SERVICE belongs to its command. Flags there must remain
    # byte-for-byte arguments, even if they look like Compose options.
    return profiles, service, [*selected, *arguments[index:]]


def existing_image_model(model, service, image_id):
    if (not isinstance(model, dict) or not isinstance(model.get('services'), dict)
            or service not in model['services']
            or not isinstance(model.get('name'), str)
            or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,62}', model['name'])
            or not re.fullmatch(r'sha256:[a-f0-9]{64}', image_id)):
        raise ValueError('Compose returned an invalid existing-image model')
    for definition in model['services'].values():
        if not isinstance(definition, dict):
            raise ValueError('Compose returned an invalid existing-image service')
        definition.pop('build', None)
        definition['pull_policy'] = 'never'
    model['services'][service]['image'] = image_id
    return model


def run_existing(root, filename, command, env, selection):
    """Use a private rendered model with no build definitions or image pulls.

    `compose run` has no --no-build option. Checking an image then merely dropping
    that invalid flag is insufficient: services inheriting `build` can otherwise
    compile a missing image. Pin the inspected local image and remove all build
    entries, so a subsequent image removal fails without a build or a pull.
    """
    profiles, service, arguments = selection
    try:
        resolved = subprocess.run([*command, *profiles, 'config', '--format', 'json'],
                                  cwd=root, env=env, stdin=subprocess.DEVNULL,
                                  capture_output=True, check=False, timeout=60)
    except subprocess.TimeoutExpired:
        raise ValueError('Existing-image configuration exceeded its time limit') from None
    if resolved.returncode or len(resolved.stdout) > 16 * 1024 * 1024:
        raise ValueError('Unable to resolve the private existing-image configuration')
    try:
        model = json.loads(resolved.stdout)
        image = model['services'][service]['image']
    except (ValueError, UnicodeDecodeError, KeyError, TypeError):
        raise ValueError('The selected existing-image service is unavailable') from None
    if not isinstance(image, str) or not re.fullmatch(r'[a-zA-Z0-9._:/@-]{1,255}', image):
        raise ValueError('The selected existing-image reference is invalid')
    try:
        inspected = subprocess.run(['docker', 'image', 'inspect', '--format', '{{.Id}}', image],
                                   cwd=root, env=env, stdin=subprocess.DEVNULL,
                                   capture_output=True, check=False, timeout=30)
    except subprocess.TimeoutExpired:
        raise ValueError('Existing-image inspection exceeded its time limit') from None
    if inspected.returncode:
        raise ValueError('The selected one-off image is unavailable locally; build or recover the release first')
    try:
        image_id = inspected.stdout.decode('ascii').strip()
    except UnicodeDecodeError:
        raise ValueError('Docker returned an invalid local image identity') from None
    model = existing_image_model(model, service, image_id)

    # `config --format json` already escapes literal dollars for a reusable
    # Compose document. Preserve those strings exactly; escaping again would
    # alter passwords/provider configuration on the second Compose load.
    # Config/image observations must not consume the caller's tar/JSON stdin.
    # Use a file, never `-f -`, so the actual one-off retains that same pipe.
    with tempfile.TemporaryDirectory(prefix='.compose-run-', dir=Path(filename).parent) as directory:
        os.chmod(directory, 0o700)
        private = Path(directory) / 'compose.json'
        descriptor = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            json.dump(model, output, separators=(',', ':'))
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        actual = ['docker', 'compose', '--env-file', '/dev/null', '--project-directory', root,
                  '--project-name', model['name'], '-f', str(private), *profiles,
                  'run', '--rm', '--no-deps', '--pull', 'never', '-T', *arguments]
        # Inherit stdin/stdout/stderr and preserve the exact child exit status,
        # including restore-security's documented owner-recovery status 2.
        return subprocess.run(actual, cwd=root, env=env, check=False).returncode


def main():
    root, filename, *arguments = sys.argv[1:]
    env = environment(root, filename, dict(os.environ))
    inventory = existing_list_arguments(arguments)
    if inventory is not None:
        return list_existing(env, inventory)
    command = ['docker', 'compose', '--env-file', '/dev/null', '--project-directory', root,
               '-f', str(Path(root) / 'docker-compose.yml')]
    override = os.environ.get('IDEALMAKOO_COMPOSE_OVERRIDE')
    if override:
        command += ['-f', override]
    selection = existing_run_arguments(arguments)
    if selection is not None:
        raise SystemExit(run_existing(root, filename, command, env, selection))
    result = subprocess.run([*command, *arguments], env=env, check=False)
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        # Never include arbitrary driver output or dotenv values in errors.
        if isinstance(error, ValueError):
            raise SystemExit('Compose configuration failed: ' + str(error)) from None
        raise SystemExit('Compose execution failed; check Docker access and the protected configuration paths') from None
