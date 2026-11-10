"""Execute shipped Bash control flow with mocked Compose/lifecycle boundaries.

These tests exercise real installer/restore control flow after the image build,
including a service which starts before its readiness check fails. The lifecycle
helper is explicitly mocked here; its own tests cover real client-process bounds.
Docker and database operations are simulated; the separate Ubuntu VM acceptance runs the
real installer and recovery against Docker. No host service is changed here.
"""
from pathlib import Path
import importlib.util
import os
import json
import shutil
import sys
import re
import subprocess
import tempfile
import unittest

ROOT = Path(os.environ.get('IDEALMAKOO_TEST_SOURCE_ROOT', Path(__file__).resolve().parents[1]))


def shipped_function(source, name):
    found = re.search(r'^' + re.escape(name) + r'\(\) \{\n.*?^\}\n', source,
                      re.MULTILINE | re.DOTALL)
    if not found:
        raise AssertionError('Production cleanup function is missing: ' + name)
    return found.group(0)


class FailureCleanupTests(unittest.TestCase):
    def execute(self, kind, *, health_failure=1, backup_failure=False,
                start_failure=False, stop_failure=False, early_failure=False,
                recovery=False, security_failure=False, previous=False,
                signal_failure=False, mode='restore'):
        filename = 'install-ubuntu.sh' if kind == 'install' else 'restore.sh'
        source = (ROOT / 'scripts' / filename).read_text()
        function = 'installation_finished' if kind == 'install' else 'cleanup'
        handler = shipped_function(source, function)
        # Include the actual shipped trap declarations, including signal status.
        traps = '\n'.join(line for line in source.splitlines()
                          if line.startswith('trap '))
        if kind == 'install':
            lifecycle = source[source.index('if [[ -n "$previous" ]]; then\n'
                                            "  install_phase='pre-upgrade encrypted backup'"):]
        else:
            lifecycle = source[source.index('if (( resume == 0 )); then\n'
                                            '  log "Taking a safety backup'):]

        with tempfile.TemporaryDirectory(prefix='idealmakoo-cleanup-') as directory:
            root = Path(directory)
            app = root / 'installation'
            release = app / 'releases' / 'test-release'
            old = app / 'releases' / 'previous-release'
            for path in (release / 'scripts', release / 'deploy', old / 'scripts',
                         app / 'shared', root / 'work' / 'verified', root / 'payload'):
                path.mkdir(parents=True, exist_ok=True)
            (release / 'scripts' / 'doctor.sh').write_text('# fixture: never executed\n')
            (release / 'deploy' / 'recovery.sh').write_text('# helper operations are simulated\n')
            (release / 'deploy' / 'backup-archive.py').write_text('import sys\nsys.stdin.buffer.read()\n')
            for name in ('privacy-anchor.json', 'caddy-data.tar', 'caddy-config.tar'):
                (root / 'payload' / name).write_text('fixture-input\n')
            (root / 'work' / 'verified' / 'privacy-anchor.json').write_text('{}\n')
            for name in ('database-volume', 'media-volume', 'safety-backup'):
                (root / name).write_bytes(b'preserve-existing-data\n')
            (root / 'writers-running').touch()
            if previous:
                (app / 'current').symlink_to(old)
            health = '''#!/usr/bin/env bash
set -euo pipefail
counter=0
[[ ! -f "$TEST_STATE/health-count" ]] || read -r counter < "$TEST_STATE/health-count"
counter=$((counter + 1))
printf '%s\\n' "$counter" > "$TEST_STATE/health-count"
if [[ "$TEST_SIGNAL_FAILURE" == 1 ]]; then kill -TERM "$PPID"; exit 143; fi
if [[ "$TEST_HEALTH_FAILURE" == "$counter" ]]; then exit 42; fi
'''
            (release / 'scripts' / 'check-health.sh').write_text(health)
            backup = '''#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$0" >> "$TEST_STATE/backup-callers"
if [[ "$TEST_BACKUP_FAILURE" == 1 ]]; then exit 43; fi
printf '%s\\n' "$TEST_STATE/safety-backup"
'''
            (release / 'scripts' / 'backup.sh').write_text(backup)
            (old / 'scripts' / 'backup.sh').write_text('#!/usr/bin/env bash\nprintf historical > \"$TEST_STATE/historical-backup-called\"\nexit 97\n')
            harness = r'''
set -Eeuo pipefail
umask 077
PROJECT_ROOT="$TEST_STATE/installation/releases/test-release"
release_dir="$PROJECT_ROOT"
app_dir="$TEST_STATE/installation"
ENV_FILE="$app_dir/shared/environment"
previous=""
[[ "$TEST_PREVIOUS" != 1 ]] || previous="$app_dir/releases/previous-release"
install_phase=preflight
safety_backup="$TEST_STATE/safety-backup"
stop_writers_on_failure=0
mode="$TEST_MODE"
work="$TEST_STATE/work"
drill_created=0
drill_db=""
restore_list=/tmp/test-restore.list
RESTORE_TOC=""
restore_keys=0
resume=0
checkpoint_owned=0
checkpoint_phase=""
pending_directory="$app_dir/shared/.pending-restore"
recovery_payload=""
[[ "$TEST_RECOVERY" != 1 ]] || recovery_payload="$TEST_STATE/payload"
backup_timer=0
archive="$TEST_STATE/archive.age"
backup_release=test-release
started=test-time
migration_count=40
table_count=1
site_url=http://127.0.0.1:3088
log() { printf '%s\n' "$*" >&2; }
dc() {
  printf '%s\n' "$*" >> "$TEST_STATE/compose-actions"
  case "$1" in
    stop|start) return 91 ;;
    up)
      # Service lifecycle must use its explicit boundary, never raw Compose.
      [[ " $* " != *' app worker proxy '* ]] || return 91
      ;;
    exec|ps) ;;
    --profile) cat >/dev/null ;;
    *) return 92 ;;
  esac
}
# Fake external lifecycle boundary. Actual helper sequencing is tested separately.
lifecycle() {
  printf 'lifecycle %s\n' "$*" >> "$TEST_STATE/compose-actions"
  case "$1" in
    stop)
      [[ "$*" == 'stop --timeout 90 app worker' ]] || return 93
      if [[ "$TEST_STOP_FAILURE" == 1 && -f "$TEST_STATE/health-count" ]]; then return 53; fi
      rm -f -- "$TEST_STATE/writers-running"
      ;;
    up)
      [[ "$*" == 'up --timeout 1200 app worker proxy' ]] || return 94
      touch "$TEST_STATE/writers-running"
      [[ "$TEST_START_FAILURE" != 1 ]] || return 41
      ;;
    *) return 95 ;;
  esac
}
env_get() { printf '%s\n' ''; }
capture_restore_access() { :; }
database_name() { printf '%s\n' idealmakoo; }
restore_database() { :; }
restore_empty_database() { :; }
restore_media_payload() { :; }
privacy_cli() { :; }
apply_restore_security() { [[ "$TEST_SECURITY_FAILURE" != 1 ]] || return 2; }
record_recovery() { :; }
pending_restore() { :; }
'''
            harness += handler + '\n' + traps + '\n'
            harness += 'exit 44\n' if early_failure else lifecycle
            environment = {**os.environ, 'TEST_STATE': directory,
                           'TEST_HEALTH_FAILURE': str(health_failure),
                           'TEST_BACKUP_FAILURE': str(int(backup_failure)),
                           'TEST_START_FAILURE': str(int(start_failure)),
                           'TEST_STOP_FAILURE': str(int(stop_failure)),
                           'TEST_RECOVERY': str(int(recovery)),
                           'TEST_SECURITY_FAILURE': str(int(security_failure)),
                           'TEST_PREVIOUS': str(int(previous)),
                           'TEST_SIGNAL_FAILURE': str(int(signal_failure)),
                           'TEST_MODE': mode}
            process = subprocess.run(['bash', '-c', harness], cwd=root,
                                     env=environment, capture_output=True,
                                     text=True, timeout=15)
            actions_path = root / 'compose-actions'
            result = {
                'status': process.returncode, 'stderr': process.stderr,
                'stdout': process.stdout,
                'running': (root / 'writers-running').exists(),
                'actions': actions_path.read_text().splitlines() if actions_path.exists() else [],
                'historicalBackupCalled': (root / 'historical-backup-called').exists(),
                'backupCallers': (root / 'backup-callers').read_text().splitlines() if (root / 'backup-callers').exists() else [],
            }
            for name in ('database-volume', 'media-volume', 'safety-backup'):
                self.assertEqual((root / name).read_bytes(), b'preserve-existing-data\n', result)
            self.assertFalse(any('down' in command or '--volumes' in command
                                 for command in result['actions']), result)
            return result

    def assert_closed(self, result, status):
        self.assertEqual(result['status'], status, result)
        self.assertFalse(result['running'], result)
        self.assertIn('lifecycle stop --timeout 90 app worker', result['actions'], result)

    def test_fresh_install_stops_already_started_writers_on_first_health_failure(self):
        self.assert_closed(self.execute('install'), 42)

    def test_upgrade_stops_new_writers_after_old_writers_were_stopped(self):
        result = self.execute('install', previous=True)
        self.assert_closed(result, 42)
        self.assertEqual(result['actions'].count('lifecycle stop --timeout 90 app worker'), 2, result)
        self.assertFalse(result['historicalBackupCalled'], result)
        self.assertTrue(result['backupCallers'], result)
        self.assertTrue(all('/test-release/scripts/backup.sh' in path for path in result['backupCallers']), result)

    def test_fresh_host_recovery_stops_writers_on_health_failure(self):
        self.assert_closed(self.execute('install', recovery=True), 42)

    def test_fresh_host_no_active_admin_never_starts_writers(self):
        result = self.execute('install', recovery=True, security_failure=True)
        self.assert_closed(result, 2)
        self.assertFalse(any(command.endswith('app worker proxy')
                             for command in result['actions']), result)

    def test_final_install_health_failure_after_initial_backup_stops_writers(self):
        self.assert_closed(self.execute('install', health_failure=2), 42)

    def test_initial_backup_failure_stops_writers_and_keeps_original_error(self):
        self.assert_closed(self.execute('install', health_failure=0, backup_failure=True), 43)

    def test_same_host_restore_stops_writers_after_final_health_failure(self):
        result = self.execute('restore')
        self.assert_closed(result, 42)
        self.assertEqual(result['actions'].count('lifecycle stop --timeout 90 app worker'), 2, result)

    def test_partial_start_failure_stops_the_started_subset(self):
        for kind in ('install', 'restore'):
            with self.subTest(kind=kind):
                self.assert_closed(self.execute(kind, start_failure=True), 41)

    def test_failure_before_ownership_leaves_existing_writers_running(self):
        for kind, mode in (('install', 'restore'), ('restore', 'restore'),
                           ('restore', 'verify'), ('restore', 'drill')):
            with self.subTest(kind=kind, mode=mode):
                result = self.execute(kind, early_failure=True, mode=mode)
                self.assertEqual(result['status'], 44, result)
                self.assertTrue(result['running'], result)
                self.assertFalse(any(command.startswith(('stop', 'lifecycle stop'))
                                     for command in result['actions']), result)

    def test_success_leaves_validated_writers_running(self):
        for kind in ('install', 'restore'):
            with self.subTest(kind=kind):
                result = self.execute(kind, health_failure=0)
                self.assertEqual(result['status'], 0, result)
                self.assertTrue(result['running'], result)
                self.assertNotIn('Unable to stop', result['stderr'])

    def test_stop_failure_is_reported_without_claiming_writers_stopped(self):
        for kind in ('install', 'restore'):
            with self.subTest(kind=kind):
                result = self.execute(kind, stop_failure=True)
                self.assertEqual(result['status'], 42, result)
                self.assertTrue(result['running'], result)
                self.assertIn('ERROR:', result['stderr'])
                self.assertNotIn('app and worker are stopped', result['stderr'])

    def test_term_signal_during_health_check_closes_writers_and_preserves_143(self):
        for kind in ('install', 'restore'):
            with self.subTest(kind=kind):
                self.assert_closed(self.execute(kind, signal_failure=True), 143)


