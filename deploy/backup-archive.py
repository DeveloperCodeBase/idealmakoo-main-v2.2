#!/usr/bin/env python3
"""Bounded format2/format3 payload validation and safe portable recovery helpers.

The current privacy ledger is never replaced by ordinary restore. A format3
copy exists for explicit recovery onto an empty host only. The age decryption
identity remains outside the archive and also authenticates format3 manifests.
"""
import hashlib
import importlib.util
import hmac
import json
import os
import re
import shutil
import stat
import sys
import tarfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath

PAYLOAD = ('database.dump', 'storage.tar', 'environment.env', 'release.env', 'privacy-anchor.json')
ALLOWED = {*PAYLOAD, 'manifest.json'}
COMPLETE_PAYLOAD = (*PAYLOAD, 'source.tar', 'integrations.tar', 'privacy-ledger.tar', 'caddy-data.tar',
                    'caddy-config.tar', 'database-inventory.json', 'deployment.json')
COMPLETE_ALLOWED = {*COMPLETE_PAYLOAD, 'manifest.json'}
MAIL_PAYLOAD = (*COMPLETE_PAYLOAD, 'mail.tar', 'mail-manifest.json')
MAIL_ALLOWED = {*MAIL_PAYLOAD, 'manifest.json'}
MAX_BYTES = 128 * 1024 ** 3
MAX_STORAGE_MEMBERS = 200000


def preflight_decryption(path, target):
    """Reserve room before age writes plaintext, while live writers still run."""
    source, directory = Path(path), Path(target)
    info = source.lstat()
    if not stat.S_ISREG(info.st_mode) or not 1 <= info.st_size <= MAX_BYTES + 256 * 1024 ** 2:
        raise ValueError('Encrypted backup must be a bounded regular file without symlinks')
    if not directory.is_dir() or directory.is_symlink() or directory.resolve() != directory:
        raise ValueError('Use a private real directory for backup verification')
    # age performs encryption, not compression: ciphertext size is a safe upper
    # bound for its plaintext. Keep room for that tar and its extracted payload.
    if info.st_size * 2 + 64 * 1024 ** 2 > shutil.disk_usage(directory).free:
        raise ValueError('Not enough free disk for decryption and verified payload; keep at least twice the archive size plus 64 MiB free')


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def privacy_anchor(path):
    if Path(path).stat().st_size > 16384:
        raise ValueError('Privacy anchor is too large')
    value = json.loads(Path(path).read_text())
    if (not isinstance(value, dict) or set(value) != {'format', 'fingerprint', 'sequence', 'hash'}
            or value['format'] != 1 or type(value['sequence']) is not int or value['sequence'] < 0
            or any(not isinstance(value[key], str) or not re.fullmatch(r'[a-f0-9]{64}', value[key]) for key in ('fingerprint', 'hash'))):
        raise ValueError('A complete external privacy ledger anchor is mandatory')
    return value


def validate_storage(path, limit=MAX_BYTES, required=None):
    seen, regular, directories, total = set(), set(), set(), 0
    with tarfile.open(path, 'r:') as archive:
        for index, member in enumerate(archive, 1):
            name = PurePosixPath(member.name)
            canonical = name.as_posix()
            if (index > MAX_STORAGE_MEMBERS or name.is_absolute() or '..' in name.parts
                    or '\\' in member.name or any(ord(char) < 32 for char in member.name) or len(member.name) > 1024
                    or not (member.isdir() or member.isfile()) or member.issparse()
                    or member.size < 0 or canonical in seen
                    or canonical == '.' and not member.isdir()):
                raise ValueError('Unsafe storage archive member')
            if any(parent.as_posix() in regular for parent in name.parents):
                raise ValueError('A storage file cannot be a parent directory')
            if member.isfile():
                if canonical in directories:
                    raise ValueError('A storage file conflicts with a directory')
                regular.add(canonical)
            directories.update(parent.as_posix() for parent in name.parents)
            if member.isdir():
                directories.add(canonical)
            seen.add(canonical)
            total += member.size
            if total > limit:
                raise ValueError('Storage archive exceeds the reviewed size bound')
    if required and not set(required) <= regular:
        raise ValueError('Required archive contents are missing')
    return {'files': len(regular), 'bytes': total}


