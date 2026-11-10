"""Exercise the actual Compose parser; no daemon or container mutation needed."""
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


bootstrap = load('compose_bootstrap', ROOT / 'deploy/bootstrap-environment.py')
compose = load('protected_compose', ROOT / 'deploy/compose.py')
dotenv = load('compose_dotenv', ROOT / 'deploy/env-file.py')


class RealComposeTests(unittest.TestCase):
    def test_protected_environment_and_network_isolation_survive_real_compose_interpolation(self):
        binary = os.environ.get('TEST_COMPOSE_BINARY')
        command = [binary] if binary else [shutil.which('docker') or 'docker', 'compose']
        with tempfile.TemporaryDirectory(prefix='idealmakoo-real-compose-test-') as directory:
            envfile = Path(directory) / '.env'
            bootstrap.initialize(envfile, ROOT / '.env.example', None, {
                'SITE_URL': 'http://127.0.0.1:3088', 'SITE_ADDRESS': 'http://127.0.0.1',
                'BOOTSTRAP_ADMIN_EMAIL': 'ops@localhost.invalid',
                'PRIVACY_LEDGER_HOST_DIR': directory + '/ledger',
                'INTEGRATIONS_HOST_DIR': directory + '/integrations'})
            roster = json.dumps([{'key': 'test-editor', 'password': 'literal-$()-value', 'role': 'contentEditor'}])
            dotenv.write_changes(envfile, {'STAFF_ACCOUNTS_JSON': roster,
                                           'SMTP_PASSWORD': 'literal-$DONT_EXPAND',
                                           'RELEASE_SHA': 'test-runtime-deployment'})
            inherited = {**os.environ, 'DATABASE_URL': 'ambient-must-not-win',
                         'SITE_URL': 'https://ambient.invalid', 'COMPOSE_PROJECT_NAME': 'ambient-other-project'}
            result = subprocess.run([*command, '--env-file', '/dev/null', '--project-directory', str(ROOT),
                                     '-f', str(ROOT / 'docker-compose.yml'), '--profile', 'operations',
                                     '--profile', 'antivirus', 'config', '--format', 'json'],
                                    env=compose.environment(ROOT, envfile, inherited), text=True,
                                    capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, 'Real Compose parser rejected the protected configuration.')
            config = json.loads(result.stdout)
            self.assertEqual(config['name'], 'idealmakoo')
            for name in ('app', 'worker'):
                values = config['services'][name]['environment']
                self.assertEqual(values['SITE_URL'], 'http://127.0.0.1:3088')
                # `config` renders a reusable Compose document and therefore
                # escapes a literal dollar once; the variable must not vanish.
                self.assertEqual(values['SMTP_PASSWORD'], 'literal-$$DONT_EXPAND')
                self.assertEqual(values['UPLOAD_CONCURRENT_REQUESTS'], '2')
                self.assertEqual(values['RELEASE_SHA'], 'test-runtime-deployment')
                service = config['services'][name]
                self.assertEqual(service['labels']['com.idealmakoo.release'], 'test-runtime-deployment')
                self.assertNotIn('RELEASE_SHA', service['build']['args'])
                self.assertEqual(service['build']['args']['NEXT_PUBLIC_SITE_URL'], 'http://127.0.0.1:3088')
                self.assertFalse({'STAFF_ACCOUNTS_JSON', 'BOOTSTRAP_ADMIN_PASSWORD',
                                  'MIGRATION_DATABASE_URL', 'POSTGRES_ADMIN_PASSWORD'} & values.keys())
            self.assertEqual(config['services']['migrate']['environment']['STAFF_ACCOUNTS_JSON'], roster.replace('$', '$$'))
            for name in ('storage-tool', 'proxy-data-tool'):
                service = config['services'][name]
                self.assertEqual(service.get('network_mode'), 'none')
                self.assertFalse(service.get('networks'))
                self.assertFalse(service.get('environment'))

    def test_existing_image_model_preserves_literals_profiles_and_uses_real_supported_run_flags(self):
        binary = os.environ.get('TEST_COMPOSE_BINARY')
        command = [binary] if binary else [shutil.which('docker') or 'docker', 'compose']
        actual_run = subprocess.run
        with tempfile.TemporaryDirectory(prefix='idealmakoo-existing-real-compose-') as directory:
            envfile = Path(directory) / '.env'
            bootstrap.initialize(envfile, ROOT / '.env.example', None, {
                'SITE_URL': 'http://127.0.0.1:3088', 'SITE_ADDRESS': 'http://127.0.0.1',
                'BOOTSTRAP_ADMIN_EMAIL': 'ops@localhost.invalid',
                'PRIVACY_LEDGER_HOST_DIR': directory + '/ledger',
                'INTEGRATIONS_HOST_DIR': directory + '/integrations'})
            literal = 'literal-$DONT_EXPAND-${OTHER}-$(not-a-shell)-$$-end'
            roster = json.dumps([{'key': 'fixture-editor', 'password': literal, 'role': 'contentEditor'}])
            dotenv.write_changes(envfile, {'SMTP_PASSWORD': literal, 'STAFF_ACCOUNTS_JSON': roster})
            inherited = {**os.environ, 'SMTP_PASSWORD': 'ambient-must-not-win',
                         'DONT_EXPAND': 'ambient-must-not-expand', 'OTHER': 'ambient-must-not-expand'}
            env = compose.environment(ROOT, envfile, inherited)
            prefix = ['docker', 'compose', '--env-file', '/dev/null', '--project-directory', str(ROOT),
                      '-f', str(ROOT / 'docker-compose.yml')]
            observed = {}

            def driver(argv, **options):
                if argv[:3] == ['docker', 'image', 'inspect']:
                    self.assertEqual(options['stdin'], subprocess.DEVNULL)
                    return subprocess.CompletedProcess(argv, 0, ('sha256:' + 'a' * 64 + '\n').encode(), b'')
                if argv[-3:] == ['config', '--format', 'json']:
                    result = actual_run([*command, *argv[2:]], **options)
                    self.assertEqual(result.returncode, 0, 'The actual parser rejected the original protected model.')
                    observed['first'] = json.loads(result.stdout)
                    return result
                observed['privatePath'] = Path(argv[argv.index('-f') + 1])
                observed['private'] = json.loads(observed['privatePath'].read_text())
                position = argv.index('run')
                second = actual_run([*command, *argv[2:position], 'config', '--format', 'json'],
                                    env=env, capture_output=True, timeout=30, stdin=subprocess.DEVNULL)
                self.assertEqual(second.returncode, 0, 'The actual parser rejected the private image-only model.')
                observed['second'] = json.loads(second.stdout)
                service = argv.index('migrate', position + 1)
                help_result = actual_run([*command, *argv[2:service], '--help'], env=env,
                                         capture_output=True, timeout=30, stdin=subprocess.DEVNULL)
                self.assertEqual(help_result.returncode, 0, 'The actual run parser rejected an emitted operational flag.')
                return subprocess.CompletedProcess(argv, help_result.returncode)

            selected = compose.existing_run_arguments(['--profile', 'operations', 'run-existing', '--rm',
                '--no-deps', '--pull', 'never', '-T', '-e', 'PRIVACY_RESTORE_DATABASE=drill_fixture',
                '--entrypoint', '/bin/sh', 'migrate', '-c', 'cat'])
            with mock.patch.object(compose.subprocess, 'run', side_effect=driver):
                self.assertEqual(compose.run_existing(str(ROOT), str(envfile), prefix, env, selected), 0)
            for field, value in [('SMTP_PASSWORD', literal), ('STAFF_ACCOUNTS_JSON', roster)]:
                self.assertEqual(observed['second']['services']['migrate']['environment'][field], value.replace('$', '$$'))
                self.assertEqual(observed['second']['services']['migrate']['environment'][field],
                                 observed['first']['services']['migrate']['environment'][field])
            self.assertEqual(observed['second']['name'], observed['first']['name'])
            self.assertEqual(observed['second']['services']['migrate']['image'], 'sha256:' + 'a' * 64)
            for service in observed['second']['services'].values():
                self.assertNotIn('build', service)
                self.assertEqual(service['pull_policy'], 'never')
            self.assertEqual(observed['second']['services']['storage-tool']['profiles'], ['operations'])
            self.assertFalse(observed['privatePath'].exists())
            self.assertFalse(observed['privatePath'].parent.exists())


if __name__ == '__main__':
    unittest.main()