BACKUP_EXTERNAL = r'''
import json, os, pathlib, shutil, sys
root = pathlib.Path(os.environ['TEST_STATE'])
path = root / 'state.json'
state = json.loads(path.read_text())
kind, *args = sys.argv[1:]
event = {'kind': kind, 'args': args}
state['events'].append(event)
image_ids = {'app': 'sha256:' + '1' * 64, 'proxy': 'sha256:' + '2' * 64, 'db': 'sha256:' + '3' * 64}
retagged_ids = {'app': 'sha256:' + '4' * 64, 'proxy': 'sha256:' + '5' * 64, 'db': 'sha256:' + '6' * 64}
tags = {'fixture/' + service + ':old': service for service in image_ids}
def resolve_image(reference):
    if reference in [*image_ids.values(), *retagged_ids.values()]:
        resolved = reference
    elif reference in tags and state['tagState'] != 'removed':
        source = retagged_ids if state['tagState'] == 'retagged' else image_ids
        resolved = source[tags[reference]]
    else:
        return None
    return None if resolved == image_ids.get(state['missingLocalImage']) else resolved
def finish(code=0):
    path.write_text(json.dumps(state))
    raise SystemExit(code)
if kind == 'lifecycle':
    operation = args[0]
    if operation == 'snapshot':
        assert args[1] == '--output' and args[3:] == ['--timeout', '30']
        if state['snapshotFailure']:
            finish(51)
        snapshot = pathlib.Path(args[2])
        assert not snapshot.exists()
        snapshot.write_text('captured-existing-container-identities')
        snapshot.chmod(0o600)
        state['snapshot'] = str(snapshot)
        state['work'] = str(snapshot).removesuffix('.runtime.json')
    elif operation in ('stop', 'start'):
        expected = ['--snapshot', state['snapshot'], '--timeout', '90' if operation == 'stop' else '1200']
        assert args[1:] == expected
        assert pathlib.Path(state['snapshot']).read_text() == 'captured-existing-container-identities'
        if operation == 'stop':
            state['writers'] = False
        else:
            event['payloadExistsAtResume'] = pathlib.Path(state['work']).exists()
            state['starts'] += 1
            if state['resumeFailure']:
                state['writers'] = False
                finish(55)
            state['writers'] = True
    else:
        finish(90)
elif kind == 'dc':
    if args[:3] == ['ps', '--all', '--quiet']:
        print('fixture-' + args[3])
    elif args[:3] == ['exec', '-T', 'db'] and args[3] == 'sh':
        state['dumps'] += 1
        if state['dumpFailure']:
            finish(44)
        print('fixture-database-dump')
    elif args[:4] == ['exec', '-T', 'db', 'pg_restore']:
        sys.stdin.buffer.read()
    elif args[0] in ('run-existing', '--profile'):
        event['helperImages'] = {}
        for service in ('app', 'proxy'):
            observed = os.environ['IDEALMAKOO_OBSERVED_' + service.upper() + '_IMAGE']
            resolved = resolve_image(observed)
            event['helperImages'][service] = {'observed': observed, 'resolved': resolved}
            assert observed == resolved == image_ids[service]
        print('{}')
    else:
        finish(91)
elif kind == 'docker':
    if args[:2] == ['image', 'inspect']:
        assert args[2] == '--format'
        resolved = resolve_image(args[4])
        event['resolvedImage'] = resolved
        if resolved is None:
            finish(61)
        if args[3].replace(' ', '') == '{{.Id}}':
            mismatch = state['mismatchedLocalImage']
            print(retagged_ids[mismatch] if resolved == image_ids.get(mismatch) else resolved)
        elif '.RepoDigests' in args[3]:
            if state['databaseDigestFailure']:
                finish(62)
            if resolved == image_ids['db']:
                print(json.dumps(state['databaseRepoDigests']))
            elif resolved == retagged_ids['db']:
                print(json.dumps(['fixture/db@sha256:' + 'b' * 64]))
            else:
                finish(92)
        else:
            finish(92)
    elif args[0] == 'inspect' and args[1] == '--format':
        if 'working_dir' in args[2]:
            print(root / 'old-release')
        elif 'com.idealmakoo.release' in args[2]:
            print('old-release')
        elif '.Config.Image' in args[2]:
            print({'fixture-app': 'fixture/app:old', 'fixture-proxy': 'fixture/proxy:old',
                   'fixture-db': state['databaseReference']}[args[3]])
        elif args[2].replace(' ', '') == '{{.Image}}':
            service = args[3].removeprefix('fixture-')
            if state['containerImageFailure'] == service:
                finish(63)
            print(state['containerImageOverrides'].get(service, image_ids[service]))
        else:
            finish(92)
    else:
        finish(93)
elif kind == 'archive':
    if args[0] == 'pack-tree':
        if args[3] == 'source':
            assert pathlib.Path(args[1]) == root / 'old-release'
        pathlib.Path(args[2]).write_text('fixture-payload')
    elif args[0] == 'deployment-manifest':
        state['databaseImage'] = args[4]
        pathlib.Path(args[1]).write_text('{}')
    elif args[0] == 'manifest':
        state['releaseMetadata'] = pathlib.Path(args[1], 'release.env').read_text()
        pathlib.Path(args[1], 'manifest.json').write_text('{}')
    else:
        finish(94)
elif kind == 'rm':
    target = pathlib.Path(args[-1])
    assert target.parent == root / 'backups' and target.name.startswith('.snapshot.')
    if args[:2] == ['-rf', '--']:
        event['targetKind'] = 'work'
        if state['workDeleteFailure']:
            finish(57)
        if target.exists():
            shutil.rmtree(target)
    elif args[:2] == ['-f', '--']:
        event['targetKind'] = 'snapshot'
        if state['snapshotDeleteFailure']:
            finish(58)
        target.unlink(missing_ok=True)
    else:
        finish(95)
else:
    finish(96)
finish()
'''


