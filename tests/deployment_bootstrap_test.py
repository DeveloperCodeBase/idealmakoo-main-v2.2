"""Reproduce first-install empty-secret failure and ambient Compose overrides."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'deploy' / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


environment = module('bootstrap_test_env', 'env-file.py')
bootstrap = module('bootstrap_test', 'bootstrap-environment.py')
compose = module('compose_test', 'compose.py')


class BootstrapTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-bootstrap-test-')
        self.work = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        self.source = self.work / 'supplied.env'
        self.source.write_text((ROOT / '.env.example').read_text())
        self.source.chmod(0o600)
        self.target = self.work / 'runtime.env'
        self.selections = {'COMPOSE_PROJECT_NAME': 'idealmakoo-test', 'SITE_URL': 'http://127.0.0.1:8080',
                           'SITE_ADDRESS': 'http://127.0.0.1', 'BOOTSTRAP_ADMIN_EMAIL': 'admin@test.invalid', 'ACME_EMAIL': 'ops@test.invalid'}

    def create(self):
        return subprocess.run([sys.executable, str(ROOT / 'deploy/bootstrap-environment.py'), 'initialize',
                               str(self.target), str(ROOT / '.env.example'), str(self.source),
                               *[name + '=' + value for name, value in self.selections.items()]], capture_output=True, text=True, timeout=10)

    def test_copied_example_with_blank_internal_secrets_installs_fresh_without_manual_password_assembly(self):
        result = self.create()
        self.assertEqual(result.returncode, 0, result.stderr)
        values = environment.read(self.target)
        bootstrap.validate(values)
        for key in ('SESSION_SECRET', 'MFA_ENCRYPTION_KEY', 'POSTGRES_ADMIN_PASSWORD', 'POSTGRES_APP_PASSWORD', 'POSTGRES_MIGRATION_PASSWORD'):
            self.assertEqual(len(values[key]), 64)
            self.assertNotIn(values[key], result.stdout + result.stderr)
        url = urlsplit(values['DATABASE_URL'])
        self.assertEqual(url.username, 'idealmakoo_app')
        self.assertEqual(unquote(url.password), values['POSTGRES_APP_PASSWORD'])
        self.assertEqual(values['NEXT_PUBLIC_SITE_URL'], self.selections['SITE_URL'])
        self.assertEqual(values['STAFF_PROVISIONING_MODE'], 'hybrid')
        self.assertEqual(self.target.stat().st_mode & 0o777, 0o600)

    def test_explicit_staff_policy_is_preserved_and_unknown_policy_fails_before_install(self):
        for mode in ('env', 'panel', 'hybrid'):
            with self.subTest(mode=mode):
                self.target.unlink(missing_ok=True)
                environment.write_changes(self.source, {'STAFF_PROVISIONING_MODE': mode})
                result = self.create()
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(environment.read(self.target)['STAFF_PROVISIONING_MODE'], mode)
        self.target.unlink()
        environment.write_changes(self.source, {'STAFF_PROVISIONING_MODE': 'unrecognized'})
        result = self.create()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('STAFF_PROVISIONING_MODE', result.stderr)
        self.assertFalse(self.target.exists())

    def test_supplied_provider_secret_and_staff_roster_are_preserved_without_stdout_leaks(self):
        environment.write_changes(self.source, {'SMTP_PASSWORD': 'test_private_provider_password',
            'STAFF_ACCOUNTS_JSON': '[{"key":"editor-fa","email":"editor@test.invalid","name":"Editor","role":"editor"}]'})
        result = self.create()
        self.assertEqual(result.returncode, 0, result.stderr)
        values = environment.read(self.target)
        self.assertEqual(values['SMTP_PASSWORD'], 'test_private_provider_password')
        self.assertEqual(values['STAFF_ACCOUNTS_JSON'], environment.read(self.source)['STAFF_ACCOUNTS_JSON'])
        self.assertNotIn('test_private_provider_password', result.stdout + result.stderr)

    def test_existing_destination_is_never_reinitialized_or_rotated(self):
        self.assertEqual(self.create().returncode, 0)
        before = self.target.read_bytes()
        result = self.create()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.target.read_bytes(), before)

    def test_recovery_preserves_original_keys_and_removed_bootstrap_password(self):
        self.assertEqual(self.create().returncode, 0)
        environment.write_changes(self.target, {'BOOTSTRAP_ADMIN_PASSWORD': ''})
        original = environment.read(self.target)
        recovered = self.work / 'recovered.env'
        result = subprocess.run([sys.executable, str(ROOT / 'deploy/bootstrap-environment.py'), 'recover',
                                 str(recovered), str(ROOT / '.env.example'), str(self.target),
                                 'SITE_URL=http://127.0.0.1:8081', 'SITE_ADDRESS=http://127.0.0.1'],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        values = environment.read(recovered)
        self.assertEqual(values['BOOTSTRAP_ADMIN_PASSWORD'], '')
        for key in ('SESSION_SECRET', 'MFA_ENCRYPTION_KEY', 'POSTGRES_ADMIN_PASSWORD',
                    'POSTGRES_APP_PASSWORD', 'POSTGRES_MIGRATION_PASSWORD',
                    'DATABASE_URL', 'MIGRATION_DATABASE_URL'):
            self.assertEqual(values[key], original[key])
            self.assertNotIn(values[key], result.stdout + result.stderr)
        self.assertEqual(values['SITE_URL'], 'http://127.0.0.1:8081')
        self.assertEqual(values['NEXT_PUBLIC_SITE_URL'], values['SITE_URL'])
        self.assertEqual(recovered.stat().st_mode & 0o777, 0o600)

    def test_recovery_rejects_missing_original_key_instead_of_generating_replacement(self):
        self.assertEqual(self.create().returncode, 0)
        environment.write_changes(self.target, {'SESSION_SECRET': ''})
        recovered = self.work / 'recovered.env'
        result = subprocess.run([sys.executable, str(ROOT / 'deploy/bootstrap-environment.py'), 'recover',
                                 str(recovered), str(ROOT / '.env.example'), str(self.target)],
                                capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('SESSION_SECRET', result.stderr)
        self.assertFalse(recovered.exists())

    def test_conflicting_database_url_is_rejected_without_echoing_its_password(self):
        environment.write_changes(self.source, {'DATABASE_URL': 'postgresql://idealmakoo_app:test_private_wrong_password@db:5432/idealmakoo'})
        result = self.create()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('DATABASE_URL', result.stderr)
        self.assertNotIn('test_private_wrong_password', result.stdout + result.stderr)
        self.assertFalse(self.target.exists())

    def test_dotenv_malformed_or_duplicate_entries_are_not_silently_ignored(self):
        for content in ('SESSION_SECRET=one\nSESSION_SECRET=two\n', 'INVALID KEY=secret\n', 'MISSING_ASSIGNMENT\n', 'VALUE="unfinished\n'):
            self.source.write_text(content)
            with self.subTest(content=content), self.assertRaises(ValueError):
                environment.read(self.source)

    def test_protected_settings_override_all_referenced_ambient_values(self):
        self.assertEqual(self.create().returncode, 0)
        values = environment.read(self.target)
        resolved = compose.environment(ROOT, self.target, {'PATH': '/usr/bin', 'SESSION_SECRET': 'ambient-untrusted',
             'STAFF_ACCOUNTS_JSON': '[{"role":"superAdmin"}]', 'COMPOSE_PROJECT_NAME': 'wrong-project',
             'COMPOSE_PROFILES': 'unknown-profile', 'COMPOSE_FILE': '/malicious.yml', 'UPLOAD_MAX_FILE_BYTES': '999999999999'})
        self.assertEqual(resolved['SESSION_SECRET'], values['SESSION_SECRET'])
        self.assertEqual(resolved['COMPOSE_PROJECT_NAME'], 'idealmakoo-test')
        self.assertEqual(resolved['STAFF_ACCOUNTS_JSON'], values.get('STAFF_ACCOUNTS_JSON', '[]'))
        self.assertEqual(resolved['UPLOAD_MAX_FILE_BYTES'], values['UPLOAD_MAX_FILE_BYTES'])
        self.assertNotIn('COMPOSE_FILE', resolved)
        self.assertEqual(resolved['COMPOSE_DISABLE_ENV_FILE'], 'true')


if __name__ == '__main__':
    unittest.main()