def metadata(target, identity=None):
    target = Path(target)
    manifest_path = target / 'manifest.json'
    if manifest_path.stat().st_size > 65536:
        raise ValueError('Manifest is too large')
    manifest = json.loads(manifest_path.read_text())
    if isinstance(manifest, dict) and manifest.get('format') in (3, 4):
        return complete_metadata(target, identity, manifest)
    if (not isinstance(manifest, dict) or manifest.get('format') != 2
            or set(manifest.get('sha256', {})) != set(PAYLOAD)
            or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', str(manifest.get('release', '')))
            or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,39}', str(manifest.get('project', '')))):
        raise ValueError('Unknown backup format; an external privacy anchor is required')
    inventory = manifest.get('schema', {})
    if (not isinstance(inventory, dict) or set(inventory) != {'migrationCount', 'publicRelations'}
            or any(type(inventory[key]) is not int or not 1 <= inventory[key] <= 10000 for key in inventory)):
        raise ValueError('Backup schema inventory is missing or invalid')
    for name in PAYLOAD:
        if digest(target / name) != manifest['sha256'][name]:
            raise ValueError('Checksum failed for ' + name)
    if privacy_anchor(target / 'privacy-anchor.json') != manifest.get('privacyAnchor'):
        raise ValueError('Manifest privacy anchor mismatch')
    validate_storage(target / 'storage.tar')
    return manifest


def unpack(path, target, identity=None):
    target = Path(target)
    if target.is_symlink() or not target.is_dir() or any(target.iterdir()):
        raise ValueError('Use a new empty extraction directory')
    with tarfile.open(path, 'r:') as archive:
        members = []
        for member in archive:
            members.append(member)
            if len(members) > len(MAIL_ALLOWED):
                raise ValueError('Unexpected backup contents')
        names = {m.name for m in members}
        if names not in (ALLOWED, COMPLETE_ALLOWED, MAIL_ALLOWED) or len(members) != len(names):
            raise ValueError('Unexpected backup contents')
        if sum(member.size for member in members) > MAX_BYTES:
            raise ValueError('Backup exceeds the reviewed size bound')
        if sum(member.size for member in members) + 64 * 1024 ** 2 > shutil.disk_usage(target).free:
            raise ValueError('Not enough free disk to safely verify this backup')
        for member in members:
            limit = 65536 if member.name in ('manifest.json', 'privacy-anchor.json', 'deployment.json') else 32 * 1024 ** 2 if member.name == 'database-inventory.json' else 2 * 1024 ** 2 if member.name.endswith('.env') else MAX_BYTES
            if not member.isfile() or member.issparse() or member.size < 0 or member.size > limit:
                raise ValueError('Links, non-regular files and oversized metadata are forbidden')
        for member in members:
            file = archive.extractfile(member)
            assert file is not None
            with (target / member.name).open('xb') as out:
                for chunk in iter(lambda: file.read(1024 * 1024), b''):
                    out.write(chunk)
    value = metadata(target, identity)
    expected_members = MAIL_ALLOWED if value['format'] == 4 else COMPLETE_ALLOWED if value['format'] == 3 else ALLOWED
    if names != expected_members:
        # A legacy unsigned manifest must never authenticate additional source
        # files from a format3-shaped outer archive (a downgrade attack).
        raise ValueError('Outer archive members do not match the authenticated manifest format')
    return value


def manifest(target, release, project, migrations, relations, identity=None):
    target = Path(target)
    validate_storage(target / 'storage.tar')
    payload = MAIL_PAYLOAD if identity and (target / 'mail-manifest.json').exists() else COMPLETE_PAYLOAD if identity else PAYLOAD
    data = {'format': 4 if payload == MAIL_PAYLOAD else 3 if identity else 2, 'createdAt': datetime.now(timezone.utc).isoformat(), 'release': release,
            'project': project, 'sha256': {name: digest(target / name) for name in payload},
            'schema': {'migrationCount': int(migrations), 'publicRelations': int(relations)},
            'privacyAnchor': privacy_anchor(target / 'privacy-anchor.json')}
    if identity:
        data['authentication'] = {'algorithm': 'HMAC-SHA256-age-identity-v1', 'value': manifest_mac(data, identity)}
    (target / 'manifest.json').write_text(json.dumps(data, indent=2) + '\n')
    metadata(target, identity)