class BackupCallerTests(unittest.TestCase):
    """Complete shipped backup shell, with external snapshot/archive tools mocked."""
    def execute(self, *, snapshot_failure=False, dump_failure=True, resume_failure=False,
                work_delete_failure=False, snapshot_delete_failure=False,
                tag_state='unchanged', container_image_overrides=None, container_image_failure='',
                missing_local_image='', mismatched_local_image='',
                database_digest='fixture/db@sha256:' + 'a' * 64, database_digest_failure=False,
                database_reference='fixture/db:old', database_repo_digests=None):
        with tempfile.TemporaryDirectory(prefix='idealmakoo-backup-caller-') as temporary:
            root = Path(temporary)
            release = root / 'reviewed-release'
            for directory in (release / 'scripts', release / 'deploy', root / 'bin', root / 'backups',
                              root / 'old-release', root / 'integrations', root / 'ledger'):
                directory.mkdir(parents=True, mode=0o700)
            shutil.copy(ROOT / 'scripts/backup.sh', release / 'scripts/backup.sh')
            shutil.copy(ROOT / 'deploy/env-file.py', release / 'deploy/env-file.py')
            shutil.copy(ROOT / 'deploy/backup-image-reference.py', release / 'deploy/backup-image-reference.py')
            for helper in ('mail-data.py', 'mail-config.py'):
                shutil.copy(ROOT / 'deploy' / helper, release / 'deploy' / helper)
            (root / 'old-release/.release.env').write_text('RELEASE_SHA=old-release\n')
            environment = root / 'environment'
            environment.write_text('COMPOSE_PROJECT_NAME=fixture\nINSTALL_ROOT=' + str(root) + '\nINTEGRATIONS_HOST_DIR=' + str(root / 'integrations')
                                   + '\nPRIVACY_LEDGER_HOST_DIR=' + str(root / 'ledger') + '\n')
            environment.chmod(0o600)
            (root / 'backup-identity.txt').write_text('fixture-only-age-identity')
            (root / 'backup-identity.txt').chmod(0o600)
            (root / 'external.py').write_text(BACKUP_EXTERNAL)
            (release / 'deploy/backup-archive.py').write_text(
                'import os,runpy,sys\nsys.argv[1:1]=["archive"]\nrunpy.run_path(os.environ["TEST_STATE"]+"/external.py",run_name="__main__")\n')
            lib = r'''set -Eeuo pipefail
umask 077
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
ENV_FILE="$TEST_STATE/environment"
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '%s\n' "$*" >&2; }
need() { command -v "$1" >/dev/null; }
require_environment() { :; }
acquire_ops_lock() { :; }
pending_restore() { :; }
env_get() { python3 "$PROJECT_ROOT/deploy/env-file.py" get "$ENV_FILE" "$1" "${2:-}"; }
dc() { python3 "$TEST_STATE/external.py" dc "$@"; }
lifecycle() { python3 "$TEST_STATE/external.py" lifecycle "$@"; }
privacy_cli() { printf '%s\n' '{}'; }
database_inventory() { printf '%s\n' '40|2|2'; }
database_name() { printf '%s\n' fixture; }
record_recovery() { :; }
'''
            (release / 'deploy/lib.sh').write_text(lib)
            for command in ('docker', 'rm'):
                binary = root / 'bin' / command
                binary.write_text('#!/bin/sh\nexec python3 "$TEST_STATE/external.py" ' + command + ' "$@"\n')
                binary.chmod(0o700)
            for command, body in (('age', 'cat'), ('age-keygen', "printf '%s\\n' fixture-recipient")):
                binary = root / 'bin' / command
                binary.write_text('#!/bin/sh\n' + body + '\n')
                binary.chmod(0o700)
            state_path = root / 'state.json'
            state_path.write_text(json.dumps({'writers': True, 'starts': 0, 'dumps': 0, 'events': [],
                'snapshotFailure': snapshot_failure, 'dumpFailure': dump_failure, 'resumeFailure': resume_failure,
                'workDeleteFailure': work_delete_failure, 'snapshotDeleteFailure': snapshot_delete_failure,
                'tagState': tag_state, 'containerImageOverrides': container_image_overrides or {},
                'containerImageFailure': container_image_failure, 'missingLocalImage': missing_local_image,
                'mismatchedLocalImage': mismatched_local_image, 'databaseReference': database_reference,
                'databaseRepoDigests': database_repo_digests if database_repo_digests is not None
                                      else [database_digest] if database_digest else [],
                'databaseDigestFailure': database_digest_failure}))
            result = subprocess.run(['bash', str(release / 'scripts/backup.sh')],
                                    env={**os.environ, 'TEST_STATE': str(root),
                                         'IDEALMAKOO_BACKUP_DIR': str(root / 'backups'),
                                         'IDEALMAKOO_BACKUP_IDENTITY': str(root / 'backup-identity.txt'),
                                         'PATH': str(root / 'bin') + os.pathsep + os.environ['PATH']},
                                    capture_output=True, text=True, timeout=15)
            state = json.loads(state_path.read_text())
            state['status'], state['stderr'] = result.returncode, result.stderr
            state['workExists'] = bool(state.get('work')) and Path(state['work']).exists()
            state['snapshotExists'] = bool(state.get('snapshot')) and Path(state['snapshot']).exists()
            self.assertNotIn('fixture-only-age-identity', result.stdout + result.stderr)
            return state

    def test_snapshot_failure_aborts_before_quiescence_or_dump(self):
        result = self.execute(snapshot_failure=True)
        self.assertEqual(result['status'], 51, result)
        self.assertTrue(result['writers'], result)
        self.assertEqual((result['starts'], result['dumps']), (0, 0), result)
        self.assertEqual([event['args'][0] for event in result['events'] if event['kind'] == 'lifecycle'], ['snapshot'])

    def test_work_deletion_failure_still_resumes_once_and_preserves_original_dump_error(self):
        result = self.execute(work_delete_failure=True)
        self.assertEqual(result['status'], 44, result)
        self.assertEqual(result['starts'], 1, result)
        self.assertTrue(result['writers'] and result['workExists'], result)
        self.assertFalse(result['snapshotExists'], result)
        self.assertIn('Continuing the bounded service resumption', result['stderr'])
        events = result['events']
        removal = next(i for i, event in enumerate(events) if event.get('targetKind') == 'work')
        resume = next(i for i, event in enumerate(events) if event['kind'] == 'lifecycle' and event['args'][0] == 'start')
        self.assertLess(removal, resume)

    def test_normal_resumption_failure_is_not_retried_and_retains_identity_snapshot(self):
        result = self.execute(dump_failure=False, resume_failure=True)
        self.assertEqual(result['status'], 55, result)
        self.assertEqual(result['starts'], 1, result)
        self.assertFalse(result['writers'] or result['workExists'], result)
        self.assertTrue(result['snapshotExists'], result)
        self.assertIn('snapshot is retained', result['stderr'])

    def test_failed_cleanup_resumption_keeps_original_error_and_snapshot(self):
        result = self.execute(resume_failure=True)
        self.assertEqual(result['status'], 44, result)
        self.assertEqual(result['starts'], 1, result)
        self.assertFalse(result['writers'] or result['workExists'], result)
        self.assertTrue(result['snapshotExists'], result)
        resume = next(event for event in result['events'] if event['kind'] == 'lifecycle' and event['args'][0] == 'start')
        self.assertFalse(resume['payloadExistsAtResume'])

    def test_snapshot_delete_failure_does_not_mask_original_error_after_verified_resumption(self):
        result = self.execute(snapshot_delete_failure=True)
        self.assertEqual(result['status'], 44, result)
        self.assertEqual(result['starts'], 1, result)
        self.assertTrue(result['writers'] and result['snapshotExists'], result)
        self.assertFalse(result['workExists'], result)
        self.assertIn('could not be removed after verified resumption', result['stderr'])

    def test_snapshot_failure_and_delete_failure_never_start_preexisting_services(self):
        result = self.execute(snapshot_failure=True, work_delete_failure=True)
        self.assertEqual(result['status'], 51, result)
        self.assertEqual(result['starts'], 0, result)
        self.assertTrue(result['writers'], result)

    def assert_identity_failure_before_quiescence(self, result):
        self.assertEqual(result['status'], 1, result)
        self.assertTrue(result['writers'], result)
        self.assertEqual((result['starts'], result['dumps']), (0, 0), result)
        self.assertEqual([event['args'][0] for event in result['events'] if event['kind'] == 'lifecycle'], ['snapshot'])
        self.assertFalse(result['workExists'] or result['snapshotExists'], result)
        self.assertFalse(any(event['kind'] == 'archive' for event in result['events']), result)

    def assert_original_image_backup(self, result):
        self.assertEqual(result['status'], 0, result)
        self.assertEqual((result['starts'], result['dumps']), (1, 1), result)
        self.assertTrue(result['writers'], result)
        helpers = [event['helperImages'] for event in result['events'] if 'helperImages' in event]
        self.assertTrue(helpers, result)
        for helper in helpers:
            self.assertEqual(helper, {
                'app': {'observed': 'sha256:' + '1' * 64, 'resolved': 'sha256:' + '1' * 64},
                'proxy': {'observed': 'sha256:' + '2' * 64, 'resolved': 'sha256:' + '2' * 64},
            }, result)
        observations = [event for event in result['events']
                        if event['kind'] == 'docker' and event['args'][:2] == ['image', 'inspect']]
        self.assertTrue(observations, result)
        self.assertTrue(all(event['args'][-1].startswith('sha256:') for event in observations), result)
        digest = [event for event in observations if '.RepoDigests' in event['args'][3]]
        self.assertEqual(len(digest), 1, result)
        self.assertEqual(digest[0]['resolvedImage'], 'sha256:' + '3' * 64, result)
        self.assertEqual(result['databaseImage'], 'fixture/db@sha256:' + 'a' * 64, result)
        self.assertEqual(result['releaseMetadata'],
                         'RELEASE_SHA=old-release\nAPP_IMAGE=fixture/app:old\nPROXY_IMAGE=fixture/proxy:old\n', result)
        self.assertFalse(result['workExists'] or result['snapshotExists'], result)

    def test_retagged_images_use_running_ids_and_original_database_digest(self):
        # The tag now resolves to a distinct image/digest while each existing
        # container still runs its original image, as before an upgrade's backup.
        self.assert_original_image_backup(self.execute(dump_failure=False, tag_state='retagged'))

    def test_removed_tags_do_not_prevent_backup_of_existing_container_images(self):
        self.assert_original_image_backup(self.execute(dump_failure=False, tag_state='removed'))

    def test_invalid_or_missing_container_image_identity_never_stops_writers(self):
        for service in ('app', 'proxy', 'db'):
            for observed in ('', 'fixture/image:mutable', 'sha256:' + '1' * 64 + '\nsha256:' + '2' * 64):
                with self.subTest(service=service, observed=observed):
                    result = self.execute(container_image_overrides={service: observed})
                    self.assert_identity_failure_before_quiescence(result)
                    self.assertIn('image identity is invalid', result['stderr'])

    def test_failed_container_image_observation_never_stops_writers(self):
        for service in ('app', 'proxy', 'db'):
            with self.subTest(service=service):
                result = self.execute(container_image_failure=service)
                self.assert_identity_failure_before_quiescence(result)
                self.assertIn('Unable to observe the deployed', result['stderr'])

    def test_missing_or_mismatched_local_image_never_stops_writers(self):
        for service in ('app', 'proxy', 'db'):
            for failure in ('missing_local_image', 'mismatched_local_image'):
                with self.subTest(service=service, failure=failure):
                    self.assert_identity_failure_before_quiescence(self.execute(**{failure: service}))

    def test_database_digest_must_match_repository_and_supported_format(self):
        for digest in ('', 'fixture/db:old', 'sha256:' + '3' * 64,
                       'fixture/db@sha256:' + 'a' * 63,
                       'fixture/db@sha256:' + 'a' * 64 + '\nfixture/db@sha256:' + 'b' * 64):
            with self.subTest(digest=digest):
                result = self.execute(database_digest=digest)
                self.assert_identity_failure_before_quiescence(result)
                self.assertIn('registry digest', result['stderr'])
                self.assertIn('No writers were stopped', result['stderr'])
        long_repository = 'fixture/' + 'r' * 185
        oversized = self.execute(database_reference=long_repository + ':old',
                                 database_digest=long_repository + '@sha256:' + 'a' * 64)
        self.assert_identity_failure_before_quiescence(oversized)
        self.assertIn('at most 255 characters', oversized['stderr'])
        result = self.execute(database_digest_failure=True)
        self.assert_identity_failure_before_quiescence(result)
        self.assertIn("Unable to observe the deployed database image's registry digest", result['stderr'])

    def test_unrelated_synthesized_alias_cannot_change_backup_database_repository(self):
        result = self.execute(dump_failure=False, database_repo_digests=[
            'unused-local-alias@sha256:' + 'a' * 64,
            'docker.io/fixture/db@sha256:' + 'a' * 64,
            'fixture/db@sha256:' + 'a' * 64,
        ])
        self.assert_original_image_backup(result)

    def test_ambiguous_repository_digests_abort_before_quiescence(self):
        result = self.execute(database_repo_digests=[
            'fixture/db@sha256:' + 'a' * 64,
            'docker.io/fixture/db@sha256:' + 'b' * 64,
        ])
        self.assert_identity_failure_before_quiescence(result)
        self.assertIn('explicit repository@sha256 digest', result['stderr'])


