#!/usr/bin/env python3
"""Durable current-access checkpoint for a same-host restore and explicit retry.

The owner CLI validates the access-policy schema and applies it. This helper
keeps those original bytes private, binds a retry to its original operation,
and publishes the checkpoint durably before any database replacement.
"""
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tempfile
import uuid

MAX_ACCESS = 32 * 1024 * 1024
MAX_ARCHIVE = 128 * 1024 ** 3 + 256 * 1024 ** 2
STATE_KEYS = {'format', 'version', 'project', 'siteFingerprint', 'release',
              'archiveSha256', 'restoreKeys', 'accessSha256', 'captureId',
              'safetyBackup', 'phase', 'createdAt', 'securityAppliedAt',
              'firstFailure', 'lastFailure'}
SHA = re.compile(r'^[a-f0-9]{64}$')
SECURITY_BOOLEANS = {'alreadyApplied', 'accessReconciled', 'ready'}
SECURITY_COUNTS = {'accountsMatched', 'accountsDisabled', 'identityMismatches',
                   'credentialMismatches', 'missingCurrentAccounts', 'groupsDisabled',
                   'membershipsRestored', 'membershipsUnavailable', 'sessionsRevoked',
                   'challengesConsumed', 'enrollmentsCleared', 'recoveryCodesCleared',
                   'staffInvitationsRevoked', 'organizationInvitationsRevoked',
                   'authMessagesCancelled'}


def now():
    return datetime.now(timezone.utc).isoformat()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate checkpoint JSON field')
        result[key] = value
    return result


def timestamp(value):
    if not isinstance(value, str) or len(value) > 40:
        raise ValueError('A checkpoint timestamp is invalid')
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise ValueError('A checkpoint timestamp is invalid') from None
    if parsed.tzinfo is None:
        raise ValueError('A checkpoint timestamp must include its timezone')


def failure_record(value):
    if value is None:
        return
    if not isinstance(value, dict) or set(value) != {'at', 'exitCode', 'phase'} or type(value['exitCode']) is not int or not 1 <= value['exitCode'] <= 255 or value['phase'] not in ('prepared', 'security-applied'):
        raise ValueError('A checkpoint failure record is invalid')
    timestamp(value['at'])


def checked_path(value, directory=False):
    path = Path(os.path.abspath(value))
    if path.resolve(strict=True) != path or path.is_symlink():
        raise ValueError('Checkpoint paths cannot traverse symlinks')
    info = path.stat()
    if directory:
        if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077 or info.st_uid not in (os.geteuid(), 10001):
            raise ValueError('The checkpoint directory must be private and owned by the operator or owner-tool account')
    return path


def read_bytes(value, maximum, private=True):
    path = checked_path(value)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > maximum:
            raise ValueError('Checkpoint input must be one bounded regular file')
        if private and (info.st_mode & 0o077 or info.st_uid not in (os.geteuid(), 10001)):
            raise ValueError('Checkpoint input must be private and owned by the operator or owner-tool account')
        with os.fdopen(descriptor, 'rb', closefd=False) as source:
            body = source.read(maximum + 1)
        if len(body) > maximum:
            raise ValueError('Checkpoint input exceeded its bound while reading')
        return body
    finally:
        os.close(descriptor)


def digest_file(value):
    path = checked_path(value)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= MAX_ARCHIVE:
            raise ValueError('A bounded regular encrypted archive is required')
        digest = hashlib.sha256()
        consumed = 0
        with os.fdopen(descriptor, 'rb', closefd=False) as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                consumed += len(chunk)
                if consumed > MAX_ARCHIVE:
                    raise ValueError('The encrypted archive exceeded its bound while reading')
                digest.update(chunk)
        after = os.fstat(descriptor)
        if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (info.st_size, info.st_mtime_ns, info.st_ctime_ns):
            raise ValueError('The encrypted archive changed during checkpoint verification')
        return digest.hexdigest()
    finally:
        os.close(descriptor)


def context(environment):
    path = checked_path(environment)
    spec = importlib.util.spec_from_file_location('pending_restore_env', Path(__file__).with_name('env-file.py'))
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    values = reader.read(path)
    project = values.get('COMPOSE_PROJECT_NAME', 'idealmakoo')
    site = values.get('SITE_URL', '')
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,39}', project) or not site:
        raise ValueError('The pending restore requires a configured project and site')
    return path.parent / '.pending-restore', project, hashlib.sha256(site.encode()).hexdigest()


def present(path):
    return os.path.lexists(path)