def restore_policy(target, identity=None, allow_legacy=False):
    """Current restore authenticates the sender; historical data needs opt-in."""
    if type(allow_legacy) is not bool:
        raise ValueError('Legacy recovery selection must be explicit')
    value = metadata(target, identity)
    if value['format'] == 2 and not allow_legacy:
        raise ValueError('Unsigned historical format2 requires --allow-legacy-format2 and independent source verification')
    return value


def extract_storage(path, target, executable=False):
    target = Path(target)
    if target.is_symlink() or not target.is_dir() or any(target.iterdir()):
        raise ValueError('Use a new empty storage extraction directory')
    validate_storage(path)
    with tarfile.open(path, 'r:') as archive:
        for member in archive:
            destination = target / PurePosixPath(member.name)
            if member.isdir():
                destination.mkdir(mode=0o700, parents=True, exist_ok=True)
            else:
                destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                source = archive.extractfile(member)
                assert source is not None
                with destination.open('xb') as out:
                    expected = hashlib.sha256()
                    for chunk in iter(lambda: source.read(1024 * 1024), b''):
                        out.write(chunk)
                        expected.update(chunk)
                destination.chmod(0o750 if executable and member.mode & 0o111 else 0o600)
                if digest(destination) != expected.hexdigest():
                    raise ValueError('Extracted file checksum differs from the authenticated archive')


def verify_storage_stream(path):
    expected = {}
    with tarfile.open(path, 'r:') as archive:
        for member in archive:
            if not member.isfile():
                continue
            source = archive.extractfile(member)
            checksum = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                checksum.update(chunk)
            expected[PurePosixPath(member.name).as_posix()] = (member.size, checksum.hexdigest())
    seen = set()
    with tarfile.open(fileobj=sys.stdin.buffer, mode='r|') as archive:
        for index, member in enumerate(archive, 1):
            name = PurePosixPath(member.name).as_posix()
            if index > MAX_STORAGE_MEMBERS or name.startswith('/') or '..' in PurePosixPath(name).parts or not (member.isdir() or member.isfile()):
                raise ValueError('Unsafe restored storage member')
            if member.isdir():
                continue
            if name in seen or name not in expected or member.size != expected[name][0]:
                raise ValueError('Restored storage file inventory differs from the authenticated backup')
            seen.add(name)
            source = archive.extractfile(member)
            checksum = hashlib.sha256()
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                checksum.update(chunk)
            if checksum.hexdigest() != expected[name][1]:
                raise ValueError('Restored storage file bytes differ from the authenticated backup')
    if seen != set(expected):
        raise ValueError('Files are missing from restored storage')


def identity_key(path):
    file = Path(path)
    info = file.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) & 0o077
            or info.st_size > 16384):
        raise ValueError('Use a private regular external age identity with mode600')
    keys = [line.strip() for line in file.read_text().splitlines() if line.startswith('AGE-SECRET-KEY-1')]
    if len(keys) != 1 or not re.fullmatch(r'AGE-SECRET-KEY-1[0-9A-Z]{50,100}', keys[0]):
        raise ValueError('One unencrypted native age identity is required for manifest authentication')
    return hashlib.sha256(b'idealmakoo-complete-backup-v1\x00' + keys[0].encode('ascii')).digest()


def manifest_mac(value, identity):
    body = {key: val for key, val in value.items() if key != 'authentication'}
    canonical = json.dumps(body, ensure_ascii=True, sort_keys=True, separators=(',', ':')).encode()
    return hmac.new(identity_key(identity), canonical, hashlib.sha256).hexdigest()


