#!/usr/bin/env python3
"""Restore authenticated disaster-recovery files into fresh managed bind mounts."""
import importlib.util
import os
from pathlib import Path
import stat
import sys
import tempfile


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def owned_tree(directory, owner, group, file_mode):
    for path in [directory, *directory.rglob('*')]:
        info = path.lstat()
        if path.is_symlink() or not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise ValueError('Recovered host files cannot contain links or special files')
        os.chown(path, owner, group)
        path.chmod(0o700 if path.is_dir() and owner == 10001 else 0o750 if path.is_dir() else file_mode)


def main(payload, environment, latest_ledger=''):
    archive = module('idealmakoo_archive', 'backup-archive.py')
    values = module('idealmakoo_env', 'env-file.py').read(environment)
    ledger = Path(values['PRIVACY_LEDGER_HOST_DIR'])
    integrations = Path(values['INTEGRATIONS_HOST_DIR'])
    for path in (ledger, integrations):
        if not path.is_absolute() or path.is_symlink() or path.resolve() != path or not path.is_dir():
            raise ValueError('Runtime bind mounts must already be prepared real directories')
    if any(integrations.iterdir()):
        raise ValueError('Fresh-host recovery refuses to overwrite integration files')
    current_ledger = any(ledger.iterdir())
    if current_ledger and latest_ledger:
        raise ValueError('A current ledger already exists; it will not be overwritten by a supplied copy')
    archive.extract_storage(Path(payload) / 'integrations.tar', integrations)
    owned_tree(integrations, 0, 10001, 0o640)
    if current_ledger:
        print('The existing independent privacy ledger was preserved; its anchor must validate before any restored writer starts.')
        return
    if latest_ledger:
        source = Path(latest_ledger)
        with tempfile.TemporaryDirectory(prefix='idealmakoo-latest-ledger-') as work:
            transfer = Path(work) / 'ledger.tar'
            archive.pack_tree(source, transfer, 'ledger')
            archive.validate_storage(transfer, 34 * 1024 ** 2, ['identity.json', 'erasures.jsonl'])
            archive.extract_storage(transfer, ledger)
    else:
        archive.extract_storage(Path(payload) / 'privacy-ledger.tar', ledger)
    owned_tree(ledger, 10001, 10001, 0o600)
    print('Privacy files restored only into an empty new-host ledger directory; signatures and the required anchor must validate before startup.')


if __name__ == '__main__':
    try:
        if len(sys.argv) not in (3, 4):
            raise ValueError('Usage: restore-host-files.py verified-payload environment [latest-independent-ledger]')
        main(*sys.argv[1:])
    except (ValueError, OSError) as error:
        if isinstance(error, ValueError):
            raise SystemExit('Recovery host files failed: ' + str(error)) from None
        raise SystemExit('Recovery host files failed; check the protected paths and ownership') from None