class BackupImageReferenceTests(unittest.TestCase):
    """Offline repository identity rules; local metadata never proves publication."""
    @classmethod
    def setUpClass(cls):
        spec = importlib.util.spec_from_file_location('backup_image_reference', ROOT / 'deploy/backup-image-reference.py')
        cls.reference = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cls.reference)

    def test_docker_hub_familiar_and_legacy_names_deduplicate_one_digest(self):
        digest = 'sha256:' + 'a' * 64
        candidates = ['local-alias@' + digest, 'docker.io/library/postgres@' + digest,
                      'index.docker.io/postgres@' + digest, 'postgres@' + digest]
        for source in ('postgres:16', 'library/postgres:16', 'docker.io/postgres:16',
                       'docker.io/library/postgres:16', 'index.docker.io/library/postgres:16'):
            for observed in (candidates, list(reversed(candidates))):
                with self.subTest(source=source, observed=observed):
                    self.assertEqual(self.reference.select_database_reference(source, observed), 'postgres@' + digest)

    def test_foreign_or_similarly_named_repository_cannot_supply_a_digest(self):
        digest = 'sha256:' + 'a' * 64
        for candidate in ('docker.io.evil/library/postgres@', 'evil.example/library/postgres@',
                          'evil/postgres@', 'postgres-other@', 'library/postgres/nested@'):
            with self.subTest(candidate=candidate), self.assertRaisesRegex(ValueError, 'No observed registry digest matches'):
                self.reference.select_database_reference('docker.io/library/postgres:16', [candidate + digest])

    def test_explicit_digest_disambiguates_only_when_observed_in_same_repository(self):
        selected, other = 'sha256:' + 'a' * 64, 'sha256:' + 'b' * 64
        observed = ['fixture/db@' + other, 'index.docker.io/fixture/db@' + selected]
        self.assertEqual(self.reference.select_database_reference('docker.io/fixture/db:old@' + selected, observed),
                         'fixture/db@' + selected)
        for candidates in (['fixture/db@' + other], ['foreign/db@' + selected]):
            with self.subTest(candidates=candidates), self.assertRaisesRegex(ValueError, 'digest is absent'):
                self.reference.select_database_reference('fixture/db@' + selected, candidates)

    def test_registry_ports_and_tagged_references_preserve_repository_identity(self):
        digest = 'sha256:' + 'a' * 64
        source = 'registry.example:5000/team/postgres:Release_16'
        candidate = 'registry.example:5000/team/postgres@' + digest
        self.assertEqual(self.reference.select_database_reference(source, [candidate]), candidate)
        with self.assertRaisesRegex(ValueError, 'No observed registry digest matches'):
            self.reference.select_database_reference(source, ['registry.example/team/postgres@' + digest])

    def test_invalid_deployed_reference_cannot_be_inferred_from_another_repository(self):
        candidates = ['postgres@sha256:' + 'a' * 64]
        for source in ('sha256:' + 'a' * 64, 'a' * 64, '', 'https://registry.example/db',
                       'postgres:bad tag', 'fixture/UPPERCASE:16', 'postgres@sha256:short',
                       'postgres:16\nother:16'):
            with self.subTest(source=source), self.assertRaises(ValueError):
                self.reference.select_database_reference(source, candidates)

    def test_archive_reference_length_bound_applies_to_normalized_result(self):
        digest = 'sha256:' + 'a' * 64
        allowed = 'r' * 183
        self.assertEqual(len(self.reference.select_database_reference(allowed + ':16', [allowed + '@' + digest])), 255)
        too_long = 'r' * 184
        with self.assertRaisesRegex(ValueError, 'at most 255 characters'):
            self.reference.select_database_reference(too_long + ':16', [too_long + '@' + digest])

    def test_malformed_json_and_observation_types_fail_without_echoing_payload(self):
        marker = 'synthetic-private-observation-marker'
        for payload in (marker, 'null', '{}', 'false', '1', json.dumps([marker, 3]), json.dumps([{'ref': marker}])):
            with self.subTest(payload=payload):
                result = subprocess.run([sys.executable, str(ROOT / 'deploy/backup-image-reference.py'), 'postgres:16'],
                                        input=payload, capture_output=True, text=True, timeout=5)
                self.assertEqual(result.returncode, 1, result)
                self.assertEqual(result.stdout, '', result)
                self.assertIn('No writers were stopped', result.stderr)
                self.assertNotIn(marker, result.stdout + result.stderr)

    def test_matching_local_metadata_is_not_treated_as_proof_of_publication(self):
        # Containerd synthesizes this shape even for a never-published build.
        # The offline selector proves repository/content binding only; recovery
        # publication and retention must be established by the operator.
        digest = 'sha256:' + 'a' * 64
        self.assertEqual(self.reference.select_database_reference('local-database:built', ['local-database@' + digest]),
                         'local-database@' + digest)