def database_inventory(path):
    if Path(path).stat().st_size > 32 * 1024 ** 2:
        raise ValueError('Database inventory is oversized')
    data = json.loads(Path(path).read_text())
    if not isinstance(data, dict) or data.get('format') != 1 or not isinstance(data.get('relations'), list) or not 1 <= len(data['relations']) <= 10000:
        raise ValueError('Invalid database object inventory')
    if not re.fullmatch(r'[a-f0-9]{64}', str(data.get('structureSha256', ''))):
        raise ValueError('Missing database structural fingerprint')
    names = set()
    for relation in data['relations']:
        if (not isinstance(relation, dict) or set(relation) != {'name', 'kind', 'rows', 'sha256'}
                or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', str(relation['name']))
                or relation['name'] in names or relation['kind'] not in ('r', 'p', 'v', 'm')
                or type(relation['rows']) is not int or relation['rows'] < 0
                or not re.fullmatch(r'[a-f0-9]{64}', str(relation['sha256']))):
            raise ValueError('Invalid relation fingerprint')
        names.add(relation['name'])
    if data.get('totalRows') != sum(item['rows'] for item in data['relations']):
        raise ValueError('Invalid database row inventory')
    if not isinstance(data.get('migrations'), list) or not data['migrations']:
        raise ValueError('Missing migration checksum inventory')
    migration_names = set()
    for migration in data['migrations']:
        if (not isinstance(migration, dict) or set(migration) != {'name', 'checksum'}
                or not re.fullmatch(r'[0-9]{3}_[A-Za-z0-9_]+\.sql', str(migration['name']))
                or migration['name'] in migration_names
                or not re.fullmatch(r'[a-f0-9]{64}', str(migration['checksum']))):
            raise ValueError('Invalid migration checksum inventory')
        migration_names.add(migration['name'])
    if not isinstance(data.get('sequences'), list):
        raise ValueError('Missing sequence inventory')
    sequence_names = set()
    for sequence in data['sequences']:
        if (not isinstance(sequence, dict) or set(sequence) != {'name', 'last_value', 'is_called'}
                or not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', str(sequence.get('name', '')))
                or sequence['name'] in sequence_names
                or not re.fullmatch(r'-?[0-9]{1,20}', str(sequence['last_value']))
                or type(sequence['is_called']) is not bool):
            raise ValueError('Invalid sequence state inventory')
        sequence_names.add(sequence['name'])
    return data


def complete_metadata(target, identity, value):
    if identity is None:
        raise ValueError('Complete backups require the external age identity to verify authenticity')
    authentication = value.get('authentication', {})
    if (not isinstance(authentication, dict)
            or authentication.get('algorithm') != 'HMAC-SHA256-age-identity-v1'
            or not isinstance(authentication.get('value'), str)
            or not hmac.compare_digest(authentication['value'], manifest_mac(value, identity))):
        raise ValueError('Complete backup manifest authentication failed')
    payload = MAIL_PAYLOAD if value.get('format') == 4 else COMPLETE_PAYLOAD
    if (set(value.get('sha256', {})) != set(payload)
            or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', str(value.get('release', '')))
            or not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,39}', str(value.get('project', '')))):
        raise ValueError('Invalid complete backup metadata')
    for name in payload:
        if digest(target / name) != value['sha256'][name]:
            raise ValueError('Checksum failed for ' + name)
    if privacy_anchor(target / 'privacy-anchor.json') != value.get('privacyAnchor'):
        raise ValueError('Manifest privacy anchor mismatch')
    validate_storage(target / 'storage.tar')
    validate_storage(target / 'source.tar', 512 * 1024 ** 2,
                     ['package.json', 'package-lock.json', 'Dockerfile', 'docker-compose.yml',
                      'scripts/install-ubuntu.sh', 'scripts/restore.sh', 'deploy/backup-archive.py'])
    validate_storage(target / 'integrations.tar', 64 * 1024 ** 2)
    validate_storage(target / 'privacy-ledger.tar', 34 * 1024 ** 2, ['identity.json', 'erasures.jsonl'])
    validate_storage(target / 'caddy-data.tar', 2 * 1024 ** 3)
    validate_storage(target / 'caddy-config.tar', 2 * 1024 ** 3)
    if value.get('format') == 4:
        spec = importlib.util.spec_from_file_location('backup_mail_data', Path(__file__).with_name('mail-data.py'))
        mail = importlib.util.module_from_spec(spec); spec.loader.exec_module(mail)
        mail_info = mail.validate_manifest(target)
        if mail_info['included'] and mail_info['project'] != value['project']:
            raise ValueError('Mail project differs from authenticated backup')
    inventory = database_inventory(target / 'database-inventory.json')
    schema = value.get('schema', {})
    if schema != {'migrationCount': len(inventory['migrations']), 'publicRelations': len(inventory['relations'])}:
        raise ValueError('Database object inventory does not match the complete manifest')
    deployment = json.loads((target / 'deployment.json').read_text())
    if (not isinstance(deployment, dict) or deployment.get('format') != 1
            or deployment.get('release') != value['release'] or deployment.get('project') != value['project']
            or not re.fullmatch(r'[a-zA-Z0-9._:/@-]{1,255}', str(deployment.get('databaseImage', '')))):
        raise ValueError('Deployment identity does not match the complete manifest')
    with tarfile.open(target / 'source.tar', 'r:') as source:
        members = {PurePosixPath(item.name).as_posix(): item for item in source if item.isfile()}
        packaged = sorted(name for name in members if re.fullmatch(r'db/migrations/[0-9]{3}_[A-Za-z0-9_]+\.sql', name))
        expected = sorted('db/migrations/' + item['name'] for item in inventory['migrations'])
        if packaged != expected:
            raise ValueError('Source migrations differ from the deployed database; use the actual matching release')
        for migration in inventory['migrations']:
            stream = source.extractfile(members['db/migrations/' + migration['name']])
            if not stream or hashlib.sha256(stream.read()).hexdigest() != migration['checksum']:
                raise ValueError('Source migration checksum differs from the deployed database')
    return value


