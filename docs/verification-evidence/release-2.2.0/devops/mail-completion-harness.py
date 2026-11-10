"""Isolated real-mail restore/restart and offline certificate acceptance.

Uses production deployment code unchanged, one exclusive output directory,
only the existing owned example.test fixture, and no external recipients.
"""
import datetime
import email
import email.message
import email.utils
import fcntl
import hashlib
import imaplib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import smtplib
import ssl
import subprocess
import sys
import tarfile
import time

ROOT = Path('/srv/idealmakoo-mail-current')
RELEASE = ROOT / 'release'
ENV = ROOT / 'shared/.env'
RUN = ROOT / 'completion-20261026-1431'
RUN.mkdir(mode=0o700)
os.umask(0o077)
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
record = {'schemaVersion': 1, 'startedAtUtc': started, 'result': 'running',
          'phases': [], 'externalRecipients': 0, 'publicDnsOrAcmeProven': False}
stage = 'initialization'

def safe_write():
    (RUN / 'completion.safe.json').write_text(json.dumps(record, indent=2) + '\n')

def phase(name, **detail):
    record['phases'].append({'name': name, 'passedAtUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(), **detail})
    safe_write()
    print(json.dumps({'completed': name}), flush=True)

def module(name):
    spec = importlib.util.spec_from_file_location('completion_' + name.replace('-', '_'), RELEASE / 'deploy' / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

def run(args, timeout=120, capture=False):
    with (RUN / 'private-process.log').open('ab') as log:
        result = subprocess.run(args, stdout=subprocess.PIPE if capture else log,
                                stderr=log, timeout=timeout, check=True)
    return result.stdout.decode().strip() if capture else None

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def connection_context():
    return ssl.create_default_context(cafile=str(ROOT / 'tls/mail.example.test.crt'))

def fetch_message(message_id):
    for attempt in range(20):
        with imaplib.IMAP4_SSL('mail.example.test', 993, ssl_context=connection_context(), timeout=30) as client:
            client.login(values['SMTP_USER'], values['SMTP_PASSWORD'])
            assert client.select('INBOX')[0] == 'OK'
            status, ids = client.search(None, 'HEADER', 'Message-ID', '"' + message_id + '"')
            assert status == 'OK'
            if ids[0]:
                status, rows = client.fetch(ids[0].split()[-1], '(RFC822)')
                assert status == 'OK'
                return next(row[1] for row in rows if isinstance(row, tuple))
        time.sleep(2)
    raise AssertionError('Local fixture message absent from IMAP')

def served_certificate():
    with smtplib.SMTP_SSL('mail.example.test', 465, context=connection_context(), timeout=30) as client:
        client.login(values['SMTP_USER'], values['SMTP_PASSWORD'])
        return hashlib.sha256(client.sock.getpeercert(binary_form=True)).hexdigest()

try:
    reader = module('env-file')
    values = reader.read(ENV)
    assert values['COMPOSE_PROJECT_NAME'] == 'idealmakoo-mail-current'
    assert values['MAIL_DOMAIN'] == 'example.test' and values['MAIL_HOSTNAME'] == 'mail.example.test'
    assert values['MAIL_OUTBOUND_ENABLED'] == 'false' and values['NOTIFICATIONS_MODE'] == 'disabled'
    expected = json.loads((ROOT / 'completion-source.sha256.json').read_text())
    actual = {name: digest(RELEASE / name) for name in expected}
    assert actual == expected
    record['runtimeSourceSha256'] = actual
    record['fixtureHealthOverrideSha256'] = digest(ROOT / 'mail-health.fixture.yml')
    lock = os.open(ROOT / 'shared/.operations.lock', os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    os.environ['IDEALMAKOO_OPS_LOCK_HELD'] = '1'
    run(['python3', str(RELEASE / 'deploy/pending-restore.py'), 'assert-clear', str(ENV)])
    phase('frozenSourceAndIsolatedFixtureValidated', files=len(actual))
    lifecycle = ['python3', str(RELEASE / 'deploy/service-lifecycle.py'), '--root', str(RELEASE), '--env-file', str(ENV)]
    stage = 'initial-health'
    run(lifecycle + ['up', '--timeout', '600', 'mailserver'], timeout=630)
    run(['python3', str(RELEASE / 'deploy/mail-diagnostics.py'), '--env-file', str(ENV), '--tls-only'], timeout=120)
    phase('initialContainerHealthyAndStrictSmtpImapAuthenticated')

    stage = 'local-delivery'
    message_id = '<idealmakoo-completion-20261026-1431@example.test>'
    with smtplib.SMTP_SSL('mail.example.test', 465, context=connection_context(), timeout=30) as client:
        client.login(values['SMTP_USER'], values['SMTP_PASSWORD'])
        message = email.message.EmailMessage()
        message['From'] = values['SMTP_USER']; message['To'] = values['SMTP_USER']
        message['Subject'] = 'Isolated coordinated restore acceptance'
        message['Message-ID'] = message_id; message['Date'] = email.utils.formatdate(usegmt=True)
        message['List-Unsubscribe'] = '<https://example.test/unsubscribe/completion-fixture>'
        message['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
        message.set_content('Controlled local fixture only. No external recipient or user data.')
        client.send_message(message)
    received_raw = fetch_message(message_id)
    received = email.message_from_bytes(received_raw)
    signature = received.get('DKIM-Signature', '')
    headers = re.search(r'(?:^|;)\s*h=(.*?);', signature, re.S)
    assert headers and {'from', 'to', 'subject', 'list-unsubscribe', 'list-unsubscribe-post'} <= {x.strip().lower() for x in headers.group(1).split(':')}
    with smtplib.SMTP_SSL('mail.example.test', 465, context=connection_context(), timeout=30) as client:
        client.ehlo(); client.mail('unauthorized@example.test')
        assert client.rcpt('fixture-recipient@another.example.test')[0] >= 500
    phase('localSmtpToImapDkimAndUnauthenticatedRelayRefusalPassed')

    stage = 'snapshot-and-stop'
    snapshot = RUN / 'snapshot.json'
    run(lifecycle + ['snapshot', '--output', str(snapshot), '--timeout', '60'], timeout=75)
    captured = json.loads(snapshot.read_text())
    assert [row['service'] for row in captured['services']] == ['mailserver']
    captured_id = captured['services'][0]['containerId']
    key = ROOT / 'mail-server/config/rspamd/dkim/example.test.mail.key'
    key_before = digest(key)
    accounts = ROOT / 'mail-server/config/postfix-accounts.cf'
    accounts_before = digest(accounts)
    run(lifecycle + ['stop', '--snapshot', str(snapshot), '--timeout', '90'], timeout=110)
    inspected = json.loads(run(['docker', 'inspect', captured_id], capture=True))[0]
    assert inspected['State']['Running'] is False
    phase('ExactCapturedMailContainerStopped')

    stage = 'mail-archive-restore'
    payload = RUN / 'backup-payload'; payload.mkdir(mode=0o700)
    data = module('mail-data')
    data.snapshot(ENV, payload); manifest = data.validate_manifest(payload)
    assert manifest['included'] is True and manifest['mode'] == 'local'
    assert manifest['project'] == 'idealmakoo-mail-current'
    with tarfile.open(payload / 'mail.tar', 'r:') as archive:
        matching = [entry for entry in archive if entry.isfile() and entry.name.startswith('data/')
                    and message_id.encode() in archive.extractfile(entry).read()]
    assert matching, 'The exact controlled message must be in the backup'
    data.restore(ENV, payload)
    assert digest(key) == key_before and digest(accounts) == accounts_before
    assert reader.read(ENV)['MAIL_OUTBOUND_ENABLED'] == 'false'
    phase('MailArchiveValidatedAndRestoredWithCurrentCredentialsAndDkim', inventory=manifest['inventory'])

    stage = 'exact-container-restart'
    run(lifecycle + ['start', '--snapshot', str(snapshot), '--timeout', '420'], timeout=450)
    inspected = json.loads(run(['docker', 'inspect', captured_id], capture=True))[0]
    assert inspected['Id'] == captured_id and inspected['State']['Running'] is True
    assert inspected['State']['Health']['Status'] == 'healthy'
    run(['python3', str(RELEASE / 'deploy/mail-diagnostics.py'), '--env-file', str(ENV), '--tls-only'], timeout=120)
    restored_raw = fetch_message(message_id)
    assert restored_raw == received_raw
    assert reader.read(ENV)['MAIL_OUTBOUND_ENABLED'] == 'false'
    phase('ExactCapturedContainerHealthyAfterRestoreAndSameMessageRetrieved', restoredMessageSha256=hashlib.sha256(restored_raw).hexdigest())
    record['coordinatedRestoreRestartPassed'] = True
    safe_write()

    stage = 'offline-fixture-certificate-rotation'
    prior_certificate = served_certificate()
    rotated = RUN / 'rotated-fixture-tls'; rotated.mkdir(mode=0o700)
    run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3',
         '-subj', '/CN=mail.example.test', '-addext', 'subjectAltName=DNS:mail.example.test',
         '-keyout', str(rotated / 'mail.example.test.key'), '-out', str(rotated / 'mail.example.test.crt')])
    volume = Path(run(['docker', 'volume', 'inspect', '--format', '{{ .Mountpoint }}', 'idealmakoo-mail-current_caddy-data'], capture=True))
    assert volume == ROOT / 'docker-data/volumes/idealmakoo-mail-current_caddy-data/_data'
    destination = volume / 'caddy/certificates/acme-v02.api.letsencrypt.org-directory/mail.example.test'
    assert destination.is_dir() and destination.resolve() == destination
    for suffix in ('key', 'crt'):
        source = rotated / ('mail.example.test.' + suffix)
        for target_root in (destination, ROOT / 'tls'):
            staged = target_root / ('.completion-mail.example.test.' + suffix)
            with staged.open('xb') as stream: stream.write(source.read_bytes())
            staged.chmod(0o600); os.replace(staged, target_root / source.name)
    run(['bash', str(RELEASE / 'scripts/mail-certificate-refresh.sh')], timeout=420)
    new_certificate = served_certificate()
    assert new_certificate != prior_certificate
    with imaplib.IMAP4_SSL('mail.example.test', 993, ssl_context=connection_context(), timeout=30) as client:
        client.login(values['SMTP_USER'], values['SMTP_PASSWORD'])
        assert hashlib.sha256(client.sock.getpeercert(binary_form=True)).hexdigest() == new_certificate
    marker = ROOT / 'mail-server/config/idealmakoo-certificate.sha256'
    expected_marker = run(['openssl', 'x509', '-in', str(ROOT / 'tls/mail.example.test.crt'), '-noout', '-fingerprint', '-sha256'], capture=True)
    assert marker.read_text().strip() == expected_marker
    assert reader.read(ENV)['MAIL_OUTBOUND_ENABLED'] == 'false'
    assert fetch_message(message_id) == received_raw
    phase('ProductionCertificateRefreshReloadedNewFixtureCertificateWithStrictTls', certificateChanged=True)
    record['offlineCertificateRotationPassed'] = True
    record['result'] = 'passed'
    record['finishedAtUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    safe_write()
    print(json.dumps({'result': 'passed', 'coordinatedRestoreRestart': True, 'offlineCertificateRotation': True}), flush=True)
except BaseException as error:
    record['result'] = 'failed'
    record['failedStage'] = stage
    record['errorType'] = type(error).__name__
    if isinstance(error, subprocess.CalledProcessError): record['exitCode'] = error.returncode
    record['finishedAtUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    safe_write()
    print(json.dumps({'result': 'failed', 'stage': stage, 'errorType': type(error).__name__}), flush=True)
    raise
