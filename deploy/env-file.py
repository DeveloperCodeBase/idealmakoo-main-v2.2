#!/usr/bin/env python3
"""Read/edit protected dotenv metadata without evaluating shell expressions."""
import os
import re
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit


def read(path):
    result = {}
    for number, line in enumerate(Path(path).read_text().splitlines(), 1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            raise ValueError(f'Invalid dotenv assignment at line {number}; use one KEY=value per line')
        name, value = line.split('=', 1)
        name, value = name.strip(), value.strip()
        if not re.fullmatch(r'[A-Z][A-Z0-9_]*', name):
            raise ValueError(f'Invalid dotenv key at line {number}')
        if name in result:
            raise ValueError(f'Duplicate dotenv key: {name}')
        if '\x00' in value:
            raise ValueError(f'Invalid dotenv value for {name}')
        if value.startswith(('"', "'")) and (len(value) < 2 or value[-1] != value[0]):
            raise ValueError(f'Unterminated dotenv quote for {name}; multiline values are not supported')
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        else:
            value = re.split(r'\s+#', value, maxsplit=1)[0].rstrip()
        result[name] = value
    return result


def health_budgets(values):
    """Validate Compose-only health durations without evaluating or printing values."""
    settings = {
        'APP_HEALTH_TIMEOUT_SECONDS': (8, 8, 120),
        'APP_HEALTH_START_PERIOD_SECONDS': (45, 45, 600),
        'WORKER_HEALTH_TIMEOUT_SECONDS': (10, 10, 120),
        'WORKER_HEALTH_START_PERIOD_SECONDS': (60, 60, 600),
    }
    selected = {}
    for name, (default, minimum, maximum) in settings.items():
        value = values.get(name) or str(default)
        if not isinstance(value, str) or not re.fullmatch(r'[1-9][0-9]{0,2}', value) or not minimum <= int(value) <= maximum:
            raise ValueError(f'{name} must be a whole number of seconds from {minimum} through {maximum}')
        selected[name] = value
    for service in ('APP', 'WORKER'):
        start = service + '_HEALTH_START_PERIOD_SECONDS'
        timeout = service + '_HEALTH_TIMEOUT_SECONDS'
        if int(selected[start]) < int(selected[timeout]):
            raise ValueError(f'{start} must be at least {timeout}')
    return selected


def mail_mode(values):
    """Resolve explicit managed-mail selection; never enable it by default."""
    mode = values.get('MAIL_SERVER_MODE') or 'external'
    if mode == 'auto':
        mode = 'external'
    enabled = values.get('MAIL_SERVER_ENABLED') or ''
    if enabled not in {'', 'true', 'false'}:
        raise ValueError('MAIL_SERVER_ENABLED must be blank, true or false')
    if enabled == 'true':
        mode = 'local'
    elif enabled == 'false' and mode == 'local':
        mode = 'external'
    if mode not in {'local', 'external', 'off'}:
        raise ValueError('MAIL_SERVER_MODE must be local, external or off')
    return mode


def runtime_proxy(values):
    """Validate scoped Node24 proxy inputs without revealing credential URLs.

    Docker/package downloads keep their own separately managed networking.
    Mandatory local bypasses protect health checks and service-to-service HTTP.
    No system proxy, Node TLS bypass, or ambient lowercase proxy is inherited.
    """
    enabled = values.get('RUNTIME_USE_ENV_PROXY') or '0'
    if enabled not in {'0', '1'}:
        raise ValueError('RUNTIME_USE_ENV_PROXY must be 0 or 1')
    selected = {'RUNTIME_USE_ENV_PROXY': enabled}
    for name in ('RUNTIME_HTTP_PROXY', 'RUNTIME_HTTPS_PROXY'):
        value = values.get(name) or ''
        try:
            parsed = urlsplit(value)
            if value and (len(value) > 2048 or any(ord(c) < 33 or ord(c) > 126 for c in value)
                          or parsed.scheme not in {'http', 'https'} or not parsed.hostname
                          or parsed.path not in {'', '/'} or parsed.query or parsed.fragment
                          or (parsed.port is not None and not 1 <= parsed.port <= 65535)):
                raise ValueError()
        except (ValueError, TypeError):
            raise ValueError(name + ' must be a valid HTTP(S) proxy URL; credentials must be percent encoded') from None
        selected[name] = value if enabled == '1' else ''
    if enabled == '1' and not selected['RUNTIME_HTTPS_PROXY']:
        raise ValueError('RUNTIME_HTTPS_PROXY is required when enabling the HTTPS provider proxy')
    extra = values.get('RUNTIME_NO_PROXY') or ''
    if len(extra) > 8192 or not re.fullmatch(r'[a-zA-Z0-9.*_:\[\], -]*', extra):
        raise ValueError('RUNTIME_NO_PROXY must be a bounded comma-separated host/IP bypass list')
    bypass = ['localhost', '127.0.0.1', '::1', '[::1]', 'app', 'worker', 'db', 'clamav', 'proxy', 'mailserver']
    for token in extra.split(','):
        token = token.strip()
        if token and token not in bypass:
            bypass.append(token)
    if len(bypass) > 110:
        raise ValueError('RUNTIME_NO_PROXY has too many entries')
    selected['RUNTIME_NO_PROXY_EFFECTIVE'] = ','.join(bypass)
    return selected


def write_changes(path, changes):
    path = Path(path).resolve()
    existing = path.read_text().splitlines()
    kept = [line for line in existing if line.split('=', 1)[0].strip() not in changes]
    for name, value in changes.items():
        if not re.fullmatch(r'[A-Z][A-Z0-9_]*', name) or any(char in value for char in ('\n', '\r', '\x00', "'")):
            raise ValueError('Unsupported dotenv key/value')
        kept.append(f"{name}='{value}'")
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as file:
        os.chmod(file.name, 0o600)
        file.write('\n'.join(kept) + '\n')
        file.flush()
        os.fsync(file.fileno())
        temp = file.name
    os.replace(temp, path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    command = sys.argv[1]
    if command == 'get':
        values = read(sys.argv[2])
        print(mail_mode(values) if sys.argv[3] == 'MAIL_SERVER_MODE' else
              values.get(sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else ''))
    elif command == 'defaults':
        current, defaults = read(sys.argv[2]), read(sys.argv[3])
        for value in sys.argv[4:]:
            name, content = value.split('=', 1)
            if name not in defaults:
                raise SystemExit('Default override must name a documented setting.')
            defaults[name] = content
        missing = {name: value for name, value in defaults.items() if name not in current}
        if missing:
            write_changes(sys.argv[2], missing)
        print('Added ' + str(len(missing)) + ' previously absent documented settings; existing values preserved.')
    elif command == 'set':
        # Explicit operator selection only; value is never executed or printed.
        if len(sys.argv) != 5:
            raise SystemExit('Usage: env-file.py set file KEY value')
        write_changes(sys.argv[2], {sys.argv[3]: sys.argv[4]})
    elif command == 'restore-keys':
        old, current = read(sys.argv[2]), read(sys.argv[3])
        names = ('SESSION_SECRET', 'MFA_ENCRYPTION_KEY')
        if any(not old.get(name) for name in names):
            raise SystemExit('The backup does not contain the required encryption keys.')
        if any(old[name] != current.get(name) for name in names):
            if '--apply' not in sys.argv:
                if '--allow-different' not in sys.argv:
                    raise SystemExit('Encryption keys differ. Use --restore-keys to explicitly restore them before restoring this database.')
            else:
                write_changes(sys.argv[3], {name: old[name] for name in names})
    else:
        raise SystemExit('Unknown command.')

