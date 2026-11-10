"""Execute managed-mail provisioning/archives and bounded download failure paths.

All identities, accounts and data below are isolated fixtures. No external
messages, DNS writes, package installation or Docker daemon are required.
"""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location('test_' + name.replace('-', '_'), ROOT / 'deploy' / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


mail = module('mail-config')
data = module('mail-data')
network = module('network-steps')
diagnostics = module('mail-diagnostics')
build = module('build-images')
reader = module('env-file')


class MailProvisioningTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-mail-unit-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.env = self.root / 'settings.env'
        self.values = {'SITE_URL': 'https://example.test', 'INSTALL_ROOT': str(self.root),
                       'COMPOSE_PROJECT_NAME': 'mail-test', 'MAIL_SERVER_MODE': 'local',
                       'MAIL_OUTBOUND_ENABLED': 'false'}
        self.write_env(self.values)

    def write_env(self, values):
        self.env.write_text(''.join(k + '=' + v + '\n' for k, v in values.items()))
        self.env.chmod(0o600)

    def prepare(self):
        with contextlib.redirect_stdout(io.StringIO()):
            return mail.prepare(self.env)

    def test_defaults_preserve_external_mail_and_explicit_selection_is_supported(self):
        for values in ({}, {'MAIL_SERVER_MODE': 'auto'}, {'MAIL_SERVER_ENABLED': 'false'}):
            self.assertEqual(mail.configuration(values)['mode'], 'external')
        self.assertEqual(reader.mail_mode({'MAIL_SERVER_ENABLED': 'true'}), 'local')
        self.assertEqual(reader.mail_mode({'MAIL_SERVER_MODE': 'off'}), 'off')
        with self.assertRaises(ValueError):
            reader.mail_mode({'MAIL_SERVER_ENABLED': 'yes'})

    def test_provisioning_is_idempotent_and_never_prints_password_or_private_key(self):
        capture = io.StringIO()
        with contextlib.redirect_stdout(capture):
            first = self.prepare()
        values = reader.read(self.env)
        root = Path(values['MAIL_DATA_DIR'])
        key = root / 'config/rspamd/dkim/example.test.mail.key'
        before = key.read_bytes()
        accounts_before = (root / 'config/postfix-accounts.cf').read_bytes()
        password = values['MAIL_SERVICE_PASSWORD']
        self.assertGreaterEqual(len(password), 24)
        self.assertNotIn(password, capture.getvalue())
        self.assertNotIn(password.encode(), accounts_before)
        self.assertIn(b'|{SHA512-CRYPT}', accounts_before)
        self.assertEqual(key.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.prepare(), first)
        self.assertEqual(reader.read(self.env)['MAIL_SERVICE_PASSWORD'], password)
        self.assertEqual(key.read_bytes(), before)
        self.assertEqual((root / 'config/postfix-accounts.cf').read_bytes(), accounts_before)
        self.assertEqual(values['SMTP_DKIM_MODE'], 'gateway')
        dkim = (root / 'config/rspamd/override.d/dkim_signing.conf').read_text()
        self.assertIn('(o)list-unsubscribe:(o)list-unsubscribe-post', dkim)
        records = json.loads((root / 'dns-records.json').read_text())
        self.assertEqual(len([r for r in records['records'] if r['type'] == 'MX']), 1)
        self.assertNotIn('PRIVATE', json.dumps(records))

    def test_unmanaged_directory_and_symlink_are_refused(self):
        root = self.root / 'mail-server'
        root.mkdir()
        (root / 'existing-mailbox').write_text('must survive')
        with self.assertRaisesRegex(ValueError, 'unmanaged'):
            self.prepare()
        self.assertEqual((root / 'existing-mailbox').read_text(), 'must survive')
        (root / 'existing-mailbox').unlink()
        root.rmdir()
        root.symlink_to(self.root / 'unrelated')
        with self.assertRaises(ValueError):
            self.prepare()

    def test_foreign_project_marker_cannot_be_adopted(self):
        self.prepare()
        values = reader.read(self.env)
        values['COMPOSE_PROJECT_NAME'] = 'another-project'
        self.write_env(values)
        with self.assertRaisesRegex(ValueError, 'another project'):
            self.prepare()

    def test_mail_domain_and_storage_boundaries_are_validated(self):
        for changes in ({'SITE_URL': 'http://example.test'}, {'MAIL_HOSTNAME': 'example.test'},
                        {'MAIL_HOSTNAME': 'mail.other.test'}, {'MAIL_DOMAIN': 'example.test\ninjected'},
                        {'MAIL_SERVICE_ADDRESS': 'staff@other.test'}, {'MAIL_DATA_DIR': '/etc'},
                        {'MAIL_DATA_DIR': str(self.root / 'shared/mail')},
                        {'MAIL_SERVER_IMAGE': 'ghcr.io/docker-mailserver/docker-mailserver:latest'},
                        {'MAIL_RELAY_PORT': '25'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                mail.configuration({**self.values, **changes})

    def test_existing_extra_accounts_are_preserved(self):
        self.prepare()
        values = reader.read(self.env)
        accounts = Path(values['MAIL_DATA_DIR']) / 'config/postfix-accounts.cf'
        accounts.write_text(accounts.read_text() + 'operator@example.test|fixture-hash\n')
        self.prepare()
        self.assertIn('operator@example.test|fixture-hash', accounts.read_text())

    def test_lost_service_password_fails_without_rotating_existing_hash(self):
        self.prepare()
        values = reader.read(self.env)
        accounts = Path(values['MAIL_DATA_DIR']) / 'config/postfix-accounts.cf'
        before = accounts.read_bytes()
        values['MAIL_SERVICE_PASSWORD'] = ''
        self.write_env(values)
        with self.assertRaisesRegex(ValueError, 'matching protected service password'):
            self.prepare()
        self.assertEqual(accounts.read_bytes(), before)

    def test_mail_snapshot_restore_preserves_current_credentials_and_pauses_outbound(self):
        self.prepare()
        values = reader.read(self.env)
        root = Path(values['MAIL_DATA_DIR'])
        mailbox = root / 'data/example.test/notifications/new'
        mailbox.mkdir(parents=True)
        (mailbox / 'test-message').write_bytes(b'controlled local mail fixture')
        key_before = (root / 'config/rspamd/dkim/example.test.mail.key').read_bytes()
        payload = self.root / 'payload'
        payload.mkdir()
        data.snapshot(self.env, payload)
        data.validate_manifest(payload)
        accounts = root / 'config/postfix-accounts.cf'
        accounts.write_text(accounts.read_text() + 'current@example.test|new-current-account\n')
        (mailbox / 'test-message').write_bytes(b'changed fixture')
        result = data.restore(self.env, payload)
        self.assertIn('current-mail-grants-preserved', result)
        self.assertEqual((mailbox / 'test-message').read_bytes(), b'controlled local mail fixture')
        self.assertIn('new-current-account', accounts.read_text())
        self.assertEqual((root / 'config/rspamd/dkim/example.test.mail.key').read_bytes(), key_before)
        self.assertEqual(reader.read(self.env)['MAIL_OUTBOUND_ENABLED'], 'false')
        self.assertIn('defer_transports = smtp, relay', (root / 'config/postfix-main.cf').read_text())

    def test_disabled_mail_still_includes_retained_mailbox_data(self):
        self.prepare()
        values = reader.read(self.env)
        values.update({'MAIL_SERVER_MODE': 'external', 'MAIL_SERVER_ENABLED': 'false'})
        self.write_env(values)
        payload = self.root / 'payload'
        payload.mkdir()
        data.snapshot(self.env, payload)
        info = data.validate_manifest(payload)
        self.assertTrue(info['included'])
        self.assertEqual(info['mode'], 'external')

    def test_fresh_restore_never_overwrites_existing_mail(self):
        self.prepare()
        payload = self.root / 'payload'
        payload.mkdir()
        data.snapshot(self.env, payload)
        with self.assertRaisesRegex(ValueError, 'refuses existing data'):
            data.restore(self.env, payload, fresh=True)

    def test_fresh_restore_can_rebind_an_authenticated_mail_tree_to_a_new_empty_project(self):
        self.prepare()
        payload = self.root / 'payload'
        payload.mkdir()
        data.snapshot(self.env, payload)
        values = reader.read(self.env)
        original = Path(values['MAIL_DATA_DIR'])
        target = self.root / 'new-install'
        values.update({'INSTALL_ROOT': str(target), 'MAIL_DATA_DIR': str(target / 'mail-server'),
                       'COMPOSE_PROJECT_NAME': 'mail-recovered'})
        restored_env = self.root / 'recovered.env'
        restored_env.write_text('\n'.join(key + '=' + value for key, value in values.items()) + '\n')
        restored_env.chmod(0o600)
        data.restore(restored_env, payload, fresh=True)
        marker = json.loads((target / 'mail-server/.idealmakoo-mail.json').read_text())
        self.assertEqual(marker['project'], 'mail-recovered')
        self.assertEqual(marker['domain'], 'example.test')
        self.assertEqual(json.loads((original / '.idealmakoo-mail.json').read_text())['project'], 'mail-test')
        self.assertEqual((original / 'config/postfix-accounts.cf').read_bytes(),
                         (target / 'mail-server/config/postfix-accounts.cf').read_bytes())
        self.assertEqual(reader.read(restored_env)['MAIL_OUTBOUND_ENABLED'], 'false')

    def test_same_host_restore_rejects_another_project_before_creating_mail(self):
        self.prepare()
        payload = self.root / 'payload'
        payload.mkdir()
        data.snapshot(self.env, payload)
        values = reader.read(self.env)
        values['COMPOSE_PROJECT_NAME'] = 'foreign-project'
        self.write_env(values)
        with self.assertRaisesRegex(ValueError, 'matching project/domain'):
            data.restore(self.env, payload)


class MailArchiveTests(unittest.TestCase):
    def archive(self, directory, entries):
        path = Path(directory) / 'mail.tar'
        with tarfile.open(path, 'w:') as out:
            for name, kind, target in entries:
                item = tarfile.TarInfo(name)
                item.type = kind
                item.linkname = target
                out.addfile(item)
        return path

    def test_escaping_links_and_link_ancestors_are_rejected_before_extraction(self):
        for entries in ([('config/a', tarfile.SYMTYPE, '/etc/shadow')],
                        [('config/a', tarfile.SYMTYPE, '../../escape')],
                        [('config/a', tarfile.SYMTYPE, '../data'), ('config/a/secret', tarfile.REGTYPE, '')],
                        [('../escape', tarfile.REGTYPE, '')], [('arbitrary-root', tarfile.REGTYPE, '')],
                        [('config/hard', tarfile.LNKTYPE, 'config/key')]):
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    data.validate(self.archive(directory, entries))

    def test_internal_relative_links_survive_safe_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.archive(directory, [('data', tarfile.DIRTYPE, ''),
                                             ('config/relative', tarfile.SYMTYPE, '../data')])
            target = Path(directory) / 'restored'
            target.mkdir()
            data.extract(path, target)
            self.assertEqual((target / 'config/relative').resolve(), target / 'data')


class DownloadRecoveryTests(unittest.TestCase):
    def test_transient_download_retries_then_completes_without_leaking_child_output(self):
        outcomes = iter([(1, b'connection reset by peer secret-fixture-marker', None), (0, b'ok', None)])
        calls = []
        def runner(command, timeout):
            calls.append(command)
            return next(outcomes)
        output = io.StringIO()
        with contextlib.redirect_stderr(output):
            status = network.run_step('image-pull', ['controlled-command'], runner=runner, sleeper=lambda _: None)
        self.assertEqual(status, 0)
        self.assertEqual(len(calls), 2)
        self.assertIn('"attempts": 2', output.getvalue())
        self.assertNotIn('secret-fixture-marker', output.getvalue())

    def test_permanent_security_and_configuration_errors_never_retry(self):
        for text, reason in [(b'x509: certificate expired', 'TLS_TRUST'),
                             (b'EINTEGRITY checksum mismatch', 'SIGNATURE'),
                             (b'403 Forbidden', 'AUTHORIZATION'),
                             (b'no space left on device', 'DISK'),
                             (b'typescript compilation failed', 'CONFIGURATION')]:
            calls = []
            def runner(command, timeout):
                calls.append(command)
                return 2, text, None
            with self.subTest(reason=reason), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(network.run_step('image-build', ['controlled-command'], runner=runner, sleeper=lambda _: None), 2)
                self.assertEqual(len(calls), 1)

    def test_exhaustion_stops_at_limit_with_original_nonzero_exit(self):
        calls = []
        def runner(command, timeout):
            calls.append(command)
            return 7, b'Temporary failure resolving registry', None
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(network.run_step('apt-update', ['controlled-command'], attempts=3, runner=runner, sleeper=lambda _: None), 7)
        self.assertEqual(len(calls), 3)

    def test_actual_process_exit_output_and_deadline_are_observed(self):
        status, output, forced = network.capture([sys.executable, '-c', 'print("controlled result"); raise SystemExit(7)'], 3)
        self.assertEqual(status, 7)
        self.assertIn(b'controlled result', output)
        self.assertIsNone(forced)
        status, _, forced = network.capture([sys.executable, '-c', 'import time; time.sleep(30)'], .2)
        self.assertEqual((status, forced), (124, 'TIMEOUT'))

    def test_nonrepeatable_operations_are_not_accepted(self):
        for label in ['migrate', 'seed', 'restore', 'send-sms']:
            with self.subTest(label=label), self.assertRaises(ValueError):
                network.run_step(label, ['controlled-command'])

    def test_npm_registry_rejects_http_credentials_and_control_characters(self):
        self.assertEqual(build.reviewed_registry('https://registry.npmjs.org'), 'https://registry.npmjs.org')
        for value in ['http://registry.example.test', 'https://user:password@registry.example.test',
                      'https://registry.example.test?token=private', 'https://registry.example.test\nnext', '']:
            with self.subTest(value=value), self.assertRaises(ValueError):
                build.reviewed_registry(value)

    def test_provider_proxy_preserves_mandatory_internal_bypasses_and_disabled_default(self):
        disabled = reader.runtime_proxy({'RUNTIME_HTTPS_PROXY': 'http://proxy.example.test:8080'})
        self.assertEqual(disabled['RUNTIME_HTTPS_PROXY'], '')
        enabled = reader.runtime_proxy({'RUNTIME_USE_ENV_PROXY': '1', 'RUNTIME_HTTPS_PROXY': 'http://proxy.example.test:8080',
                                        'RUNTIME_NO_PROXY': 'example.test'})
        for host in ['localhost', '127.0.0.1', 'app', 'db', 'mailserver', 'example.test']:
            self.assertIn(host, enabled['RUNTIME_NO_PROXY_EFFECTIVE'].split(','))
        for value in ['socks5://proxy.example.test', 'http://proxy.example.test?secret=1', 'not-a-url']:
            with self.assertRaises(ValueError):
                reader.runtime_proxy({'RUNTIME_USE_ENV_PROXY': '1', 'RUNTIME_HTTPS_PROXY': value})


class TelegramSetupTests(unittest.TestCase):
    def setUp(self):
        self.setup = module('telegram-setup')
        self.values = {'SITE_URL': 'https://example.test', 'TELEGRAM_BOT_TOKEN': '123456:' + 'a' * 35,
                       'TELEGRAM_BOT_USERNAME': 'controlled_bot', 'TELEGRAM_WEBHOOK_SECRET': 'b' * 64}

    def test_registration_checks_identity_and_retains_pending_updates_without_sending(self):
        calls = []
        def call(values, config, method, body):
            calls.append((method, body))
            return {'getMe': {'id': 123456, 'username': 'controlled_bot', 'is_bot': True},
                    'setWebhook': True,
                    'getWebhookInfo': {'url': 'https://example.test/api/v1/communication-channels/telegram-webhook',
                                       'pending_update_count': 2}}[method]
        result = self.setup.apply(self.values, call)
        self.assertEqual([method for method, _ in calls], ['getMe', 'setWebhook', 'getWebhookInfo'])
        self.assertFalse(calls[1][1]['drop_pending_updates'])
        self.assertEqual(calls[1][1]['secret_token'], self.values['TELEGRAM_WEBHOOK_SECRET'])
        self.assertEqual(result['messagesSent'], 0)
        self.assertNotIn(self.values['TELEGRAM_BOT_TOKEN'], json.dumps(result))
        self.assertNotIn(self.values['TELEGRAM_WEBHOOK_SECRET'], json.dumps(result))

    def test_mismatched_bot_refuses_registration(self):
        calls = []
        def call(values, config, method, body):
            calls.append(method)
            return {'id': 777777, 'username': 'foreign_bot', 'is_bot': True}
        with self.assertRaisesRegex(ValueError, 'different bots'):
            self.setup.apply(self.values, call)
        self.assertEqual(calls, ['getMe'])

    def test_offline_plan_never_contacts_api_or_exposes_secrets(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / 'settings.env'
            env.write_text('\n'.join(key + '=' + value for key, value in self.values.items()) + '\n')
            env.chmod(0o600)
            with mock.patch.object(self.setup, 'api', side_effect=AssertionError('offline plan made an API call')):
                result = subprocess.run([sys.executable, str(ROOT / 'deploy/telegram-setup.py'), '--env-file', str(env)],
                                        capture_output=True, text=True, check=True, timeout=5)
            data = json.loads(result.stdout)
            self.assertEqual(data['networkCalls'], 0)
            self.assertEqual(data['status'], 'plan')
            self.assertNotIn(self.values['TELEGRAM_BOT_TOKEN'], result.stdout + result.stderr)
            self.assertNotIn(self.values['TELEGRAM_WEBHOOK_SECRET'], result.stdout + result.stderr)

    def test_insecure_site_and_invalid_protected_inputs_fail_before_any_api_call(self):
        for changes in [{'SITE_URL': 'http://example.test'}, {'SITE_URL': 'https://user:secret@example.test'},
                        {'SITE_URL': 'https://example.test:8443'}, {'SITE_URL': 'https://example.test/path'},
                        {'TELEGRAM_WEBHOOK_SECRET': 'short'}, {'TELEGRAM_BOT_USERNAME': '@wrong'},
                        {'TELEGRAM_BOT_TOKEN': 'not-a-token'}]:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.setup.configuration({**self.values, **changes})


if __name__ == '__main__':
    unittest.main()
