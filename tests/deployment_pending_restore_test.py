"""Durable restore checkpoints and executable Bash failure -> retry scenarios.

The checkpoint helper runs unchanged against real private files. Lifecycle tests
run the complete shipped restore script and security-output adapter, with only
Docker/database/age and external lifecycle operations replaced by bounded fixtures.
The separate service-lifecycle suite checks the helper itself. Real SQL security
reconciliation is covered by server-restore-security.pg.mjs; the separate Ubuntu
acceptance must run the actual mid-restore failure and resume against Docker.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid

ROOT = Path(os.environ.get('IDEALMAKOO_TEST_SOURCE_ROOT', Path(__file__).resolve().parents[1]))
SPEC = importlib.util.spec_from_file_location('pending_restore_tests', ROOT / 'deploy/pending-restore.py')
pending = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pending)


def private_file(path, body):
    path.write_bytes(body if isinstance(body, bytes) else body.encode())
    path.chmod(0o600)


def access_capture(editor_active=False):
    return {'format': 'idealmakoo.restore-access', 'version': 1,
            'captureId': str(uuid.uuid4()), 'users': [{'id': 'editor', 'active': editor_active}]}


def security_result(*, already=False, ready=True, reconciled=True):
    return {**{key: 0 for key in pending.SECURITY_COUNTS},
            'alreadyApplied': already, 'accessReconciled': reconciled, 'ready': ready}


class CheckpointTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-pending-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.environment = self.root / 'environment'
        private_file(self.environment, 'COMPOSE_PROJECT_NAME=idealmakoo\nSITE_URL=http://127.0.0.1:3088\n')
        self.archive = self.root / 'backup.tar.age'
        self.safety = self.root / 'safety.tar.age'
        private_file(self.archive, 'encrypted-selected-archive-fixture')
        private_file(self.safety, 'encrypted-current-safety-fixture')
        self.capture = self.root / 'temporary' / 'security'
        self.capture.mkdir(parents=True, mode=0o700)
        self.capture.parent.chmod(0o700)
        self.body = (json.dumps(access_capture(), indent=2) + '\n').encode()
        private_file(self.capture / 'access.json', self.body)
        self.directory = self.root / '.pending-restore'

    def prepare(self):
        pending.prepare(self.environment, self.archive, 'release-2.1', '0', self.capture, self.safety)

    def test_published_capture_has_identical_bytes_and_survives_temporary_cleanup(self):
        before = (self.capture / 'access.json').stat()
        self.prepare()
        shutil.rmtree(self.capture.parent)
        path, state = pending.validate_retry(self.environment, self.archive, 'release-2.1', '0')
        after = (path / 'access.json').stat()
        self.assertEqual((after.st_dev, after.st_ino), (before.st_dev, before.st_ino))
        self.assertEqual((path / 'access.json').read_bytes(), self.body)
        self.assertEqual(state['phase'], 'prepared')
        self.assertEqual((path / 'metadata.json').stat().st_mode & 0o777, 0o600)
        self.assertEqual(path.stat().st_mode & 0o777, 0o700)
        self.assertEqual(state['safetyBackup']['sha256'], hashlib.sha256(self.safety.read_bytes()).hexdigest())

    def test_original_operation_cannot_be_replaced_by_a_new_capture(self):
        self.prepare()
        original = (self.directory / 'metadata.json').read_bytes()
        self.capture.mkdir(mode=0o700)
        private_file(self.capture / 'access.json', json.dumps(access_capture(True)))
        with self.assertRaisesRegex(ValueError, 'pending'):
            self.prepare()
        self.assertEqual((self.directory / 'metadata.json').read_bytes(), original)
        self.assertEqual((self.directory / 'access.json').read_bytes(), self.body)

    def test_retry_binds_archive_release_key_choice_site_and_original_safety_backup(self):
        self.prepare()
        for field in ('archive', 'release', 'restore_keys', 'environment', 'safety'):
            with self.subTest(field=field):
                archive, release, restore_keys = self.archive, 'release-2.1', '0'
                old_environment, old_safety = self.environment.read_bytes(), self.safety.read_bytes()
                if field == 'archive':
                    archive = self.root / 'different.tar.age'
                    private_file(archive, 'different-encrypted-selection')
                if field == 'release':
                    release = 'other-release'
                if field == 'restore_keys':
                    restore_keys = '1'
                if field == 'environment':
                    private_file(self.environment, old_environment.replace(b':3088', b':3089'))
                if field == 'safety':
                    private_file(self.safety, 'changed-safety-archive')
                with self.assertRaises(ValueError):
                    pending.validate_retry(self.environment, archive, release, restore_keys)
                private_file(self.environment, old_environment)
                private_file(self.safety, old_safety)
                self.assertEqual((self.directory / 'access.json').read_bytes(), self.body)

    def test_access_tamper_is_refused_without_recreating_the_original_policy(self):
        self.prepare()
        private_file(self.directory / 'access.json', json.dumps(access_capture(True)))
        with self.assertRaisesRegex(ValueError, 'changed'):
            pending.load(self.environment)
        self.assertTrue(self.directory.exists())

    def test_unsafe_mode_symlink_hardlink_and_oversized_capture_are_refused(self):
        capture = self.capture / 'access.json'
        for kind in ('mode', 'symlink', 'hardlink', 'oversized'):
            with self.subTest(kind=kind):
                if capture.exists() or capture.is_symlink():
                    capture.unlink()
                private_file(capture, self.body)
                if kind == 'mode':
                    capture.chmod(0o644)
                elif kind == 'symlink':
                    capture.unlink()
                    capture.symlink_to(self.safety)
                elif kind == 'hardlink':
                    os.link(capture, self.root / 'capture-link')
                else:
                    with capture.open('r+b') as stream:
                        stream.truncate(pending.MAX_ACCESS + 1)
                with self.assertRaises(ValueError):
                    self.prepare()
                self.assertFalse(self.directory.exists())
                link = self.root / 'capture-link'
                if link.exists():
                    link.unlink()

    def test_duplicate_metadata_and_symlinked_pending_directory_fail_closed(self):
        self.prepare()
        state_file = self.directory / 'metadata.json'
        original = state_file.read_bytes()
        private_file(state_file, original.rstrip()[:-1] + b',"phase":"security-applied"}\n')
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            pending.load(self.environment)
        private_file(state_file, original)
        retained = self.root / 'retained'
        self.directory.rename(retained)
        self.directory.symlink_to(retained, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            pending.load(self.environment)
        with self.assertRaisesRegex(ValueError, 'pending'):
            pending.assert_clear(self.environment)

    def test_first_failure_and_capture_identity_remain_across_multiple_failed_attempts(self):
        self.prepare()
        pending.note_failure(self.environment, '45')
        first = pending.load(self.environment)[1]
        pending.note_failure(self.environment, '42')
        pending.mark_security(self.environment)
        pending.note_failure(self.environment, '2')
        state = pending.load(self.environment)[1]
        self.assertEqual(state['firstFailure'], first['firstFailure'])
        self.assertEqual(state['firstFailure']['exitCode'], 45)
        self.assertEqual(state['lastFailure']['exitCode'], 2)
        self.assertEqual(state['lastFailure']['phase'], 'security-applied')
        self.assertEqual(state['captureId'], first['captureId'])
        self.assertEqual((self.directory / 'access.json').read_bytes(), self.body)

    def test_owner_provision_is_blocked_before_commit_and_allowed_after_committed_exit_two(self):
        self.prepare()
        command = [sys.executable, str(ROOT / 'deploy/pending-restore.py'), 'provision-allowed', str(self.environment)]
        result = subprocess.run(command, capture_output=True, text=True, timeout=5)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('prepared restore', result.stderr)
        pending.mark_security(self.environment)
        pending.note_failure(self.environment, '2')
        result = subprocess.run(command, capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        with self.assertRaisesRegex(ValueError, 'pending'):
            pending.assert_clear(self.environment)

    def test_checkpoint_cannot_clear_prepared_state_and_clear_never_deletes_safety_archive(self):
        self.prepare()
        with self.assertRaisesRegex(ValueError, 'before security'):
            pending.clear(self.environment)
        pending.mark_security(self.environment)
        pending.clear(self.environment)
        pending.assert_clear(self.environment)
        self.assertFalse(self.directory.exists())
        self.assertEqual(self.safety.read_text(), 'encrypted-current-safety-fixture')

    def test_security_adapter_accepts_real_shape_but_refuses_malformed_counts_and_false_commit(self):
        output = self.root / 'security-output'
        cases = [
            (security_result(), '0', '0', True),
            (security_result(ready=False), '2', '0', True),
            (security_result(already=True), '0', '1', True),
            (security_result(already=True, ready=False), '2', '1', True),
            (security_result(), '0', '1', False),
            (security_result(already=True, reconciled=False), '0', '1', False),
            (security_result(ready=False), '0', '0', False),
            ({**security_result(), 'sessionsRevoked': True}, '0', '0', False),
            ({**security_result(), 'sessionsRevoked': -1}, '0', '0', False),
            ({**security_result(), 'unexpected': 'private-data'}, '0', '0', False),
        ]
        for value, status, require_applied, accepted in cases:
            with self.subTest(status=status, require_applied=require_applied, value=value):
                private_file(output, json.dumps(value))
                result = subprocess.run([sys.executable, str(ROOT / 'deploy/pending-restore.py'),
                                         'validate-security-output', str(output), status, require_applied],
                                        capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode == 0, accepted, result.stderr)
                self.assertNotIn('private-data', result.stdout + result.stderr)


MOCK_EXTERNAL = r'''
import json, os, pathlib, sys, uuid
root = pathlib.Path(os.environ['TEST_STATE'])
state_path = root / 'state.json'
state = json.loads(state_path.read_text())
args = sys.argv[1:]
with (root / 'actions.jsonl').open('a') as out:
    out.write(json.dumps(args) + '\n')
def save():
    state_path.write_text(json.dumps(state))
def fail(name, code):
    if state.get('failure') == name:
        state['failure'] = ''
        save()
        raise SystemExit(code)
def result(already, ready):
    names = ('accountsMatched accountsDisabled identityMismatches credentialMismatches '
             'missingCurrentAccounts groupsDisabled membershipsRestored membershipsUnavailable '
             'sessionsRevoked challengesConsumed enrollmentsCleared recoveryCodesCleared '
             'staffInvitationsRevoked organizationInvitationsRevoked authMessagesCancelled').split()
    return {**dict.fromkeys(names, 0), 'alreadyApplied': already, 'ready': ready, 'accessReconciled': True}
if args[0] == 'config':
    print(json.dumps({'services': {name: {'image': 'fixture/' + name} for name in ('app', 'worker', 'proxy')}}))
elif args[0] == 'lifecycle':
    if args[1:] == ['stop', '--timeout', '90', 'app', 'worker']:
        state['writers'] = False
    elif args[1:] == ['up', '--timeout', '1200', 'app', 'worker', 'proxy']:
        state['writers'] = True
        fail('lifecycle-up', 48)
    else:
        raise SystemExit('Unexpected fixture lifecycle contract')
elif args[0] in ('stop', 'up'):
    raise SystemExit('Writer lifecycle bypassed the selected helper')
elif args[0] == 'backup':
    state['backups'] += 1
    path = root / ('safety-' + str(state['backups']) + '.tar.age')
    with path.open('x') as out:
        out.write(json.dumps(state['db']))
    path.chmod(0o600)
    print(path)
elif args[0] == 'health':
    fail('health', 42)
    assert state['writers'] and state['db']['adminActive']
elif args[0] == 'record':
    fail('record', 46)
    state['evidence'] += 1
elif args[0] == 'inventory':
    assert state['db'] is not None
    print('40|2|2')
elif args[0] == 'privacy':
    if args[1] == 'replay':
        state['privacyReplays'] += 1
    if args[1] == 'ready':
        fail('privacy-ready', 47)
elif args[0] == 'exec':
    command = args[3:]
    if command[0] == 'dropdb':
        if state['db'] is None:
            assert '--if-exists' in command
        state['db'] = None
        fail('after-drop', 43)
    elif command[0] == 'createdb':
        assert state['db'] is None
        state['db'] = {}
    elif command[0] == 'pg_restore':
        if '--list' in command:
            print('fixture restore inventory')
        else:
            state['db'] = {'editorActive': True, 'adminActive': True,
                           'password': 'archived-verifier', 'proof': 'historical-proof',
                           'applied': None}
            state['restores'] += 1
            fail('restore-data', 44)
    elif command[0] == 'psql' and any('information_schema.tables' in value for value in command):
        print('0')
    elif command[0] == 'sh':
        sys.stdin.buffer.read()
elif args[0] == 'run-existing':
    if '/app/scripts/restore-security.ts' in args:
        position = args.index('/app/scripts/restore-security.ts')
        directory = pathlib.Path(args[args.index('--volume') + 1].split(':/recovery:')[0])
        if args[position + 1] == 'capture':
            assert not state['writers']
            state['captures'] += 1
            snapshot = {'format': 'idealmakoo.restore-access', 'version': 1,
                        'captureId': str(uuid.uuid4()), 'users': [{'id': 'editor', 'active': state['db']['editorActive']}]}
            with (directory / 'access.json').open('x') as out:
                os.fchmod(out.fileno(), 0o600)
                out.write(json.dumps(snapshot) + '\n')
                out.flush()
                os.fsync(out.fileno())
            print(json.dumps({'captureId': snapshot['captureId']}))
        else:
            fail('before-security', 45)
            snapshot = json.loads((directory / 'access.json').read_text())
            already = state['db']['applied'] == snapshot['captureId']
            if not already:
                state['db']['editorActive'] = snapshot['users'][0]['active']
                state['db']['proof'] = None
                state['db']['applied'] = snapshot['captureId']
                state['securityApplications'] += 1
                if state.get('noAdmin'):
                    state['db']['adminActive'] = False
            output = result(already, state['db']['adminActive'])
            if state.get('failure') == 'invalid-security-output':
                state['failure'] = ''
                output['sessionsRevoked'] = True
            print(json.dumps(output))
            save()
            raise SystemExit(0 if output['ready'] else 2)
    elif '/app/scripts/provision-staff.ts' in args:
        assert '--rotate-passwords' in args and '--reactivate=senior' in args
        state['db']['adminActive'] = True
        state['db']['password'] = 'explicitly-new-owner-verifier'
        state['db']['proof'] = 'new-owner-recovery-proof'
        state['noAdmin'] = False
elif args[0] == '--profile':
    if '--entrypoint' in args:
        state['mediaRestores'] += 1
    sys.stdin.buffer.read()
else:
    raise SystemExit('Unexpected fixture operation')
save()
'''

MOCK_ARCHIVE = r'''
import os, pathlib, shutil, sys
root = pathlib.Path(os.environ['TEST_STATE'])
args = sys.argv[1:]
if args[0] == 'unpack':
    target = pathlib.Path(args[2])
    for name, body in [('database.dump', 'fixture-dump'), ('privacy-anchor.json', '{}'), ('storage.tar', 'fixture-media')]:
        (target / name).write_text(body)
    shutil.copy(root / 'archived.env', target / 'environment.env')
    print('test-release')
elif args[0] == 'inventory':
    print('40|2')
elif args[0] == 'restore-list':
    pathlib.Path(args[2]).write_text('fixture-list')
elif args[0] == 'verify-storage-stream':
    sys.stdin.buffer.read()
elif args[0] not in ('preflight-decryption', 'restore-policy', 'compare-inventory'):
    raise SystemExit('Unexpected fixture archive operation')
'''


class RestoreRetryLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-resume-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.release = self.root / 'installation' / 'releases' / 'test-release'
        self.shared = self.root / 'installation' / 'shared'
        for path in (self.release / 'scripts', self.release / 'deploy', self.shared, self.root / 'bin'):
            path.mkdir(parents=True, mode=0o700)
        self.environment = self.shared / '.env'
        private_file(self.environment, 'COMPOSE_PROJECT_NAME=idealmakoo\nSITE_URL=http://127.0.0.1:3088\nSESSION_SECRET=fixture-session\nMFA_ENCRYPTION_KEY=fixture-mfa\n')
        shutil.copy(self.environment, self.root / 'archived.env')
        private_file(self.shared / 'backup-identity.txt', 'fixture-external-identity')
        self.archive = self.root / 'selected.tar.age'
        private_file(self.archive, 'fixture-selected-encrypted-archive')
        private_file(self.release / '.release.env', 'RELEASE_SHA=test-release\n')
        for name in ('restore.sh', 'provision-staff.sh'):
            shutil.copy(ROOT / 'scripts' / name, self.release / 'scripts' / name)
        for name in ('pending-restore.py', 'env-file.py'):
            shutil.copy(ROOT / 'deploy' / name, self.release / 'deploy' / name)
        # The only portability adaptation to the real recovery adapter: these
        # tests run as an ordinary CI user, so the mocked container shares that
        # uid instead of requiring a host chown to the real container uid10001.
        recovery = (ROOT / 'deploy/recovery.sh').read_text().replace(
            'install -d -m 0700 -o 10001 -g 10001', 'install -d -m 0700')
        (self.release / 'deploy/recovery.sh').write_text(recovery)
        (self.release / 'deploy/backup-archive.py').write_text(MOCK_ARCHIVE)
        (self.root / 'external.py').write_text(MOCK_EXTERNAL)
        lib = '''#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="$IDEALMAKOO_ENV_FILE"
die() { printf 'ERROR: %s\\n' "$*" >&2; exit 1; }
log() { printf '%s\\n' "$*" >&2; }
need() { command -v "$1" >/dev/null; }
require_environment() { [[ -f "$ENV_FILE" ]]; }
acquire_ops_lock() { :; }
env_get() { python3 "$PROJECT_ROOT/deploy/env-file.py" get "$ENV_FILE" "$1" "${2:-}"; }
dc() { python3 "$TEST_STATE/external.py" "$@"; }
# Explicit external boundary mock; real restore/checkpoint shell remains unchanged.
lifecycle() { python3 "$TEST_STATE/external.py" lifecycle "$@"; }
pending_restore() { python3 "$PROJECT_ROOT/deploy/pending-restore.py" "$1" "$ENV_FILE" "${@:2}"; }
privacy_cli() { dc privacy "$@"; }
record_recovery() { dc record; }
database_inventory() { dc inventory; }
database_name() { printf '%s\\n' idealmakoo; }
release_id() { printf '%s\\n' test-release; }
'''
        (self.release / 'deploy/lib.sh').write_text(lib)
        for filename, operation in [('backup.sh', 'backup'), ('check-health.sh', 'health')]:
            (self.release / 'scripts' / filename).write_text(
                '#!/usr/bin/env bash\nset -euo pipefail\npython3 "$TEST_STATE/external.py" ' + operation + '\n')
        age = '''#!/usr/bin/env python3
import pathlib, sys
args = sys.argv[1:]
pathlib.Path(args[args.index('--output') + 1]).write_bytes(pathlib.Path(args[-1]).read_bytes())
'''
        private_file(self.root / 'bin/age', age)
        (self.root / 'bin/age').chmod(0o700)
        private_file(self.root / 'bin/docker', '#!/usr/bin/env bash\n[[ "$1 $2" == "image inspect" ]]\n')
        (self.root / 'bin/docker').chmod(0o700)
        self.state_path = self.root / 'state.json'
        self.set_state({'db': {'editorActive': False, 'adminActive': True,
                               'password': 'current-verifier', 'proof': 'current-proof', 'applied': None},
                        'writers': True, 'captures': 0, 'backups': 0, 'restores': 0,
                        'mediaRestores': 0, 'privacyReplays': 0, 'securityApplications': 0,
                        'evidence': 0, 'failure': ''})
        self.pending = self.shared / '.pending-restore'

    def state(self):
        return json.loads(self.state_path.read_text())

    def set_state(self, state):
        private_file(self.state_path, json.dumps(state))

    def fail(self, name):
        state = self.state()
        state['failure'] = name
        self.set_state(state)

    def execute(self, *, resume=False, arguments=(), script='restore.sh'):
        args = ['bash', str(self.release / 'scripts' / script)]
        if script == 'restore.sh':
            args += ['--file', str(self.archive), '--confirm-replace', 'idealmakoo']
            if resume:
                args.append('--resume')
        args += list(arguments)
        return subprocess.run(args, env={**os.environ, 'TEST_STATE': str(self.root),
                                         'IDEALMAKOO_ENV_FILE': str(self.environment),
                                         'PATH': str(self.root / 'bin') + os.pathsep + os.environ['PATH']},
                              capture_output=True, text=True, timeout=20)

    def checkpoint(self):
        return pending.load(self.environment)[1]

    def test_failure_before_security_retains_current_policy_and_explicit_retry_never_recaptures(self):
        self.fail('before-security')
        first = self.execute()
        self.assertEqual(first.returncode, 45, first.stderr)
        state = self.state()
        self.assertFalse(state['writers'])
        self.assertTrue(state['db']['editorActive'])  # raw historical DB is still untrusted
        original = self.checkpoint()
        access = (self.pending / 'access.json').read_bytes()
        self.assertFalse(json.loads(access)['users'][0]['active'])
        self.assertEqual(original['phase'], 'prepared')
        self.assertEqual(original['firstFailure']['exitCode'], 45)
        normal = self.execute()
        self.assertNotEqual(normal.returncode, 0)
        self.assertIn('--resume', normal.stderr)
        self.assertEqual(self.state()['captures'], 1)
        self.assertEqual((self.pending / 'access.json').read_bytes(), access)
        result = self.execute(resume=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        state = self.state()
        self.assertTrue(state['writers'])
        self.assertFalse(state['db']['editorActive'])
        self.assertEqual((state['captures'], state['backups'], state['restores']), (1, 1, 2))
        self.assertEqual(hashlib.sha256(Path(original['safetyBackup']['path']).read_bytes()).hexdigest(),
                         original['safetyBackup']['sha256'])
        self.assertFalse(self.pending.exists())

    def test_retry_after_drop_succeeds_with_missing_database_and_original_capture(self):
        self.fail('after-drop')
        result = self.execute()
        self.assertEqual(result.returncode, 43, result.stderr)
        self.assertIsNone(self.state()['db'])
        capture_id = self.checkpoint()['captureId']
        result = self.execute(resume=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.state()['db']['applied'], capture_id)
        self.assertFalse(self.state()['db']['editorActive'])
        self.assertEqual(self.state()['captures'], 1)

    def test_committed_exit_two_owner_recovery_and_resume_preserve_new_credentials_and_proofs(self):
        state = self.state()
        state['noAdmin'] = True
        self.set_state(state)
        result = self.execute()
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertEqual(self.checkpoint()['phase'], 'security-applied')
        self.assertFalse(self.state()['writers'])
        self.assertEqual(self.state()['evidence'], 0)
        result = self.execute(script='provision-staff.sh',
                              arguments=('--rotate-passwords', '--reactivate=senior'))
        self.assertEqual(result.returncode, 0, result.stderr)
        recovered = self.state()['db'].copy()
        result = self.execute(resume=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        state = self.state()
        self.assertEqual(state['db'], recovered)
        self.assertEqual((state['captures'], state['backups'], state['restores'], state['mediaRestores'],
                          state['securityApplications']), (1, 1, 1, 1, 1))
        self.assertIn('"alreadyApplied":true', result.stderr)
        self.assertTrue(state['writers'])
        self.assertFalse(self.pending.exists())

    def test_health_and_evidence_failures_resume_without_reimporting_db_media_or_account_proofs(self):
        for failure, status in (('health', 42), ('record', 46)):
            with self.subTest(failure=failure):
                self.fail(failure)
                result = self.execute()
                self.assertEqual(result.returncode, status, result.stderr)
                self.assertFalse(self.state()['writers'])
                self.assertEqual(self.checkpoint()['phase'], 'security-applied')
                before = self.state()
                self.assertEqual(before['evidence'], 0 if failure == 'health' else 1)
                result = self.execute(resume=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                after = self.state()
                for name in ('restores', 'mediaRestores', 'captures', 'backups', 'securityApplications'):
                    self.assertEqual(after[name], before[name], name)
                self.assertEqual(after['db'], before['db'])
                self.assertTrue(after['writers'])

    def test_partial_lifecycle_start_failure_retains_committed_checkpoint_and_retry_does_not_reimport(self):
        self.fail('lifecycle-up')
        result = self.execute()
        self.assertEqual(result.returncode, 48, result.stderr)
        before = self.state()
        self.assertFalse(before['writers'])
        self.assertEqual(self.checkpoint()['phase'], 'security-applied')
        self.assertEqual(self.checkpoint()['firstFailure']['exitCode'], 48)
        actions = [json.loads(line) for line in (self.root / 'actions.jsonl').read_text().splitlines()]
        startup = ['lifecycle', 'up', '--timeout', '1200', 'app', 'worker', 'proxy']
        self.assertIn(startup, actions)
        startup_index = max(index for index, action in enumerate(actions) if action == startup)
        self.assertEqual(actions[startup_index + 1:].count(
            ['lifecycle', 'stop', '--timeout', '90', 'app', 'worker']), 1)
        result = self.execute(resume=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        after = self.state()
        for name in ('restores', 'mediaRestores', 'captures', 'backups', 'securityApplications'):
            self.assertEqual(after[name], before[name], name)
        self.assertEqual(after['db'], before['db'])
        self.assertTrue(after['writers'])
        self.assertFalse(self.pending.exists())

    def test_pending_prepared_blocks_provision_and_tampered_resume_stops_writers_without_recapture(self):
        self.fail('before-security')
        self.assertEqual(self.execute().returncode, 45)
        before = self.state()
        result = self.execute(script='provision-staff.sh',
                              arguments=('--rotate-passwords', '--reactivate=senior'))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.state(), before)
        private_file(self.archive, 'different-selected-encrypted-archive')
        before['writers'] = True  # simulate abrupt death after a temporary start
        self.set_state(before)
        result = self.execute(resume=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('original authenticated archive', result.stderr)
        self.assertFalse(self.state()['writers'])
        self.assertEqual((self.state()['captures'], self.state()['backups']), (1, 1))
        self.assertEqual(self.checkpoint()['phase'], 'prepared')

    def test_missing_committed_audit_identity_fails_closed_and_retains_checkpoint(self):
        self.fail('health')
        self.assertEqual(self.execute().returncode, 42)
        state = self.state()
        state['db']['applied'] = None  # inconsistent DB must never complete a retained committed checkpoint
        self.set_state(state)
        result = self.execute(resume=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('previously committed restore audit identity is missing', result.stderr)
        self.assertFalse(self.state()['writers'])
        self.assertTrue(self.pending.exists())
        self.assertEqual(self.state()['restores'], 1)

    def test_malformed_owner_success_cannot_advance_durable_security_phase(self):
        self.fail('invalid-security-output')
        result = self.execute()
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertFalse(self.state()['writers'])
        self.assertEqual(self.checkpoint()['phase'], 'prepared')
        self.assertEqual(self.state()['evidence'], 0)

    def test_real_restore_term_and_failed_temp_cleanup_keep_committed_checkpoint(self):
        # Execute the complete shipped restore. Its health child sends an actual
        # TERM to Bash after security commit; only the external rm fails.
        (self.release / 'scripts/check-health.sh').write_text(
            '#!/usr/bin/env bash\nkill -TERM "$PPID"\nexit 143\n')
        command = self.root / 'bin/rm'
        command.write_text('#!/usr/bin/env bash\n'
                           '[[ "$1 $2" == "-rf --" && "$3" == "$TEST_STATE"/installation/shared/.restore.* ]] || exit 94\n'
                           'printf "%s\\n" "$3" > "$TEST_STATE/retained-work"\nexit 55\n')
        command.chmod(0o700)
        result = self.execute()
        self.assertEqual(result.returncode, 143, result.stderr)
        self.assertFalse(self.state()['writers'])
        self.assertEqual(self.checkpoint()['phase'], 'security-applied')
        self.assertEqual(self.checkpoint()['lastFailure']['exitCode'], 143)
        self.assertTrue((self.pending / 'access.json').is_file())
        self.assertTrue(Path((self.root / 'retained-work').read_text().strip()).is_dir())
        self.assertIn('Temporary restore files could not be fully removed', result.stderr)


class RestoreCleanupStatusTests(unittest.TestCase):
    """Run the shipped cleanup/traps in Bash with failing external cleanup calls."""
    def run_cleanup(self, original, *, removal=False, drill_drop=False):
        source = (ROOT / 'scripts/restore.sh').read_text()
        start = source.index('cleanup() {\n')
        stop = source.index('if (( resume )); then\n', start)
        with tempfile.TemporaryDirectory(prefix='idealmakoo-restore-cleanup-') as directory:
            state = Path(directory)
            (state / 'work').mkdir()
            harness = r'''set -Eeuo pipefail
mode=restore
stop_writers_on_failure=1
checkpoint_owned=1
drill_created="$TEST_DRILL_DROP"
[[ "$drill_created" == 0 ]] || mode=drill
drill_db=idealmakoo_disposable_cleanup_fixture
restore_list=/tmp/fixture-list
RESTORE_TOC=""
work="$TEST_STATE/work"
log() { printf '%s\n' "$*" >&2; }
lifecycle() {
  [[ "$*" == 'stop --timeout 90 app worker' ]] || return 95
  printf 'stopped\n' > "$TEST_STATE/writers"
}
pending_restore() { printf '%s\n' "$*" > "$TEST_STATE/checkpoint"; }
dc() {
  [[ "$1 $2 $3" == 'exec -T db' ]] || return 96
  if [[ "$4" == dropdb ]]; then
    printf 'attempted\n' > "$TEST_STATE/drop-attempt"
    return 56
  fi
  [[ "$4" == rm ]] || return 97
}
rm() {
  [[ "$1 $2" == '-rf --' && "$3" == "$work" ]] || return 98
  printf 'attempted\n' > "$TEST_STATE/removal-attempt"
  [[ "$TEST_REMOVAL_FAILURE" == 0 ]] || return 55
}
'''
            harness += source[start:stop]
            harness += ('kill -TERM "$$"\nexit 99\n' if original == 143 else
                        'kill -INT "$$"\nexit 99\n' if original == 130 else
                        'exit ' + str(original) + '\n')
            result = subprocess.run(['bash', '-c', harness],
                                    env={**os.environ, 'TEST_STATE': directory,
                                         'TEST_DRILL_DROP': str(int(drill_drop)),
                                         'TEST_REMOVAL_FAILURE': str(int(removal))},
                                    capture_output=True, text=True, timeout=5)
            self.assertTrue((state / 'removal-attempt').is_file(), result.stderr)
            self.assertEqual((state / 'drop-attempt').exists(), drill_drop)
            if not drill_drop and original:
                self.assertEqual((state / 'writers').read_text(), 'stopped\n')
                self.assertEqual((state / 'checkpoint').read_text(), 'failure ' + str(original) + '\n')
            return result

    def test_failed_temporary_removal_preserves_original_error_and_signals(self):
        for original in (0, 73, 130, 143):
            with self.subTest(original=original):
                result = self.run_cleanup(original, removal=True)
                self.assertEqual(result.returncode, original or 1, result.stderr)
                self.assertIn('Temporary restore files could not be fully removed', result.stderr)

    def test_failed_drill_drop_preserves_original_error_and_signals(self):
        for original in (0, 73, 130, 143):
            with self.subTest(original=original):
                result = self.run_cleanup(original, drill_drop=True)
                self.assertEqual(result.returncode, original or 1, result.stderr)
                self.assertIn('isolated restore-drill database could not be removed', result.stderr)

    def test_both_cleanup_failures_preserve_original_error_and_signals(self):
        for original in (0, 73, 130, 143):
            with self.subTest(original=original):
                result = self.run_cleanup(original, removal=True, drill_drop=True)
                self.assertEqual(result.returncode, original or 1, result.stderr)
                self.assertIn('isolated restore-drill database could not be removed', result.stderr)
                self.assertIn('Temporary restore files could not be fully removed', result.stderr)


if __name__ == '__main__':
    unittest.main()
