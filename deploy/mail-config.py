#!/usr/bin/env python3
"""Prepare a project-owned domain mail server; secrets stay in protected files.

No DNS changes, external messages, Docker daemon changes or TLS exceptions.
The application account uses authenticated SMTP with the public certificate name.
"""
import argparse
import base64
import hashlib
import importlib.util
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import stat
import subprocess
import tempfile
import urllib.parse

def sibling(name):
    spec = importlib.util.spec_from_file_location('mail_' + name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

reader = sibling('env-file')
DOMAIN = re.compile(r'(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}')
ADDRESS = re.compile(r'[a-z0-9][a-z0-9._+-]{0,63}@' + DOMAIN.pattern)
MARKER = '# Managed by IdealMakoo domain mail; edit protected environment settings.\n'

def domain(value):
    if not isinstance(value, str) or not DOMAIN.fullmatch(value): raise ValueError('A lowercase public DNS hostname is required for managed mail')
    return value

def mail_address(value, selected_domain):
    if not isinstance(value, str) or not re.fullmatch(r'[a-z0-9][a-z0-9._+-]{0,63}@' + re.escape(selected_domain), value):
        raise ValueError('Mailbox addresses must belong to MAIL_DOMAIN')
    return value

def configuration(values):
    mode = reader.mail_mode(values)
    if mode != 'local': return {'mode': mode}
    origin = urllib.parse.urlsplit(values.get('SITE_URL', ''))
    if origin.scheme != 'https' or not origin.hostname: raise ValueError('Managed mail needs a production HTTPS site and public DNS')
    selected_domain = domain(values.get('MAIL_DOMAIN') or origin.hostname)
    hostname = domain(values.get('MAIL_HOSTNAME') or 'mail.' + selected_domain)
    if hostname == origin.hostname or not hostname.endswith('.' + selected_domain):
        raise ValueError('MAIL_HOSTNAME must be a separate hostname under MAIL_DOMAIN, normally mail.<domain>')
    service = mail_address(values.get('MAIL_SERVICE_ADDRESS') or 'notifications@' + selected_domain, selected_domain)
    root = Path(values.get('INSTALL_ROOT', '/var/www/idealmakoo'))
    data = Path(values.get('MAIL_DATA_DIR') or str(root / 'mail-server'))
    if not data.is_absolute() or data.resolve() != data or data == root or root not in data.parents:
        raise ValueError('MAIL_DATA_DIR must be a real dedicated directory inside INSTALL_ROOT')
    forbidden = [root / n for n in ('shared', 'releases', 'integrations', 'storage')]
    if any(p == data or p in data.parents for p in forbidden): raise ValueError('Mail data must be separate from app data, integration mounts and releases')
    for key in ('INTEGRATIONS_HOST_DIR', 'PRIVACY_LEDGER_HOST_DIR'):
        if values.get(key):
            p = Path(values[key])
            if p == data or p in data.parents or data in p.parents: raise ValueError('Mail data cannot overlap integration or privacy storage')
    image = values.get('MAIL_SERVER_IMAGE') or 'ghcr.io/docker-mailserver/docker-mailserver:16.0.1'
    if not re.fullmatch(r'[a-zA-Z0-9._:/@-]{1,255}', image) or ':latest' in image or (':' not in image and '@sha256:' not in image):
        raise ValueError('MAIL_SERVER_IMAGE must use an explicit reviewed tag or digest')
    relay = values.get('MAIL_RELAY_HOST', '')
    if relay: domain(relay)
    relay_port = values.get('MAIL_RELAY_PORT') or '587'
    if not relay_port.isdigit() or int(relay_port) not in {587, 2525}: raise ValueError('Managed relay must use STARTTLS on port587 or2525')
    for key in ('MAIL_RELAY_USER', 'MAIL_RELAY_PASSWORD'):
        if any(c in values.get(key, '') for c in '\n\r\x00'): raise ValueError('Invalid mail relay setting')
    for key, default, maximum in [('MAIL_MESSAGE_LIMIT_BYTES', 26214400, 104857600), ('MAIL_MAILBOX_LIMIT_BYTES', 1073741824, 107374182400)]:
        raw = values.get(key) or str(default)
        if not raw.isdigit() or not 1048576 <= int(raw) <= maximum: raise ValueError('Invalid bounded mail quota: ' + key)
    outbound = values.get('MAIL_OUTBOUND_ENABLED', 'true')
    if outbound not in {'true', 'false'}: raise ValueError('MAIL_OUTBOUND_ENABLED must be true or false')
    return {'mode': mode, 'domain': selected_domain, 'hostname': hostname, 'service': service,
            'directory': str(data), 'image': image, 'relay': relay, 'relayPort': relay_port,
            'outbound': outbound == 'true', 'project': values.get('COMPOSE_PROJECT_NAME', 'idealmakoo')}

def atomic(path, content, mode=0o600, managed=False):
    path = Path(path)
    if path.is_symlink() or path.parent.resolve() != path.parent: raise ValueError('Mail settings cannot traverse symlinks')
    if managed and path.exists() and not (path.read_text().startswith(MARKER) or path.read_text().startswith('#!/bin/bash\n' + MARKER)): raise ValueError('An unmanaged mail configuration will not be overwritten')
    path.parent.mkdir(parents=True, mode=0o700, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        os.fchmod(stream.fileno(), mode); stream.write(content.encode() if isinstance(content, str) else content)
        stream.flush(); os.fsync(stream.fileno()); temporary = stream.name
    os.replace(temporary, path)

def command(argv, input=None):
    result = subprocess.run(argv, input=input, capture_output=True, timeout=40, check=False)
    if result.returncode: raise ValueError('Managed mail cryptographic provisioning failed; check OpenSSL availability')
    return result.stdout

def prepare(filename, recovery=False):
    values = reader.read(filename); c = configuration(values)
    if c['mode'] != 'local': return c
    data = Path(c['directory']); data.mkdir(parents=True, mode=0o700, exist_ok=True)
    if data.is_symlink() or data.resolve() != data: raise ValueError('Unsafe mail directory')
    marker = data / '.idealmakoo-mail.json'
    binding = {'format': 1, 'project': c['project'], 'domain': c['domain'], 'hostname': c['hostname']}
    if marker.exists():
        if marker.is_symlink() or json.loads(marker.read_text()) != binding: raise ValueError('The mail data belongs to another project/domain')
    elif any(data.iterdir()): raise ValueError('Refusing to adopt an existing unmanaged mail directory')
    else: atomic(marker, json.dumps(binding) + '\n')
    for directory in ('data', 'state', 'logs', 'config'):
        path = data / directory
        if path.is_symlink(): raise ValueError('Mail persistent directories cannot be symlinks')
        path.mkdir(mode=0o700, exist_ok=True)
    password = values.get('MAIL_SERVICE_PASSWORD') or secrets.token_urlsafe(36)
    if not 24 <= len(password) <= 128 or any(c in password for c in '\r\n\x00'):
        raise ValueError('MAIL_SERVICE_PASSWORD must contain24–128 safe characters')
    # A single protected env is the source of the SMTP password. Hash only is
    # stored in DMS, never passed as a process argument or emitted in a report.
    account_file = data / 'config/postfix-accounts.cf'
    if account_file.is_symlink(): raise ValueError('Unsafe mail account configuration')
    accounts = account_file.read_text().splitlines() if account_file.exists() else []
    present = next((line for line in accounts if line.partition('|')[0] == c['service']), None)
    if present is None:
        hashed = command(['openssl', 'passwd', '-6', '-stdin'], (password + '\n').encode()).decode().strip()
        accounts.append(c['service'] + '|{SHA512-CRYPT}' + hashed)
        atomic(account_file, '\n'.join(accounts) + '\n')
    elif not values.get('MAIL_SERVICE_PASSWORD'):
        raise ValueError('Existing mail account has no matching protected service password; recover its configuration first')
    # Accounts created by the administrator through the DMS CLI are preserved.
    aliases = data / 'config/postfix-virtual.cf'
    if aliases.is_symlink(): raise ValueError('Unsafe mail alias configuration')
    lines = aliases.read_text().splitlines() if aliases.exists() else []
    existing = {line.split()[0] for line in lines if line.strip() and not line.startswith('#')}
    for name in ('postmaster', 'abuse'):
        alias = name + '@' + c['domain']
        if alias not in existing and alias != c['service']: lines.append(alias + ' ' + c['service'])
    atomic(aliases, '\n'.join(lines) + '\n')
    # DMS's officially supported Rspamd override directory, with a persistent
    # private key. The web app has no mount of this directory.
    keydir = data / 'config/rspamd/dkim'; keydir.mkdir(parents=True, mode=0o700, exist_ok=True)
    key = keydir / (c['domain'] + '.mail.key')
    if key.is_symlink(): raise ValueError('Unsafe DKIM key')
    if not key.exists(): atomic(key, command(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048']), 0o600)
    public = command(['openssl', 'pkey', '-pubout', '-outform', 'DER', '-in', str(key)])
    dkim = base64.b64encode(public).decode()
    override = data / 'config/rspamd/override.d'; override.mkdir(parents=True, mode=0o700, exist_ok=True)
    headers = '(o)from:(x)sender:(o)reply-to:(o)subject:(x)date:(x)message-id:(o)to:(o)cc:(x)mime-version:(x)content-type:(x)content-transfer-encoding:(x)in-reply-to:(x)references:list-id:(o)list-unsubscribe:(o)list-unsubscribe-post'
    atomic(override / 'dkim_signing.conf', MARKER + 'sign_authenticated = true;\nsign_local = true;\nuse_domain = "header";\nsign_headers = "' + headers + '";\ndomain {\n  "' + c['domain'] + '" {\n    selector = "mail";\n    path = "/tmp/docker-mailserver/rspamd/dkim/' + key.name + '";\n  }\n}\n', managed=True)
    # Avoid shared public DNSBL rate limits; SPF/DKIM/DMARC and content scoring
    # remain enabled. A private recursive resolver can be configured separately.
    atomic(override / 'rbl.conf', MARKER + 'enabled = false;\n', managed=True)
    postfix = MARKER + 'smtpd_tls_auth_only = yes\nsmtpd_client_connection_rate_limit = 30\nsmtpd_client_message_rate_limit = 100\n'
    if c['relay']: postfix += 'smtp_tls_security_level = verify\nsmtp_tls_CAfile = /etc/ssl/certs/ca-certificates.crt\n'
    if recovery or not c['outbound']: postfix += 'defer_transports = smtp, relay\n'
    atomic(data / 'config/postfix-main.cf', postfix, managed=True)
    # DMS starts Rspamd with its package uid; let its own setup process apply
    # package ownership via the official config directory. No world-readable key.
    patches = '#!/bin/bash\n' + MARKER + 'set -e\nchmod 755 /tmp/docker-mailserver /tmp/docker-mailserver/rspamd\nchown -R _rspamd:_rspamd /tmp/docker-mailserver/rspamd/dkim\nchmod 700 /tmp/docker-mailserver/rspamd/dkim\nchmod 600 /tmp/docker-mailserver/rspamd/dkim/*.key\n'
    atomic(data / 'config/user-patches.sh', patches, 0o700, managed=True)
    changes = {'MAIL_SERVER_MODE': 'local', 'MAIL_SERVER_ENABLED': 'true',
               'MAIL_DOMAIN': c['domain'], 'MAIL_HOSTNAME': c['hostname'], 'MAIL_DATA_DIR': c['directory'],
               'MAIL_SERVER_IMAGE': c['image'], 'MAIL_SERVICE_ADDRESS': c['service'], 'MAIL_SERVICE_PASSWORD': password,
               'SMTP_HOST': c['hostname'], 'SMTP_PORT': '465', 'SMTP_SECURE': 'true',
               'SMTP_USER': c['service'], 'SMTP_PASSWORD': password, 'SMTP_FROM': 'Ideal Makoo <' + c['service'] + '>',
               'SMTP_DKIM_MODE': 'gateway'}
    if recovery: changes['MAIL_OUTBOUND_ENABLED'] = 'false'
    reader.write_changes(filename, changes)
    ip = values.get('MAIL_PUBLIC_IP', '')
    if ip: ipaddress.ip_address(ip)
    records = {'format': 1, 'domain': c['domain'], 'hostname': c['hostname'],
               'records': [{'name': c['hostname'], 'type': 'AAAA' if ':' in ip else 'A', 'value': ip or 'YOUR_PUBLIC_IP'},
                           {'name': c['domain'], 'type': 'MX', 'value': '10 ' + c['hostname'] + '.'},
                           {'name': c['domain'], 'type': 'TXT', 'value': 'v=spf1 mx -all' if not c['relay'] else 'REPLACE_WITH_RELAY_PROVIDER_SPF_INCLUDE'},
                           {'name': 'mail._domainkey.' + c['domain'], 'type': 'TXT', 'value': 'v=DKIM1; k=rsa; p=' + dkim},
                           {'name': '_dmarc.' + c['domain'], 'type': 'TXT', 'value': 'v=DMARC1; p=none; rua=mailto:postmaster@' + c['domain']}],
               'ptr': 'Ask the IP provider to set PTR to ' + c['hostname'],
               'note': 'Merge SPF into one existing SPF record. Never replace another provider MX without a deliberate migration.'}
    atomic(data / 'dns-records.json', json.dumps(records, indent=2) + '\n')
    return {k: v for k, v in c.items() if k != 'directory'}

def main():
    p = argparse.ArgumentParser(description=__doc__); p.add_argument('operation', choices=['prepare', 'validate', 'caddy', 'dns'])
    p.add_argument('--env-file', required=True); p.add_argument('--recovery', action='store_true'); a = p.parse_args()
    values = reader.read(a.env_file); c = configuration(values)
    if a.operation == 'prepare': print(json.dumps(prepare(a.env_file, a.recovery)))
    elif a.operation == 'validate': print(json.dumps({'mode': c['mode'], 'configuration': 'valid'}))
    elif a.operation == 'caddy':
        if c['mode'] == 'local':
            print(c['hostname'] + ' {\n tls {\n  ca https://acme-v02.api.letsencrypt.org/directory\n }\n header X-Content-Type-Options nosniff\n respond "Ideal Makoo mail service" 200\n}')
    elif a.operation == 'dns' and c['mode'] == 'local': print((Path(c['directory']) / 'dns-records.json').read_text())

if __name__ == '__main__':
    try: main()
    except (ValueError, OSError, subprocess.SubprocessError) as e:
        raise SystemExit('Domain mail setup stopped: ' + (str(e) if isinstance(e, ValueError) else 'check protected paths, permissions and OpenSSL')) from None
