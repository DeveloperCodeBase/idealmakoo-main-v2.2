"""Adversarial archive validation and exact metadata/source-byte round trips."""
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('deployment_archive', ROOT / 'deploy/backup-archive.py')
archive = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(archive)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-archive-test-')
        self.work = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        self.source = self.work / 'source'
        self.source.mkdir()
        (self.source / 'database.dump').write_bytes(b'controlled dump fixture')
        (self.source / 'environment.env').write_text('SESSION_SECRET=test_generated_session\nMFA_ENCRYPTION_KEY=test_generated_key\n')
        (self.source / 'release.env').write_text('RELEASE_SHA=test-release\n')
        (self.source / 'privacy-anchor.json').write_text(json.dumps({'format': 1, 'fingerprint': 'a' * 64, 'sequence': 3, 'hash': 'b' * 64}))
        self.storage([('public/image.webp', b'public bytes'), ('private/document.pdf', b'private bytes')])

    def storage(self, entries):
        with tarfile.open(self.source / 'storage.tar', 'w') as tar:
            for name, content in entries:
                member = tarfile.TarInfo(name)
                if isinstance(content, bytes):
                    member.size = len(content)
                    tar.addfile(member, io.BytesIO(content))
                else:
                    member.type = tarfile.SYMTYPE
                    member.linkname = content
                    tar.addfile(member)

    def create(self):
        archive.manifest(self.source, 'test-release', 'idealmakoo-test', 33, 171)
        output = self.work / 'payload.tar'
        with tarfile.open(output, 'w') as tar:
            for name in (*archive.PAYLOAD, 'manifest.json'):
                tar.add(self.source / name, arcname=name)
        return output

    def test_format2_round_trip_binds_anchor_and_exact_private_public_bytes(self):
        payload = self.create()
        target = self.work / 'verified'
        target.mkdir()
        result = archive.unpack(payload, target)
        self.assertEqual(result['format'], 2)
        self.assertEqual(result['schema'], {'migrationCount': 33, 'publicRelations': 171})
        self.assertEqual(result['privacyAnchor']['sequence'], 3)
        media = self.work / 'media'
        media.mkdir()
        archive.extract_storage(target / 'storage.tar', media)
        self.assertEqual((media / 'public/image.webp').read_bytes(), b'public bytes')
        self.assertEqual((media / 'private/document.pdf').read_bytes(), b'private bytes')
        self.assertEqual((media / 'private/document.pdf').stat().st_mode & 0o777, 0o600)

    def test_modified_payload_is_rejected_before_storage_extraction(self):
        self.create()
        (self.source / 'database.dump').write_bytes(b'replaced bytes')
        with self.assertRaisesRegex(ValueError, 'Checksum failed'):
            archive.metadata(self.source)

    def test_decryption_rejects_sparse_oversize_and_links_before_writing_plaintext(self):
        encrypted = self.work / 'site.tar.age'
        encrypted.write_bytes(b'age fixture')
        archive.preflight_decryption(encrypted, self.work)
        linked = self.work / 'linked.tar.age'
        linked.symlink_to(encrypted)
        with self.assertRaisesRegex(ValueError, 'bounded regular'):
            archive.preflight_decryption(linked, self.work)
        with encrypted.open('r+b') as output:
            output.truncate(archive.MAX_BYTES + 256 * 1024 ** 2 + 1)
        with self.assertRaisesRegex(ValueError, 'bounded regular'):
            archive.preflight_decryption(encrypted, self.work)
        self.assertFalse((self.work / 'archive.tar').exists())

    def test_decryption_requires_room_for_plaintext_and_verified_payload(self):
        encrypted = self.work / 'site.tar.age'
        encrypted.write_bytes(b'age fixture')
        before = set(self.work.iterdir())
        with mock.patch.object(archive.shutil, 'disk_usage', return_value=mock.Mock(free=64 * 1024 ** 2)):
            with self.assertRaisesRegex(ValueError, 'twice the archive size'):
                archive.preflight_decryption(encrypted, self.work)
        self.assertEqual(before, set(self.work.iterdir()))

    def test_unsigned_legacy_restore_is_refused_by_default_before_any_sql(self):
        self.create()
        before = {path.name: path.read_bytes() for path in self.source.iterdir()}
        result = subprocess.run([sys.executable, str(ROOT / 'deploy/backup-archive.py'), 'restore-policy',
                                 str(self.source), str(self.work / 'unused-key'), '0'],
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--allow-legacy-format2', result.stderr)
        self.assertFalse(result.stdout)
        self.assertEqual(before, {path.name: path.read_bytes() for path in self.source.iterdir()})

    def test_explicit_legacy_opt_in_checks_payload_and_reports_authentication_boundary(self):
        self.create()
        command = [sys.executable, str(ROOT / 'deploy/backup-archive.py'), 'restore-policy',
                   str(self.source), str(self.work / 'unused-key'), '1']
        result = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.assertIn('do not authenticate its sender', result.stderr)
        self.assertFalse(result.stdout)
        (self.source / 'database.dump').write_bytes(b'changed historical dump')
        modified = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(modified.returncode, 0)
        self.assertIn('Checksum failed', modified.stderr)

    def test_old_format_or_missing_anchor_fails_closed(self):
        self.create()
        value = json.loads((self.source / 'manifest.json').read_text())
        value['format'] = 1
        (self.source / 'manifest.json').write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'Unknown backup format'):
            archive.metadata(self.source)
        (self.source / 'privacy-anchor.json').unlink()
        with self.assertRaises(OSError):
            archive.manifest(self.source, 'test-release', 'idealmakoo-test', 1, 1)

    def test_malformed_anchor_and_schema_inventory_are_rejected(self):
        (self.source / 'privacy-anchor.json').write_text(json.dumps({'format': 1, 'fingerprint': 'a' * 64, 'sequence': True, 'hash': 'b' * 64}))
        with self.assertRaisesRegex(ValueError, 'privacy ledger anchor'):
            self.create()
        (self.source / 'privacy-anchor.json').write_text(json.dumps({'format': 1, 'fingerprint': 'a' * 64, 'sequence': 0, 'hash': 'b' * 64}))
        with self.assertRaisesRegex(ValueError, 'schema inventory'):
            archive.manifest(self.source, 'test-release', 'idealmakoo-test', 0, 1)

    def test_storage_path_traversal_links_duplicates_and_parent_files_are_rejected(self):
        cases = [[('../escape', b'x')], [('/escape', b'x')], [('private/link', '/etc/passwd')],
                 [('private/a', b'a'), ('private/./a', b'b')],
                 [('private/a', b'a'), ('private/a/child', b'b')],
                 [('private/a/child', b'b'), ('private/a', b'a')]]
        for entries in cases:
            with self.subTest(entries=entries):
                self.storage(entries)
                with self.assertRaises(ValueError):
                    archive.validate_storage(self.source / 'storage.tar')

    def test_outer_extra_payload_and_nonempty_extraction_target_are_rejected(self):
        payload = self.create()
        with tarfile.open(payload, 'a') as tar:
            extra = tarfile.TarInfo('identity.json')
            extra.size = 1
            tar.addfile(extra, io.BytesIO(b'x'))
        target = self.work / 'verified'
        target.mkdir()
        with self.assertRaisesRegex(ValueError, 'Unexpected backup contents'):
            archive.unpack(payload, target)
        (target / 'preexisting').write_text('do not overwrite')
        with self.assertRaisesRegex(ValueError, 'new empty'):
            archive.extract_storage(self.source / 'storage.tar', target)

    def test_restore_list_skips_only_existing_public_schema(self):
        source, target = self.work / 'list', self.work / 'filtered'
        lines = ['; pg_restore archive', '5; 2615 2200 SCHEMA - public owner',
                 '8; 1255 10 FUNCTION public guard() owner', '9; 0 12 TABLE DATA public users owner',
                 '10; 2620 13 TRIGGER public users guard owner']
        source.write_text('\n'.join(lines) + '\n')
        archive.restore_list(source, target)
        self.assertEqual(target.read_text().splitlines(), [lines[0], *lines[2:]])
        source.write_text('\n'.join(lines[2:]))
        with self.assertRaisesRegex(ValueError, 'public-only'):
            archive.restore_list(source, target)


if __name__ == '__main__':
    unittest.main()