SOURCE_ROOTS = {'src', 'public', 'worker', 'scripts', 'deploy', 'db', 'tests', 'docs', '.github'}
SOURCE_FILES = {'README.md', 'SECURITY.md', 'package.json', 'package-lock.json', 'Dockerfile', 'docker-compose.yml',
                '.dockerignore', '.env.example', '.gitignore', 'next.config.ts', 'next-env.d.ts', 'tsconfig.json',
                'tailwind.config.ts', 'postcss.config.mjs', 'playwright.config.ts', 'vitest.config.ts', 'LICENSE', 'LICENSE.md', 'NOTICE'}
EXCLUDED_PARTS = {'node_modules', '.git', '.next', 'out', 'dist', 'coverage', 'test-results', 'playwright-report',
                  'tmp', 'temp', 'qa-artifacts', 'deliverables', 'storage', 'privacy-ledger', 'integrations', 'backups',
                  'shared', 'releases', '__pycache__', '.openai', '.sites-runtime'}
EXCLUDED_SUFFIXES = {'.log', '.pem', '.key', '.age', '.dump', '.pyc', '.db', '.sqlite', '.tsbuildinfo', '.zip', '.tgz', '.gz', '.7z'}
# Reviewed lossless lighting asset required by the production renderer. This
# exact relative path is the only source-archive exception; secrets and other
# gzip/archive files remain excluded, and normal link/identity checks still run.
COMPRESSED_PUBLIC_ASSETS = {'public/media/environment/blue-lagoon-1k.hdr.gz'}


def open_without_symlink_components(root, relative):
    """Anchor every directory lookup to an fd, including absolute ancestors.

    O_NOFOLLOW on only the final file would still permit an intermediate
    directory swapped for a symlink between enumeration and opening.
    """
    directory = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for component in (*root.parts[1:], *relative.parts[:-1]):
            following = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory)
            os.close(directory)
            directory = following
        return os.open(relative.name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory)
    finally:
        os.close(directory)


def pack_tree(root, destination, kind):
    root = Path(root)
    if not root.is_dir() or root.is_symlink() or root.resolve() != root:
        raise ValueError('Archive input must be an absolute real directory without symlink components')
    total = 0
    with tarfile.open(destination, 'x:') as archive:
        for path in sorted(root.rglob('*')):
            relative = path.relative_to(root)
            name = relative.as_posix()
            if kind == 'source':
                if (relative.parts[0] not in SOURCE_ROOTS and name not in SOURCE_FILES
                        and not re.fullmatch(r'compose\.[A-Za-z0-9_-]+\.ya?ml', name)):
                    continue
                if (set(relative.parts) & EXCLUDED_PARTS
                        or path.suffix in EXCLUDED_SUFFIXES and name not in COMPRESSED_PUBLIC_ASSETS
                        or path.name in ('.env', '.npmrc', 'backup-identity.txt')
                        or path.name.startswith('.env.') and path.name != '.env.example'):
                    continue
            if kind == 'ledger' and name not in ('identity.json', 'erasures.jsonl'):
                raise ValueError('Unexpected independent privacy ledger file')
            info = path.lstat()
            if path.is_symlink() or not (stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)) or stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
                raise ValueError('Archive inputs cannot contain links or special files')
            if path.is_dir():
                continue
            total += info.st_size
            if total > MAX_BYTES:
                raise ValueError('Archive input exceeds the size bound')
            descriptor = open_without_symlink_components(root, relative)
            with os.fdopen(descriptor, 'rb') as file:
                before = os.fstat(file.fileno())
                if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                        or (info.st_dev, info.st_ino) != (before.st_dev, before.st_ino)):
                    raise ValueError('An archive input changed identity during backup')
                member = tarfile.TarInfo(name)
                member.size = before.st_size
                member.mode = 0o750 if kind == 'source' and before.st_mode & 0o111 else 0o600
                archive.addfile(member, file)
                after = os.fstat(file.fileno())
                if (before.st_ino, before.st_mtime_ns, before.st_size) != (after.st_ino, after.st_mtime_ns, after.st_size):
                    raise ValueError('An input changed during backup; retry after writers stop')
    validate_storage(destination)


