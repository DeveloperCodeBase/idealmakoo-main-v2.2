"""Exercise actual host-file extraction and refusal to roll back a current ledger.

The cryptographic chain is checked by the owner CLI integration tests and the
container restore drill. These fixtures isolate byte/permission preservation.
"""
import contextlib
import errno
import importlib.util
import io
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('host_recovery', ROOT / 'deploy/restore-host-files.py')
host = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(host)


class HostRecoveryTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-host-recovery-test-')
        self.addCleanup(temporary.cleanup)
        self.work = Path(temporary.name)
        self.payload = self.work / 'payload'
        self.payload.mkdir()
        self.ledger = self.work / 'current-ledger'
        self.ledger.mkdir(mode=0o700)
        self.integrations = self.work / 'integrations'
        self.integrations.mkdir(mode=0o750)
        self.env = self.work / 'protected.env'
        self.env.write_text(f'PRIVACY_LEDGER_HOST_DIR={self.ledger}\nINTEGRATIONS_HOST_DIR={self.integrations}\n')
        self.env.chmod(0o600)
        self.real_ownership = False
        probe = self.work / 'ownership-probe'
        probe.touch()
        try:
            os.chown(probe, 10001, 10001)
            os.chown(probe, os.getuid(), os.getgid())
            self.real_ownership = True
        except OSError as error:
            # User namespaces may expose uid0 with only one mapped UID/GID.
            if error.errno not in (errno.EPERM, errno.EINVAL):
                raise
        finally:
            probe.unlink()
        self.tar('integrations.tar', {'worker.js': b'/* exact integration bytes */'})
        self.tar('privacy-ledger.tar', {'identity.json': b'archived identity fixture\n',
                                        'erasures.jsonl': b'archived sequence fixture\n'})

    def tar(self, name, members):
        with tarfile.open(self.payload / name, 'w:') as output:
            for filename, content in members.items():
                member = tarfile.TarInfo(filename)
                member.size = len(content)
                output.addfile(member, io.BytesIO(content))

    def restore(self, latest=''):
        # Unprivileged CI can verify all real file operations and requested
        # ownership. Root acceptance runs also check actual UID/GID changes.
        ownership = contextlib.nullcontext() if self.real_ownership else mock.patch.object(host.os, 'chown')
        with ownership, contextlib.redirect_stdout(io.StringIO()):
            host.main(str(self.payload), str(self.env), latest)

    def test_empty_host_restores_exact_files_with_private_modes(self):
        self.restore()
        self.assertEqual((self.integrations / 'worker.js').read_bytes(), b'/* exact integration bytes */')
        self.assertEqual((self.ledger / 'identity.json').read_bytes(), b'archived identity fixture\n')
        self.assertEqual((self.ledger / 'erasures.jsonl').read_bytes(), b'archived sequence fixture\n')
        self.assertEqual((self.ledger / 'identity.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.ledger.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.integrations / 'worker.js').stat().st_mode & 0o777, 0o640)
        if self.real_ownership:
            self.assertEqual((self.ledger / 'identity.json').stat().st_uid, 10001)
            self.assertEqual((self.integrations / 'worker.js').stat().st_gid, 10001)

    def test_current_ledger_bytes_are_never_replaced_by_archive(self):
        current = {'identity.json': b'independent current identity\n',
                   'erasures.jsonl': b'newer erasures must survive rollback\n'}
        for name, content in current.items():
            (self.ledger / name).write_bytes(content)
        self.restore()
        self.assertEqual({name: (self.ledger / name).read_bytes() for name in current}, current)
        self.assertEqual((self.integrations / 'worker.js').read_bytes(), b'/* exact integration bytes */')

    def test_explicit_latest_ledger_applies_only_to_empty_host(self):
        latest = self.work / 'independently-kept-latest'
        latest.mkdir()
        (latest / 'identity.json').write_bytes(b'same latest identity fixture\n')
        (latest / 'erasures.jsonl').write_bytes(b'newest independent erasures fixture\n')
        self.restore(str(latest))
        for name in ('identity.json', 'erasures.jsonl'):
            self.assertEqual((self.ledger / name).read_bytes(), (latest / name).read_bytes())

    def test_supplied_latest_cannot_overwrite_current_ledger_or_partially_write_integrations(self):
        (self.ledger / 'erasures.jsonl').write_bytes(b'current head must survive\n')
        with self.assertRaisesRegex(ValueError, 'current ledger already exists'):
            self.restore(str(self.work / 'old-ledger'))
        self.assertEqual((self.ledger / 'erasures.jsonl').read_bytes(), b'current head must survive\n')
        self.assertEqual(list(self.integrations.iterdir()), [])

    def test_existing_integration_bytes_are_not_overwritten(self):
        file = self.integrations / 'worker.js'
        file.write_bytes(b'current reviewed integration\n')
        with self.assertRaisesRegex(ValueError, 'overwrite integration'):
            self.restore()
        self.assertEqual(file.read_bytes(), b'current reviewed integration\n')
        self.assertEqual(list(self.ledger.iterdir()), [])

    def test_runtime_directory_symlink_is_rejected_before_any_extraction(self):
        self.ledger.rmdir()
        outside = self.work / 'outside'
        outside.mkdir()
        self.ledger.symlink_to(outside, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'real directories'):
            self.restore()
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual(list(self.integrations.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
