#!/usr/bin/env python3
"""Create fresh installation settings without logging or regenerating live secrets."""
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
from urllib.parse import quote, urlsplit

spec = importlib.util.spec_from_file_location('idealmakoo_env', Path(__file__).with_name('env-file.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def validate(values):
    reader.health_budgets(values)
    reader.runtime_proxy(values)
    reader.mail_mode(values)
    failures = []
    if values.get('COMPOSE_PROJECT_NAME') and not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,39}', values['COMPOSE_PROJECT_NAME']):
        failures.append('COMPOSE_PROJECT_NAME')
    db = values.get('POSTGRES_DB', 'idealmakoo')
    if not re.fullmatch(r'[a-z][a-z0-9_]{0,62}', db):
        failures.append('POSTGRES_DB')
    for name in ('POSTGRES_ADMIN_PASSWORD', 'POSTGRES_APP_PASSWORD', 'POSTGRES_MIGRATION_PASSWORD', 'SESSION_SECRET'):
        if len(values.get(name, '')) < 32:
            failures.append(name)
    if not re.fullmatch(r'[0-9a-fA-F]{64}', values.get('MFA_ENCRYPTION_KEY', '')):
        failures.append('MFA_ENCRYPTION_KEY')
    if values.get('BOOTSTRAP_ADMIN_PASSWORD') and not 12 <= len(values['BOOTSTRAP_ADMIN_PASSWORD']) <= 128:
        failures.append('BOOTSTRAP_ADMIN_PASSWORD')
    for name, role, password_name in [('DATABASE_URL', 'idealmakoo_app', 'POSTGRES_APP_PASSWORD'),
                                      ('MIGRATION_DATABASE_URL', 'idealmakoo_owner', 'POSTGRES_MIGRATION_PASSWORD')]:
        try:
            from urllib.parse import unquote
            parsed = urlsplit(values.get(name, ''))
            if (parsed.scheme not in ('postgres', 'postgresql') or parsed.hostname != 'db' or parsed.port not in (None, 5432)
                    or unquote(parsed.username or '') != role or unquote(parsed.password or '') != values.get(password_name)
                    or parsed.path != '/' + db or parsed.query or parsed.fragment):
                failures.append(name)
        except ValueError:
            failures.append(name)
    for name in ('DEMO_MODE', 'NEXT_PUBLIC_DEMO_MODE'):
        if values.get(name, 'false') != 'false':
            failures.append(name)
    if values.get('NEXT_PUBLIC_DATA_MODE', 'api') != 'api':
        failures.append('NEXT_PUBLIC_DATA_MODE')
    if values.get('STAFF_PROVISIONING_MODE', 'hybrid') not in ('hybrid', 'env', 'panel'):
        failures.append('STAFF_PROVISIONING_MODE')
    for name in ('SITE_URL', 'NEXT_PUBLIC_SITE_URL'):
        try:
            parsed = urlsplit(values.get(name, ''))
            if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
                failures.append(name)
        except ValueError:
            failures.append(name)
    if values.get('NEXT_PUBLIC_SITE_URL', '').rstrip('/') != values.get('SITE_URL', '').rstrip('/'):
        failures.append('NEXT_PUBLIC_SITE_URL')
    if values.get('STAFF_ACCOUNTS_JSON', ''):
        try:
            roster = json.loads(values['STAFF_ACCOUNTS_JSON'])
            if not isinstance(roster, list) or len(roster) > 200:
                failures.append('STAFF_ACCOUNTS_JSON')
        except (ValueError, TypeError):
            failures.append('STAFF_ACCOUNTS_JSON')
    if failures:
        raise ValueError('Review these protected configuration keys: ' + ', '.join(sorted(set(failures))))


def initialize(target, example, source, selections, recovery=False):
    target = Path(target)
    if target.exists() or target.is_symlink():
        raise ValueError('Fresh environment initialization refuses an existing destination')
    defaults = reader.read(example)
    supplied = {}
    if source:
        original = Path(source)
        info = original.stat()
        if not original.is_file() or stat.S_IMODE(info.st_mode) & 0o077:
            raise ValueError('The supplied environment must be a private regular file with mode600')
        supplied = reader.read(original)
    # Required documented defaults can be selected by the installer, while
    # operator service keys and staff roster are retained exactly.
    values = {**defaults, **supplied, **selections}
    if recovery:
        required = ('POSTGRES_ADMIN_PASSWORD', 'POSTGRES_APP_PASSWORD', 'POSTGRES_MIGRATION_PASSWORD',
                    'DATABASE_URL', 'MIGRATION_DATABASE_URL', 'SESSION_SECRET', 'MFA_ENCRYPTION_KEY')
        missing = [name for name in required if not supplied.get(name)]
        if not source or missing:
            raise ValueError('Recovery requires the original protected internal keys and connections: ' + ', '.join(missing))
    values.setdefault('POSTGRES_DB', 'idealmakoo')
    if not values['POSTGRES_DB']:
        values['POSTGRES_DB'] = 'idealmakoo'
    for name in ('POSTGRES_ADMIN_PASSWORD', 'POSTGRES_APP_PASSWORD', 'POSTGRES_MIGRATION_PASSWORD', 'SESSION_SECRET', 'MFA_ENCRYPTION_KEY'):
        if not values.get(name):
            values[name] = secrets.token_hex(32)
    if not recovery and not values.get('BOOTSTRAP_ADMIN_PASSWORD'):
        values['BOOTSTRAP_ADMIN_PASSWORD'] = secrets.token_hex(24)
    for name, role, password_name in [('DATABASE_URL', 'idealmakoo_app', 'POSTGRES_APP_PASSWORD'),
                                      ('MIGRATION_DATABASE_URL', 'idealmakoo_owner', 'POSTGRES_MIGRATION_PASSWORD')]:
        if not values.get(name):
            values[name] = f"postgresql://{role}:{quote(values[password_name], safe='')}@db:5432/{values['POSTGRES_DB']}"
    values.update({'DATABASE_APP_ROLE': 'idealmakoo_app', 'DEMO_MODE': 'false', 'NEXT_PUBLIC_DEMO_MODE': 'false',
                   'NEXT_PUBLIC_DATA_MODE': 'api', 'NEXT_PUBLIC_SITE_URL': values['SITE_URL']})
    validate(values)
    # Preserve original literal lines for secrets/roster (including apostrophes
    # in values); append generated and absent settings with the safe writer.
    content = Path(source).read_text() if source else '# Generated for this installation. Keep mode600; do not commit.\n'
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'w') as file:
            file.write(content.rstrip('\n') + '\n')
            file.flush()
            os.fsync(file.fileno())
        reader.write_changes(target, {name: value for name, value in values.items() if supplied.get(name) != value})
    except BaseException:
        target.unlink(missing_ok=True)
        raise
    print('Recovery configuration validated; original secrets retained.' if recovery else
          'Fresh protected configuration validated; missing internal secrets generated. No secret values were printed.')


if __name__ == '__main__':
    try:
        command, *args = sys.argv[1:]
        if command in ('initialize', 'recover') and len(args) >= 3:
            target, example, source, *pairs = args
            selections = dict(item.split('=', 1) for item in pairs)
            initialize(target, example, source, selections, recovery=command == 'recover')
        elif command == 'validate' and len(args) == 1:
            validate(reader.read(args[0]))
            print('Protected Compose configuration validated.')
        else:
            raise ValueError('Usage: bootstrap-environment.py initialize target example source-or-empty KEY=value... | validate environment')
    except (ValueError, OSError) as error:
        if isinstance(error, ValueError):
            raise SystemExit('Environment initialization failed: ' + str(error)) from None
        raise SystemExit('Environment initialization failed; check protected file paths and permissions') from None