def sync_directory(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_state(directory, state):
    descriptor, temporary = tempfile.mkstemp(prefix='.state-', dir=directory)
    try:
        with os.fdopen(descriptor, 'w') as target:
            os.fchmod(target.fileno(), 0o600)
            json.dump(state, target, sort_keys=True, separators=(',', ':'))
            target.write('\n')
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, directory / 'metadata.json')
        sync_directory(directory)
    finally:
        if os.path.lexists(temporary):
            os.unlink(temporary)


def load(environment):
    directory, project, site = context(environment)
    checked_path(directory, directory=True)
    state = json.loads(read_bytes(directory / 'metadata.json', 64 * 1024), object_pairs_hook=unique_object)
    if not isinstance(state, dict) or set(state) != STATE_KEYS or state.get('format') != 'idealmakoo.pending-restore' or type(state.get('version')) is not int or state['version'] != 1:
        raise ValueError('The pending restore metadata is invalid')
    if state['project'] != project or state['siteFingerprint'] != site:
        raise ValueError('The pending restore belongs to a different configured project or site')
    if state['phase'] not in ('prepared', 'security-applied') or type(state['restoreKeys']) is not bool:
        raise ValueError('The pending restore phase is invalid')
    timestamp(state['createdAt'])
    if state['phase'] == 'prepared':
        if state['securityAppliedAt'] is not None:
            raise ValueError('An uncommitted checkpoint has an invalid security timestamp')
    else:
        timestamp(state['securityAppliedAt'])
    failure_record(state['firstFailure'])
    failure_record(state['lastFailure'])
    if (state['firstFailure'] is None) != (state['lastFailure'] is None):
        raise ValueError('A checkpoint failure history is incomplete')
    if not isinstance(state['release'], str) or not re.fullmatch(r'[A-Za-z0-9._-]+', state['release']):
        raise ValueError('The pending restore release is invalid')
    if any(not isinstance(state[key], str) or not SHA.fullmatch(state[key]) for key in ('archiveSha256', 'accessSha256')):
        raise ValueError('The pending restore fingerprints are invalid')
    backup = state['safetyBackup']
    if not isinstance(backup, dict) or set(backup) != {'path', 'sha256'} or not isinstance(backup['path'], str) or not Path(backup['path']).is_absolute() or not isinstance(backup['sha256'], str) or not SHA.fullmatch(backup['sha256']):
        raise ValueError('The pending restore safety-backup reference is invalid')
    body = read_bytes(directory / 'access.json', MAX_ACCESS)
    if hashlib.sha256(body).hexdigest() != state['accessSha256']:
        raise ValueError('The original current-access checkpoint changed; no historical policy was recaptured')
    access = json.loads(body, object_pairs_hook=unique_object)
    if not isinstance(access, dict) or access.get('format') != 'idealmakoo.restore-access' or type(access.get('version')) is not int or access['version'] != 1 or access.get('captureId') != state['captureId']:
        raise ValueError('The original access checkpoint format or identity is invalid')
    try:
        uuid.UUID(state['captureId'])
    except (ValueError, TypeError, AttributeError):
        raise ValueError('The access capture identity is invalid') from None
    return directory, state


def assert_clear(environment):
    if present(context(environment)[0]):
        raise ValueError('A same-host restore is pending. Keep writers stopped and use the matching restore.sh --resume; the original current-access checkpoint was preserved')


def prepare(environment, archive, release, restore_keys, security, safety_backup):
    assert_clear(environment)
    directory, project, site = context(environment)
    source = checked_path(security, directory=True)
    if set(path.name for path in source.iterdir()) != {'access.json'}:
        raise ValueError('The new access capture directory contains unexpected files')
    body = read_bytes(source / 'access.json', MAX_ACCESS)
    access = json.loads(body, object_pairs_hook=unique_object)
    if not isinstance(access, dict) or access.get('format') != 'idealmakoo.restore-access' or type(access.get('version')) is not int or access['version'] != 1:
        raise ValueError('The owner-tool access capture is invalid')
    capture_id = access.get('captureId')
    try:
        uuid.UUID(capture_id)
    except (ValueError, TypeError, AttributeError):
        raise ValueError('The owner-tool access capture identity is invalid') from None
    if not re.fullmatch(r'[A-Za-z0-9._-]+', release) or restore_keys not in ('0', '1'):
        raise ValueError('The pending restore selection is invalid')
    state = {'format': 'idealmakoo.pending-restore', 'version': 1, 'project': project,
             'siteFingerprint': site, 'release': release,
             'archiveSha256': digest_file(archive), 'restoreKeys': restore_keys == '1',
             'accessSha256': hashlib.sha256(body).hexdigest(), 'captureId': capture_id,
             'safetyBackup': {'path': str(checked_path(safety_backup)), 'sha256': digest_file(safety_backup)},
             'phase': 'prepared', 'createdAt': now(), 'securityAppliedAt': None,
             'firstFailure': None, 'lastFailure': None}
    write_state(source, state)
    # The capture is already fsynced by the owner CLI. Move that same private
    # directory, rather than create a second mutable copy of the access policy.
    if present(directory):
        raise ValueError('A pending restore appeared; no checkpoint was replaced')
    os.rename(source, directory)
    sync_directory(directory.parent)
    sync_directory(source.parent)