ROLLBACK_LIFECYCLE = r'''
import json, os, pathlib, sys
root = pathlib.Path(os.environ['TEST_STATE'])
state_path = root / 'state.json'
state = json.loads(state_path.read_text())
args = sys.argv[1:]
assert args[0] == '--root' and args[2] == '--env-file'
assert pathlib.Path(args[3]) == root / 'installation/shared/.env'
selected, operation = pathlib.Path(args[1]), args[4]
event = {'implementation': str(pathlib.Path(__file__).resolve()), 'root': str(selected), 'operation': operation}
state['events'].append(event)
status = 0
if operation == 'stop':
    assert args[5:] == ['--timeout', '90', 'app', 'worker']
    if state['failure'] == 'stop' and selected.name == 'old-release':
        status = 53
    else:
        state['writers'] = False
elif operation == 'up':
    assert args[5:] == ['--timeout', '1200', 'app', 'worker', 'proxy'] and selected.name == 'old-release'
    state['writers'] = True
    if state['failure'] in ('up', 'stop'):
        status = 51
elif operation == 'check':
    assert args[5:] == ['--timeout', '240'] and selected.name == 'old-release'
    if state['failure'] == 'health':
        status = 42
else:
    status = 91
state_path.write_text(json.dumps(state))
raise SystemExit(status)
'''


