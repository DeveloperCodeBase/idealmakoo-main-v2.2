#!/usr/bin/env python3
"""Bounded, authenticated-payload mail tree packing and staged restoration.

Called only while the operations lock is held and the captured mail writer is
stopped. Runtime sockets/FIFOs are recreated by Postfix, never copied. Relative
symlinks inside the mail tree are supported; escaping/absolute links are refused.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import posixpath
import shutil
import stat
import tarfile
import tempfile

def sibling(name):
    s = importlib.util.spec_from_file_location('maildata_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m

MAX_BYTES = 128 * 1024 ** 3
MAX_MEMBERS = 500000
ROOTS = {'data', 'state', 'logs', 'config', '.idealmakoo-mail.json', 'dns-records.json'}

def validate(path):
    seen = set(); links = set(); files = set(); total = 0
    with tarfile.open(path, 'r:') as archive:
        for i, m in enumerate(archive, 1):
            p = PurePosixPath(m.name); name = p.as_posix()
            if (i > MAX_MEMBERS or p.is_absolute() or '..' in p.parts or not p.parts or p.parts[0] not in ROOTS
                    or '\\' in m.name or any(ord(c) < 32 for c in m.name) or len(m.name) > 1024
                    or name in seen or not (m.isfile() or m.isdir() or m.issym()) or m.issparse()
                    or not 0 <= m.uid <= 65535 or not 0 <= m.gid <= 65535 or m.mode & 0o7000 or m.size < 0):
                raise ValueError('Unsafe mail archive member')
            if m.issym():
                target = posixpath.normpath(posixpath.join(str(p.parent), m.linkname))
                if (not m.linkname or m.linkname.startswith('/') or target == '..' or target.startswith('../')
                        or '\\' in m.linkname or any(ord(c) < 32 for c in m.linkname)):
                    raise ValueError('Mail symbolic link escapes its archive')
                links.add(name)
            if m.isfile(): files.add(name)
            seen.add(name); total += m.size
            if total > MAX_BYTES: raise ValueError('Mail archive size exceeds bound')
    for name in seen:
        if any(p.as_posix() in links | files for p in PurePosixPath(name).parents):
            raise ValueError('A mail link/file cannot be an extraction parent')
    return {'members': len(seen), 'bytes': total}

def pack(root, target):
    root = Path(root)
    if root.resolve() != root or root.is_symlink() or not root.is_dir(): raise ValueError('Unsafe mail backup directory')
    with tarfile.open(target, 'x:') as archive:
        # os.walk never follows links. Every file is opened with fd-anchored
        # no-symlink ancestry using the same source-backup helper.
        helper = sibling('backup-archive')
        for directory, dirs, names in os.walk(root, followlinks=False):
            for name in sorted(dirs + names):
                path = Path(directory) / name; rel = path.relative_to(root); info = path.lstat()
                if rel.parts[0] not in ROOTS: raise ValueError('Unexpected mail persistent root')
                if stat.S_ISSOCK(info.st_mode) or stat.S_ISFIFO(info.st_mode): continue
                member = archive.gettarinfo(str(path), rel.as_posix())
                member.mode &= 0o777; member.uname = ''; member.gname = ''
                if stat.S_ISREG(info.st_mode):
                    # Duplicate hardlinked bytes, never recreate an external link.
                    member.type = tarfile.REGTYPE; member.linkname = ''; member.size = info.st_size
                    fd = helper.open_without_symlink_components(root, rel)
                    with os.fdopen(fd, 'rb') as source:
                        before = os.fstat(source.fileno())
                        if (before.st_dev, before.st_ino) != (info.st_dev, info.st_ino): raise ValueError('Mail file identity changed')
                        archive.addfile(member, source); after = os.fstat(source.fileno())
                        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns): raise ValueError('Mail changed during snapshot')
                else: archive.addfile(member)
    return validate(target)

def extract(path, target):
    validate(path); target = Path(target)
    if target.is_symlink() or target.resolve() != target or not target.is_dir() or any(target.iterdir()): raise ValueError('Use an empty real mail extraction directory')
    directories = []
    with tarfile.open(path, 'r:') as archive:
        for m in archive:
            destination = target / m.name
            destination.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
            if m.isdir(): destination.mkdir(mode=0o700, exist_ok=True); directories.append((destination, m)); continue
            if m.issym(): os.symlink(m.linkname, destination); os.lchown(destination, m.uid, m.gid) if os.geteuid() == 0 else None
            else:
                with destination.open('xb') as output, archive.extractfile(m) as source: shutil.copyfileobj(source, output, 1024 * 1024)
                os.chmod(destination, m.mode & 0o777)
                if os.geteuid() == 0: os.chown(destination, m.uid, m.gid)
    for path, m in reversed(directories):
        os.chmod(path, m.mode & 0o777)
        if os.geteuid() == 0: os.chown(path, m.uid, m.gid)

def snapshot(env_file, payload):
    cfg = sibling('mail-config'); values = cfg.reader.read(env_file); c = cfg.configuration(values)
    target = Path(payload); details = {'format': 1, 'mode': c['mode'], 'included': c['mode'] == 'local'}
    if c['mode'] != 'local':
        retained = Path(values.get('MAIL_DATA_DIR') or str(Path(values.get('INSTALL_ROOT', '/var/www/idealmakoo')) / 'mail-server'))
        if retained.exists() or retained.is_symlink():
            if retained.is_symlink() or not retained.is_dir(): raise ValueError('Unsafe retained mail directory')
            if any(retained.iterdir()):
                # Disabling a service must never silently remove its retained
                # mailbox/queue/keys from the complete website backup.
                c = cfg.configuration({**values, 'MAIL_SERVER_MODE': 'local', 'MAIL_SERVER_ENABLED': 'true'})
                details['included'] = True
    if details['included']:
        marker = Path(c['directory']) / '.idealmakoo-mail.json'
        expected = {'format': 1, 'project': c['project'], 'domain': c['domain'], 'hostname': c['hostname']}
        if marker.is_symlink() or not marker.is_file() or json.loads(marker.read_text()) != expected:
            raise ValueError('Mail data ownership marker differs; refusing an incomplete/unmanaged backup')
        details.update({'project': c['project'], 'domain': c['domain'], 'hostname': c['hostname'], 'image': c['image'],
                        'inventory': pack(c['directory'], target / 'mail.tar')})
    else:
        with tarfile.open(target / 'mail.tar', 'x:'): pass
    (target / 'mail-manifest.json').write_text(json.dumps(details, indent=2) + '\n')

def validate_manifest(payload):
    p = Path(payload); info = p / 'mail-manifest.json'
    if info.stat().st_size > 16384: raise ValueError('Mail manifest exceeds bound')
    value = json.loads(info.read_text())
    if not isinstance(value, dict) or value.get('format') != 1 or value.get('mode') not in {'local','external','off'} or type(value.get('included')) is not bool:
        raise ValueError('Invalid mail manifest')
    inventory = validate(p / 'mail.tar')
    if value['mode'] == 'local' and not value['included']: raise ValueError('Local mail cannot be omitted from a complete backup')
    if value['included']:
        cfg = sibling('mail-config'); cfg.domain(value.get('domain')); cfg.domain(value.get('hostname'))
        if inventory != value.get('inventory') or not isinstance(value.get('project'), str) or not isinstance(value.get('image'), str): raise ValueError('Mail inventory mismatch')
    elif inventory != {'members': 0, 'bytes': 0}: raise ValueError('Unexpected mail data without a declared inventory')
    return value

def restore(env_file, payload, fresh=False):
    p = Path(payload)
    if not (p / 'mail-manifest.json').exists(): return 'historical-no-mail-preserved'
    info = validate_manifest(p)
    if not info['included']: return 'archive-no-mail-preserved'
    cfg = sibling('mail-config'); values = cfg.reader.read(env_file)
    mode = cfg.configuration(values)['mode']
    c = cfg.configuration({**values, 'MAIL_SERVER_MODE': 'local', 'MAIL_SERVER_ENABLED': 'true'})
    if any(c[k] != info[k] for k in ('domain', 'hostname')) or (not fresh and c['project'] != info['project']):
        raise ValueError('Mail recovery requires the matching project/domain; only fresh recovery may select a new project')
    root = Path(c['directory']); root.parent.mkdir(parents=True, exist_ok=True)
    if root.is_symlink() or root.resolve() != root: raise ValueError('Unsafe mail restore directory')
    if fresh and root.exists() and any(root.iterdir()): raise ValueError('Fresh mail recovery refuses existing data')
    stage = Path(tempfile.mkdtemp(prefix='.mail-restore-', dir=root.parent))
    try:
        extract(p / 'mail.tar', stage)
        binding = json.loads((stage / '.idealmakoo-mail.json').read_text())
        expected = {'format': 1, 'project': info['project'], 'domain': c['domain'], 'hostname': c['hostname']}
        if binding != expected: raise ValueError('Mail tree ownership marker differs')
        if fresh and c['project'] != info['project']:
            # The authenticated recovery wrapper permits a distinct project on
            # an empty host. Validate the original binding before rebinding the
            # staged tree; never adopt another existing project's mailbox.
            binding = {**expected, 'project': c['project']}
            cfg.atomic(stage / '.idealmakoo-mail.json', json.dumps(binding) + '\n')
        if not fresh:
            # Preserve current account credentials, revocations and DKIM keys;
            # the full historical config remains available in the encrypted backup.
            if not (root / '.idealmakoo-mail.json').is_file() or json.loads((root / '.idealmakoo-mail.json').read_text()) != binding: raise ValueError('Existing mail ownership marker differs')
            shutil.rmtree(stage / 'config'); shutil.copytree(root / 'config', stage / 'config', symlinks=True)
        retained = root.with_name(root.name + '.before-restore-' + os.urandom(6).hex())
        if root.exists(): os.rename(root, retained)
        try: os.rename(stage, root)
        except BaseException:
            if retained.exists(): os.rename(retained, root)
            raise
        # Do not replay restored outbound queue without an explicit operator
        # decision. Local receiving remains possible after certificate readiness.
        if mode == 'local':
            cfg.prepare(env_file, recovery=True)
        else:
            # Retained mail stays disabled. Preserve the external SMTP settings
            # and ensure a later deliberate reactivation cannot replay the queue.
            cfg.reader.write_changes(env_file, {'MAIL_OUTBOUND_ENABLED': 'false'})
            postfix = root / 'config/postfix-main.cf'
            if postfix.is_symlink() or not postfix.is_file() or not postfix.read_text().startswith(cfg.MARKER):
                raise ValueError('Retained mail has no managed outbound policy')
            lines = [line for line in postfix.read_text().splitlines() if not line.startswith('defer_transports')]
            cfg.atomic(postfix, '\n'.join(lines) + '\ndefer_transports = smtp, relay\n', managed=True)
        return 'restored-outbound-paused-current-mail-grants-preserved' if not fresh else 'restored-outbound-paused'
    finally:
        if stage.exists(): shutil.rmtree(stage)

def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('operation', choices=['snapshot','validate','restore','drill']); p.add_argument('--env-file'); p.add_argument('--payload',required=True); p.add_argument('--fresh',action='store_true'); a=p.parse_args()
    if a.operation == 'snapshot': snapshot(a.env_file,a.payload)
    elif a.operation == 'validate': validate_manifest(a.payload)
    elif a.operation == 'restore': print(restore(a.env_file,a.payload,a.fresh))
    else:
        info=validate_manifest(a.payload)
        with tempfile.TemporaryDirectory(prefix='.mail-drill-',dir=Path(a.payload).parent) as target:
            extract(Path(a.payload)/'mail.tar',target)
            if info['included'] and not (Path(target)/'.idealmakoo-mail.json').is_file(): raise ValueError('Mail drill ownership metadata missing')
        print('Isolated mail archive extraction verified; no SMTP service or delivery started.')

if __name__ == '__main__':
    try: main()
    except (ValueError,OSError,tarfile.TarError) as e: raise SystemExit('Mail data operation stopped: '+(str(e) if isinstance(e,ValueError) else 'check protected storage and archive paths')) from None
