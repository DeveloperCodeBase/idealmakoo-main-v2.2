"""Complete disaster-recovery payloads: authentication, tampering and real age round-trip."""
import hashlib
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('complete_archive', ROOT / 'deploy/backup-archive.py')
archive = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(archive)


class CompleteBackupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-complete-backup-test-')
        self.work = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        self.payload = self.work / 'payload'
        self.payload.mkdir()
        self.key = self.work / 'recovery-key'
        self.key.write_text('AGE-SECRET-KEY-1' + 'A' * 58 + '\n')
        self.key.chmod(0o600)
        self.source = self.work / 'source'
        self.source.mkdir()
        for name in ['package.json', 'package-lock.json', 'Dockerfile', 'docker-compose.yml',
                     'scripts/install-ubuntu.sh', 'scripts/restore.sh', 'deploy/backup-archive.py']:
            path = self.source / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text('{}' if name.endswith('.json') else '# controlled release fixture\n')
        migration = self.source / 'db/migrations/001_core.sql'
        migration.parent.mkdir(parents=True)
        migration.write_text('-- controlled SQL fixture\n')
        self.migration_hash = hashlib.sha256(migration.read_bytes()).hexdigest()
        (self.source / '.env').write_text('SHOULD_NEVER_ENTER_SOURCE=test_private_source_value\n')
        archive.pack_tree(self.source, self.payload / 'source.tar', 'source')
        self.tar('storage.tar', {'public/image.webp': b'controlled public bytes', 'private/request.pdf': b'controlled private bytes'})
        self.tar('integrations.tar', {'najva-messaging-sw.js': b'/* controlled official worker fixture */'})
        self.tar('privacy-ledger.tar', {'identity.json': b'{"fixture":"private ledger identity"}\n', 'erasures.jsonl': b''})
        self.tar('caddy-data.tar', {'caddy/test-certificate.key': b'controlled certificate key bytes'})
        self.tar('caddy-config.tar', {'caddy/autosave.json': b'{}'})
        (self.payload / 'database.dump').write_bytes(b'controlled custom dump bytes')
        (self.payload / 'environment.env').write_text('SESSION_SECRET=test_private_recovery_fixture\n')
        (self.payload / 'release.env').write_text('RELEASE_SHA=test-release\n')
        (self.payload / 'privacy-anchor.json').write_text(json.dumps({'format': 1, 'fingerprint': 'a' * 64, 'sequence': 0, 'hash': '0' * 64}))
        inventory = {'format': 1, 'relations': [{'name': 'users', 'kind': 'r', 'rows': 2, 'sha256': 'b' * 64}],
                     'sequences': [{'name': 'users_id_seq', 'last_value': '2', 'is_called': True}],
                     'migrations': [{'name': '001_core.sql', 'checksum': self.migration_hash}],
                     'structureSha256': 'c' * 64, 'totalRows': 2}
        (self.payload / 'database-inventory.json').write_text(json.dumps(inventory))
        archive.deployment_manifest(self.payload / 'deployment.json', 'test-release', 'idealmakoo-test', 'pgvector/pgvector:pg16')

    def tar(self, name, entries):
        with tarfile.open(self.payload / name, 'w:') as output:
            for filename, content in entries.items():
                member = tarfile.TarInfo(filename)
                member.size = len(content)
                output.addfile(member, io.BytesIO(content))

    def seal(self):
        archive.manifest(self.payload, 'test-release', 'idealmakoo-test', 1, 1, self.key)
        target = self.work / 'complete.tar'
        payload = archive.MAIL_PAYLOAD if (self.payload / 'mail-manifest.json').exists() else archive.COMPLETE_PAYLOAD
        with tarfile.open(target, 'w:') as output:
            for name in (*payload, 'manifest.json'):
                output.add(self.payload / name, arcname=name)
        return target

    def mail_payload(self, *, project='idealmakoo-test'):
        self.tar('mail.tar', {'data/example.test/notifications/new/fixture': b'controlled local message'})
        (self.payload / 'mail-manifest.json').write_text(json.dumps({
            'format': 1, 'mode': 'local', 'included': True, 'project': project,
            'domain': 'example.test', 'hostname': 'mail.example.test',
            'image': 'ghcr.io/docker-mailserver/docker-mailserver:16.0.1',
            'inventory': {'members': 1, 'bytes': len(b'controlled local message')},
        }))

    def test_complete_mail_round_trip_authenticates_both_mail_members(self):
        self.mail_payload()
        file = self.seal()
        target = self.work / 'verified-mail'
        target.mkdir()
        value = archive.unpack(file, target, self.key)
        self.assertEqual(value['format'], 4)
        self.assertEqual(set(value['sha256']), set(archive.MAIL_PAYLOAD))
        self.assertEqual(archive.restore_policy(target, self.key), value)
        for name in ['mail.tar', 'mail-manifest.json']:
            self.assertEqual((target / name).read_bytes(), (self.payload / name).read_bytes())

    def test_mail_bytes_cannot_change_after_manifest_authentication(self):
        self.mail_payload()
        self.seal()
        self.tar('mail.tar', {'data/example.test/notifications/new/fixture': b'changed mailbox data'})
        with self.assertRaisesRegex(ValueError, 'Checksum failed for mail.tar'):
            archive.metadata(self.payload, self.key)

    def test_authenticated_mail_for_another_project_is_refused(self):
        self.mail_payload(project='another-installation')
        with self.assertRaisesRegex(ValueError, 'Mail project differs'):
            self.seal()

    def test_complete_round_trip_covers_source_data_config_media_ledger_and_tls(self):
        file = self.seal()
        target = self.work / 'verified'
        target.mkdir()
        value = archive.unpack(file, target, self.key)
        self.assertEqual(value['format'], 3)
        self.assertEqual(archive.restore_policy(target, self.key), value)
        self.assertEqual(set(value['sha256']), set(archive.COMPLETE_PAYLOAD))
        self.assertNotIn('backup-identity.txt', value['sha256'])
        for name in archive.COMPLETE_PAYLOAD:
            self.assertEqual((target / name).read_bytes(), (self.payload / name).read_bytes())
        recovered = self.work / 'recovered-source'
        recovered.mkdir()
        archive.extract_storage(target / 'source.tar', recovered, executable=True)
        self.assertFalse((recovered / '.env').exists())
        self.assertEqual(hashlib.sha256((recovered / 'db/migrations/001_core.sql').read_bytes()).hexdigest(), self.migration_hash)

    def test_external_identity_is_required_and_wrong_key_is_rejected(self):
        self.seal()
        with self.assertRaisesRegex(ValueError, 'external age identity'):
            archive.metadata(self.payload)
        wrong = self.work / 'wrong-key'
        wrong.write_text('AGE-SECRET-KEY-1' + 'B' * 58 + '\n')
        wrong.chmod(0o600)
        with self.assertRaisesRegex(ValueError, 'authentication failed'):
            archive.metadata(self.payload, wrong)

    def test_bundled_compressed_hdr_survives_authenticated_source_restore_but_other_archives_do_not(self):
        relative = 'public/media/environment/blue-lagoon-1k.hdr.gz'
        raw_relative = relative[:-3]
        expected = (ROOT / relative).read_bytes()
        raw = (ROOT / raw_relative).read_bytes()
        for name, content in [(relative, expected), (raw_relative, raw),
                              ('public/media/environment/unreviewed.hdr.gz', b'excluded archive'),
                              ('public/media/official/blue-lagoon-1k.hdr.gz', b'wrong directory'),
                              ('public/media/environment/private.key', b'excluded secret'),
                              ('public/media/environment/export.zip', b'excluded archive')]:
            file = self.source / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(content)
        (self.payload / 'source.tar').unlink()
        archive.pack_tree(self.source, self.payload / 'source.tar', 'source')
        sealed = self.seal()
        verified = self.work / 'verified-hdr'
        verified.mkdir()
        archive.unpack(sealed, verified, self.key)
        self.assertEqual(archive.restore_policy(verified, self.key)['format'], 3)
        recovered = self.work / 'recovered-hdr'
        recovered.mkdir()
        archive.extract_storage(verified / 'source.tar', recovered, executable=True)
        self.assertEqual((recovered / relative).read_bytes(), expected)
        self.assertEqual((recovered / raw_relative).read_bytes(), raw)
        self.assertEqual(gzip.decompress((recovered / relative).read_bytes()), raw)
        self.assertEqual({file.relative_to(recovered).as_posix() for file in (recovered / 'public').rglob('*') if file.is_file()},
                         {relative, raw_relative})
        # The source archive is authenticated as a whole. Altering bytes of
        # this newly allowed file must fail before any restored source runs.
        with tarfile.open(verified / 'source.tar', 'r:') as source:
            offset = source.getmember(relative).offset_data
        changed = bytearray((verified / 'source.tar').read_bytes())
        changed[offset + 20] ^= 1
        (verified / 'source.tar').write_bytes(changed)
        with self.assertRaisesRegex(ValueError, 'Checksum failed for source.tar'):
            archive.restore_policy(verified, self.key)

    def test_compressed_hdr_exception_does_not_allow_symlinks(self):
        file = self.source / 'public/media/environment/blue-lagoon-1k.hdr.gz'
        file.parent.mkdir(parents=True)
        outside = self.work / 'outside-private-file'
        outside.write_bytes(b'must not enter source backup')
        file.symlink_to(outside)
        with self.assertRaisesRegex(ValueError, 'links or special'):
            archive.pack_tree(self.source, self.work / 'bad-hdr-source.tar', 'source')

    def test_manifest_edits_are_rejected_even_with_unchanged_payload_checksums(self):
        self.seal()
        value = json.loads((self.payload / 'manifest.json').read_text())
        value['release'] = 'unreviewed-release'
        (self.payload / 'manifest.json').write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError, 'authentication failed'):
            archive.metadata(self.payload, self.key)

    def test_legacy_manifest_cannot_smuggle_unsigned_source_into_new_host_recovery(self):
        # Anyone holding an age recipient can encrypt an archive; the separate
        # identity-bound MAC must remain mandatory before executing its source.
        archive.manifest(self.payload, 'test-release', 'idealmakoo-test', 1, 1)
        forged = self.work / 'downgraded.tar'
        with tarfile.open(forged, 'w:') as output:
            for name in (*archive.COMPLETE_PAYLOAD, 'manifest.json'):
                output.add(self.payload / name, arcname=name)
        target = self.work / 'downgraded-extraction'
        target.mkdir()
        with self.assertRaisesRegex(ValueError, 'manifest format'):
            archive.unpack(forged, target, self.key)

    def test_changed_database_media_or_secrets_fail_authentic_inventory(self):
        self.seal()
        for name in ('database.dump', 'storage.tar', 'environment.env', 'privacy-ledger.tar', 'source.tar', 'caddy-data.tar'):
            original = (self.payload / name).read_bytes()
            (self.payload / name).write_bytes(original + b'altered')
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, 'Checksum failed'):
                archive.metadata(self.payload, self.key)
            (self.payload / name).write_bytes(original)

    def test_authentic_but_wrong_source_migration_is_refused(self):
        (self.source / 'db/migrations/001_core.sql').write_text('-- changed SQL after deployment\n')
        (self.payload / 'source.tar').unlink()
        archive.pack_tree(self.source, self.payload / 'source.tar', 'source')
        with self.assertRaisesRegex(ValueError, 'migration checksum differs'):
            self.seal()

    def test_nested_traversal_and_symlinks_are_refused_before_extraction(self):
        for name in ('source.tar', 'integrations.tar', 'privacy-ledger.tar', 'caddy-data.tar'):
            with self.subTest(name=name):
                before = (self.payload / name).read_bytes()
                self.tar(name, {'../escape': b'unsafe'})
                with self.assertRaisesRegex(ValueError, 'Unsafe storage'):
                    self.seal()
                (self.payload / name).write_bytes(before)
        (self.source / 'scripts/link.sh').symlink_to('/etc/passwd')
        with self.assertRaisesRegex(ValueError, 'links or special'):
            archive.pack_tree(self.source, self.work / 'bad-source.tar', 'source')

    def test_insecure_or_linked_external_identity_is_refused(self):
        self.key.chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'private regular'):
            self.seal()
        self.key.chmod(0o600)
        linked = self.work / 'linked-key'
        os.link(self.key, linked)
        with self.assertRaisesRegex(ValueError, 'private regular'):
            self.seal()

    def test_directory_swapped_for_symlink_cannot_exfiltrate_outside_bytes(self):
        source = self.work / 'race-source'
        content = source / 'content'
        content.mkdir(parents=True)
        (content / 'file.txt').write_text('allowed content')
        outside = self.work / 'outside'
        outside.mkdir()
        marker = b'outside-content-must-never-enter-the-backup'
        (outside / 'file.txt').write_bytes(marker)
        destination = self.work / 'race.tar'
        original_open = os.open
        swapped = False

        def racing_open(path, flags, *args, **kwargs):
            nonlocal swapped
            if path == 'content' and flags & os.O_DIRECTORY and not swapped:
                content.rename(source / 'original-content')
                content.symlink_to(outside, target_is_directory=True)
                swapped = True
            return original_open(path, flags, *args, **kwargs)

        with mock.patch.object(archive.os, 'open', side_effect=racing_open):
            with self.assertRaises((OSError, ValueError)):
                archive.pack_tree(source, destination, 'integration')
        self.assertTrue(swapped)
        self.assertNotIn(marker, destination.read_bytes())

    def test_object_inventory_catches_rows_schema_sequences_and_migration_changes(self):
        source = self.payload / 'database-inventory.json'
        value = json.loads(source.read_text())
        for field in ('structureSha256', 'sequences', 'relations', 'migrations'):
            changed = json.loads(json.dumps(value))
            if field == 'structureSha256':
                changed[field] = 'd' * 64
            elif field == 'sequences':
                changed[field][0]['last_value'] = '9'
            elif field == 'relations':
                changed[field][0]['sha256'] = 'e' * 64
            else:
                changed[field][0]['checksum'] = 'f' * 64
            restored = self.work / 'restored-inventory.json'
            restored.write_text(json.dumps(changed))
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'differ'):
                archive.compare_inventory(source, restored)

    def test_restored_volume_stream_must_match_every_private_and_public_file(self):
        command = [sys.executable, str(ROOT / 'deploy/backup-archive.py'), 'verify-storage-stream', str(self.payload / 'storage.tar')]
        result = subprocess.run(command, input=(self.payload / 'storage.tar').read_bytes(), capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.tar('changed.tar', {'public/image.webp': b'wrong public bytes', 'private/request.pdf': b'controlled private bytes'})
        result = subprocess.run(command, input=(self.payload / 'changed.tar').read_bytes(), capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b'differ', result.stderr)

    def test_real_age_encryption_decryption_and_wrong_identity_fail_closed(self):
        age = os.environ.get('TEST_AGE_BINARY') or shutil.which('age')
        keygen = os.environ.get('TEST_AGE_KEYGEN_BINARY') or shutil.which('age-keygen')
        self.assertTrue(age and keygen, 'Install age or set TEST_AGE_BINARY and TEST_AGE_KEYGEN_BINARY; this acceptance test must not be skipped.')
        self.key.unlink()
        subprocess.run([keygen, '-o', str(self.key)], capture_output=True, check=True, timeout=10)
        self.key.chmod(0o600)
        recipient = subprocess.run([keygen, '-y', str(self.key)], capture_output=True, text=True, check=True, timeout=10).stdout.strip()
        source = self.seal()
        encrypted = self.work / 'site.tar.age'
        subprocess.run([age, '--encrypt', '--recipient', recipient, '--output', str(encrypted), str(source)], capture_output=True, check=True, timeout=10)
        self.assertNotIn(b'test_private_recovery_fixture', encrypted.read_bytes())
        decrypted = self.work / 'decrypted.tar'
        subprocess.run([age, '--decrypt', '--identity', str(self.key), '--output', str(decrypted), str(encrypted)], capture_output=True, check=True, timeout=10)
        self.assertEqual(decrypted.read_bytes(), source.read_bytes())
        target = self.work / 'verified'
        target.mkdir()
        self.assertEqual(archive.unpack(decrypted, target, self.key)['format'], 3)
        wrong = self.work / 'other-native-key'
        subprocess.run([keygen, '-o', str(wrong)], capture_output=True, check=True, timeout=10)
        rejected = subprocess.run([age, '--decrypt', '--identity', str(wrong), str(encrypted)], capture_output=True, timeout=10)
        self.assertNotEqual(rejected.returncode, 0)
        self.assertNotIn(b'test_private_recovery_fixture', rejected.stdout + rejected.stderr)


if __name__ == '__main__':
    unittest.main()