def compare_inventory(expected, restored):
    left, right = database_inventory(expected), database_inventory(restored)
    if left != right:
        raise ValueError('Restored database rows, structure, migrations or sequences differ from the authenticated backup')


def deployment_manifest(target, release, project, database_image):
    Path(target).write_text(json.dumps({'format': 1, 'release': release, 'project': project,
                                      'databaseImage': database_image, 'rebuildRequiresInternet': True,
                                      'excludedRebuildableVolumes': ['next-cache', 'clamav-signatures'],
                                      'privacyLedgerRestore': 'empty-new-host-only-current-ledger-never-overwritten'}) + '\n')


def restore_list(source, destination):
    lines = Path(source).read_text().splitlines()
    schema = [line for line in lines if re.match(r'^\d+;\s+\d+\s+\d+\s+SCHEMA - public\s', line)]
    if len(schema) != 1:
        raise ValueError('A public-only dump with one public schema entry is required')
    # Extensions occupy public; skip only redundant CREATE SCHEMA, no data objects.
    Path(destination).write_text('\n'.join(line for line in lines if line not in schema) + '\n')


if __name__ == '__main__':
    try:
        command = sys.argv[1]
        if command == 'manifest' and len(sys.argv) in (7, 8):
            manifest(*sys.argv[2:])
        elif command == 'preflight-decryption' and len(sys.argv) == 4:
            preflight_decryption(*sys.argv[2:])
        elif command == 'unpack' and len(sys.argv) in (4, 5):
            print(unpack(*sys.argv[2:])['release'])
        elif command == 'inventory' and len(sys.argv) in (3, 4):
            value = metadata(*sys.argv[2:])['schema']
            print(str(value['migrationCount']) + '|' + str(value['publicRelations']))
        elif command == 'restore-policy' and len(sys.argv) == 5 and sys.argv[4] in ('0', '1'):
            value = restore_policy(sys.argv[2], sys.argv[3], sys.argv[4] == '1')
            if value['format'] == 2:
                print('Explicit legacy format2 accepted: checksums and recipient encryption do not authenticate its sender. Use only an independently verified historical archive.', file=sys.stderr)
        elif command == 'extract-storage' and len(sys.argv) == 4:
            extract_storage(sys.argv[2], sys.argv[3])
        elif command == 'extract-source' and len(sys.argv) == 4:
            extract_storage(sys.argv[2], sys.argv[3], executable=True)
        elif command == 'verify-storage-stream' and len(sys.argv) == 3:
            verify_storage_stream(sys.argv[2])
            print('Restored media inventory and every file checksum match the authenticated backup.')
        elif command == 'pack-tree' and len(sys.argv) == 5:
            pack_tree(*sys.argv[2:])
        elif command == 'compare-inventory' and len(sys.argv) == 4:
            compare_inventory(*sys.argv[2:])
            print('Database rows, schema, migration checksums and sequence states match the authenticated inventory.')
        elif command == 'deployment-manifest' and len(sys.argv) == 6:
            deployment_manifest(*sys.argv[2:])
        elif command == 'restore-list' and len(sys.argv) == 4:
            restore_list(sys.argv[2], sys.argv[3])
        else:
            raise ValueError('Unknown command or missing schema inventory')
    except (ValueError, OSError, tarfile.TarError) as error:
        raise SystemExit('Backup validation failed: ' + str(error)) from None