def validate_retry(environment, archive, release, restore_keys):
    directory, state = load(environment)
    if state['archiveSha256'] != digest_file(archive) or state['release'] != release or state['restoreKeys'] != (restore_keys == '1') or restore_keys not in ('0', '1'):
        raise ValueError('Resume requires the original authenticated archive, matching release and original --restore-keys selection')
    if digest_file(state['safetyBackup']['path']) != state['safetyBackup']['sha256']:
        raise ValueError('The original safety backup is missing or changed; it was not replaced')
    return directory, state


def mark_security(environment):
    directory, state = load(environment)
    if state['phase'] != 'security-applied':
        state['phase'] = 'security-applied'
        state['securityAppliedAt'] = now()
        write_state(directory, state)


def note_failure(environment, code):
    directory, state = load(environment)
    if not re.fullmatch(r'[0-9]{1,3}', code) or not 1 <= int(code) <= 255:
        raise ValueError('Invalid restore failure status')
    failure = {'at': now(), 'exitCode': int(code), 'phase': state['phase']}
    state['firstFailure'] = state['firstFailure'] or failure
    state['lastFailure'] = failure
    write_state(directory, state)


def clear(environment):
    directory, state = load(environment)
    if state['phase'] != 'security-applied':
        raise ValueError('A restore checkpoint cannot be cleared before security application')
    completed = Path(tempfile.mkdtemp(prefix='.completed-restore-', dir=directory.parent))
    os.rename(directory, completed)
    sync_directory(directory.parent)
    try:
        shutil.rmtree(completed)
        sync_directory(directory.parent)
    except OSError:
        # The durable rename commits a completed, healthy restore. A failure
        # to remove this already-private completed record must not make a
        # successful recovery look like an unresolved replacement operation.
        print('Completed restore checkpoint cleanup was deferred; its private completed record remains in shared.', file=sys.stderr)


def validate_security_output(path, status, require_applied):
    value = json.loads(read_bytes(path, 16 * 1024), object_pairs_hook=unique_object)
    if not isinstance(value, dict) or set(value) != SECURITY_BOOLEANS | SECURITY_COUNTS:
        raise ValueError('Owner restore-security output has an unexpected format')
    if any(type(value[name]) is not bool for name in SECURITY_BOOLEANS) or any(type(value[name]) is not int or not 0 <= value[name] <= 9007199254740991 for name in SECURITY_COUNTS):
        raise ValueError('Owner restore-security output has invalid counts or readiness')
    if status not in ('0', '2') or value['ready'] != (status == '0') or require_applied not in ('0', '1'):
        raise ValueError('Owner restore-security exit status and readiness disagree')
    if require_applied == '1' and (not value['alreadyApplied'] or not value['accessReconciled']):
        raise ValueError('The previously committed restore audit identity is missing; keep writers stopped and preserve the checkpoint')
    print(json.dumps(value, separators=(',', ':')))


def main():
    command, environment, *args = sys.argv[1:]
    if command == 'assert-clear' and not args:
        assert_clear(environment)
    elif command == 'provision-allowed' and not args:
        directory = context(environment)[0]
        if present(directory) and load(environment)[1]['phase'] != 'security-applied':
            raise ValueError('Resume the prepared restore before owner provisioning; original current-access policy is still pending')
    elif command == 'prepare' and len(args) == 5:
        prepare(environment, *args)
    elif command == 'validate-retry' and len(args) == 3:
        print(validate_retry(environment, *args)[1]['phase'])
    elif command == 'security-applied' and not args:
        mark_security(environment)
    elif command == 'failure' and len(args) == 1:
        note_failure(environment, args[0])
    elif command == 'clear' and not args:
        clear(environment)
    elif command == 'validate-security-output' and len(args) == 2:
        validate_security_output(environment, *args)
    else:
        raise ValueError('Invalid pending restore helper command')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except (OSError, ValueError, TypeError, KeyError) as error:
        if isinstance(error, OSError):
            raise SystemExit('Pending restore checkpoint could not be safely accessed; preserve it and the safety backup for recovery') from None
        raise SystemExit('Pending restore checkpoint refused: ' + str(error)) from None
