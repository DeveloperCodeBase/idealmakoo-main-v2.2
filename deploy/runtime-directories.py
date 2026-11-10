#!/usr/bin/env python3
"""Prepare only this installation's explicit bind mounts; never follow a symlink."""
import importlib.util
import os
import stat
import sys
import tempfile
from pathlib import Path


def exact_directory(value):
    path = Path(value)
    if not path.is_absolute() or path.resolve() != path or len(path.parts) < 4:
        raise ValueError('Use a dedicated absolute directory without symlinks')
    return path


def prepare(path, owner, group, mode):
    if path.exists():
        current = path.stat()
        if not path.is_dir() or current.st_uid != owner or current.st_gid != group or stat.S_IMODE(current.st_mode) != mode:
            raise ValueError('Existing runtime directory has unexpected ownership or mode; review it explicitly: ' + str(path))
    else:
        path.mkdir(parents=True, mode=mode)
        os.chown(path, owner, group)
        path.chmod(mode)


def main(environment, app_directory, worker=None):
    spec = importlib.util.spec_from_file_location('idealmakoo_env', Path(__file__).with_name('env-file.py'))
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    values = reader.read(environment)
    ledger = exact_directory(values.get('PRIVACY_LEDGER_HOST_DIR', ''))
    integrations = exact_directory(values.get('INTEGRATIONS_HOST_DIR', ''))
    app = Path(app_directory).resolve()
    for forbidden in (app / 'shared', app / 'releases', integrations):
        if ledger == forbidden or forbidden in ledger.parents or ledger in forbidden.parents:
            raise ValueError('Keep the privacy ledger separate from release, ordinary backup and integration directories')
    prepare(ledger, 10001, 10001, 0o700)
    prepare(integrations, 0, 10001, 0o750)
    if worker is not None:
        source = Path(worker)
        if not source.is_absolute() or source.name != 'najva-messaging-sw.js' or source.is_symlink() or not source.is_file():
            raise ValueError('Supply the absolute regular najva-messaging-sw.js downloaded from the operator panel')
        if not 20 <= source.stat().st_size <= 256 * 1024:
            raise ValueError('The supplied Najva worker must contain 20 bytes through 256 KiB')
        content = source.read_bytes()
        if '\x00' in content.decode('utf8'):
            raise ValueError('The supplied worker must be a UTF-8 JavaScript file')
        target = integrations / 'najva-messaging-sw.js'
        if target.is_symlink():
            raise ValueError('The managed worker destination cannot be a symlink')
        with tempfile.NamedTemporaryFile(dir=integrations, delete=False) as file:
            os.fchmod(file.fileno(), 0o640)
            os.fchown(file.fileno(), 0, 10001)
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
            temporary = file.name
        os.replace(temporary, target)
        descriptor = os.open(integrations, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        reader.write_changes(environment, {'NAJVA_WORKER_FILE': '/app/integrations/najva-messaging-sw.js'})
    print('Protected privacy ledger and read-only integration mounts are ready.')


if __name__ == '__main__':
    if len(sys.argv) not in (3, 4):
        raise SystemExit('Usage: runtime-directories.py environment app-directory [absolute Najva worker]')
    try:
        main(*sys.argv[1:])
    except (ValueError, OSError) as error:
        raise SystemExit('Runtime directory validation failed: ' + str(error)) from None