class RollbackCallerTests(unittest.TestCase):
    """Real rollback branch/trap and lib wrapper; external lifecycle is mocked."""
    def execute(self, failure=''):
        source = (ROOT / 'scripts/update.sh').read_text()
        branch = source[source.index('if [[ -n "$rollback_dir" ]]; then\n'):]
        with tempfile.TemporaryDirectory(prefix='idealmakoo-rollback-caller-') as temporary:
            root = Path(temporary)
            app = root / 'installation'
            current, old = app / 'releases/current-release', app / 'releases/old-release'
            for path in (current / 'scripts', current / 'deploy', old / 'deploy', app / 'shared'):
                path.mkdir(parents=True, mode=0o700)
            shutil.copy(ROOT / 'deploy/lib.sh', current / 'deploy/lib.sh')
            (current / 'deploy/service-lifecycle.py').write_text(ROLLBACK_LIFECYCLE)
            (old / 'deploy/lib.sh').write_text('printf historical > "$TEST_STATE/old-lib-sourced"\nexit 98\n')
            (old / 'deploy/compose.py').write_text('# Historical configuration selected by the mocked external helper.\n')
            (old / 'docker-compose.yml').write_text('services: {}\n')
            (old / '.release.env').write_text('RELEASE_SHA=old-release\n')
            environment = app / 'shared/.env'
            environment.write_text('COMPOSE_PROJECT_NAME=fixture\n')
            environment.chmod(0o600)
            (app / 'current').symlink_to(current)
            (app / 'previous').symlink_to(old)
            for name in ('database', 'media', 'safety-backup'):
                (root / name).write_text('preserve-existing-data')
            (current / 'scripts/backup.sh').write_text('#!/bin/sh\n[ "$TEST_FAILURE" != backup ] || exit 43\nprintf "%s\\n" "$TEST_STATE/safety-backup"\n')
            state_path = root / 'state.json'
            state_path.write_text(json.dumps({'writers': True, 'failure': failure, 'events': []}))
            # The unchanged CLI/operator preflight is not duplicated here. This
            # runs the actual selected branch and its EXIT handler after it.
            harness = r'''set -Eeuo pipefail
source "$TEST_STATE/installation/releases/current-release/deploy/lib.sh"
app_dir="$TEST_STATE/installation"
rollback_dir="$app_dir/releases/old-release"
schema_compatible=1
''' + branch
            result = subprocess.run(['bash', '-c', harness], cwd=root,
                                    env={**os.environ, 'TEST_STATE': str(root), 'TEST_FAILURE': failure,
                                         'IDEALMAKOO_ENV_FILE': str(environment)},
                                    capture_output=True, text=True, timeout=15)
            state = json.loads(state_path.read_text())
            state.update(status=result.returncode, stderr=result.stderr,
                         current=(app / 'current').resolve().name, previous=(app / 'previous').resolve().name)
            self.assertFalse((old / 'deploy/service-lifecycle.py').exists())
            self.assertFalse((root / 'old-lib-sourced').exists(), state)
            for event in state['events']:
                self.assertEqual(event['implementation'], str(current / 'deploy/service-lifecycle.py'), state)
            for name in ('database', 'media', 'safety-backup'):
                self.assertEqual((root / name).read_text(), 'preserve-existing-data', state)
            return state

    def test_old_release_without_helper_uses_current_pinned_implementation(self):
        result = self.execute()
        self.assertEqual(result['status'], 0, result)
        self.assertEqual((result['current'], result['previous']), ('old-release', 'current-release'), result)
        self.assertTrue(result['writers'], result)
        self.assertEqual([(Path(e['root']).name, e['operation']) for e in result['events']],
                         [('current-release', 'stop'), ('old-release', 'up'), ('old-release', 'check')])

    def test_failed_start_or_health_keeps_pointers_and_stops_selected_historical_writers(self):
        for failure, status in (('up', 51), ('health', 42)):
            with self.subTest(failure=failure):
                result = self.execute(failure)
                self.assertEqual(result['status'], status, result)
                self.assertEqual((result['current'], result['previous']), ('current-release', 'old-release'), result)
                self.assertFalse(result['writers'], result)
                self.assertEqual((Path(result['events'][-1]['root']).name, result['events'][-1]['operation']), ('old-release', 'stop'))

    def test_backup_failure_does_not_stop_existing_writers_or_change_pointers(self):
        result = self.execute('backup')
        self.assertEqual(result['status'], 43, result)
        self.assertTrue(result['writers'], result)
        self.assertEqual(result['events'], [], result)
        self.assertEqual((result['current'], result['previous']), ('current-release', 'old-release'), result)

    def test_cleanup_stop_failure_preserves_original_status_and_reports_no_false_shutdown(self):
        result = self.execute('stop')
        self.assertEqual(result['status'], 51, result)
        self.assertTrue(result['writers'], result)
        self.assertEqual((result['current'], result['previous']), ('current-release', 'old-release'), result)
        self.assertIn('writer shutdown could not be verified', result['stderr'])
        self.assertNotIn('app and worker are stopped', result['stderr'])


if __name__ == '__main__':
    unittest.main()
