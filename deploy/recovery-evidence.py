#!/usr/bin/env python3
"""Emit bounded evidence after a caller has completed its real recovery gate."""
import hashlib
import json
import re
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path


def evidence(operation, archive, started, release, migrations, tables, replay, source):
    if operation not in ('backup', 'verify-only', 'restore-drill', 'restore-replace'):
        raise ValueError('Invalid recovery operation')
    if source not in ('backup-script', 'restore-script', 'native-drill') or replay not in ('true', 'false'):
        raise ValueError('Invalid recovery provenance')
    if not re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', release):
        raise ValueError('Invalid release identifier')
    timestamp = datetime.fromisoformat(started.replace('Z', '+00:00'))
    if timestamp.tzinfo is None or timestamp > datetime.now(timezone.utc):
        raise ValueError('Evidence start time must be an observed past UTC instant')
    archive = Path(archive)
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size <= 0:
        raise ValueError('A nonempty completed encrypted archive is required')
    checksum = hashlib.sha256()
    with archive.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            checksum.update(chunk)
    migration_count, table_count = int(migrations), int(tables)
    if not 1 <= migration_count <= 10000 or not 1 <= table_count <= 10000:
        raise ValueError('Actual database inventory is required')
    if operation.startswith('restore-') and replay != 'true':
        raise ValueError('A restore requires successful independent-ledger replay')
    return {'operation': operation, 'runId': str(uuid.uuid4()), 'success': True,
            'startedAt': timestamp.isoformat(), 'finishedAt': datetime.now(timezone.utc).isoformat(),
            'releaseId': release, 'archiveSha256': checksum.hexdigest(), 'archiveBytes': archive.stat().st_size,
            'migrationCount': migration_count, 'tableCount': table_count, 'privacyReplay': replay == 'true', 'source': source}


if __name__ == '__main__':
    if len(sys.argv) != 9:
        raise SystemExit('Usage: recovery-evidence.py operation archive started release migrations tables replay source')
    print(json.dumps(evidence(*sys.argv[1:])))
