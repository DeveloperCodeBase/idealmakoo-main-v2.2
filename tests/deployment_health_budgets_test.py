"""Real Compose parsing and refusal tests for bounded startup health settings."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


def load(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'deploy' / file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dotenv = load('health_budget_env', 'env-file.py')
bootstrap = load('health_budget_bootstrap', 'bootstrap-environment.py')
compose = load('health_budget_compose', 'compose.py')


def seconds(value):
    parts = re.findall(r'([0-9]+(?:\.[0-9]+)?)(ns|us|ms|h|m|s)', value)
    if ''.join(number + unit for number, unit in parts) != value:
        raise AssertionError('Unexpected Compose duration representation')
    factors = {'h': 3600, 'm': 60, 's': 1, 'ms': .001, 'us': .000001, 'ns': .000000001}
    return sum(float(number) * factors[unit] for number, unit in parts)


DEFAULTS = {'APP_HEALTH_TIMEOUT_SECONDS': '8', 'APP_HEALTH_START_PERIOD_SECONDS': '45',
            'WORKER_HEALTH_TIMEOUT_SECONDS': '10', 'WORKER_HEALTH_START_PERIOD_SECONDS': '60'}
SLOW_HOST = {'APP_HEALTH_TIMEOUT_SECONDS': '90', 'APP_HEALTH_START_PERIOD_SECONDS': '600',
             'WORKER_HEALTH_TIMEOUT_SECONDS': '90', 'WORKER_HEALTH_START_PERIOD_SECONDS': '600'}


class HealthBudgetTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-health-budget-')
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.envfile = self.directory / 'private.env'
        with contextlib.redirect_stdout(io.StringIO()):
            bootstrap.initialize(self.envfile, ROOT / '.env.example', None, {
                'SITE_URL': 'http://127.0.0.1:3088', 'SITE_ADDRESS': 'http://127.0.0.1',
                'BOOTSTRAP_ADMIN_EMAIL': 'operator@test.invalid',
                'PRIVACY_LEDGER_HOST_DIR': str(self.directory / 'ledger'),
                'INTEGRATIONS_HOST_DIR': str(self.directory / 'integrations')})

    def render(self, inherited=None):
        binary = os.environ.get('TEST_COMPOSE_BINARY')
        command = [binary] if binary else [shutil.which('docker') or 'docker', 'compose']
        result = subprocess.run([*command, '--env-file', '/dev/null', '--project-directory', str(ROOT),
            '-f', str(ROOT / 'docker-compose.yml'), '--profile', 'operations', '--profile', 'antivirus',
            'config', '--format', 'json'], env=compose.environment(ROOT, self.envfile, inherited or dict(os.environ)),
            capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, 'Real Compose parser rejected the private fixture.')
        return json.loads(result.stdout)

    def test_real_compose_defaults_keep_existing_health_gates_and_skip_npm_process(self):
        config = self.render()['services']
        for name, timeout, start, interval, retries in [('app', 8, 45, 15, 5), ('worker', 10, 60, 30, 4)]:
            health = config[name]['healthcheck']
            self.assertEqual(seconds(health['timeout']), timeout)
            self.assertEqual(seconds(health['start_period']), start)
            self.assertEqual(seconds(health['interval']), interval)
            self.assertEqual(health['retries'], retries)
            self.assertIsNot(health.get('disable'), True)
            self.assertEqual(config[name]['depends_on']['db']['condition'], 'service_healthy')
            self.assertEqual(config[name]['depends_on']['migrate']['condition'], 'service_completed_successfully')
            self.assertFalse(set(DEFAULTS) & set(config[name]['environment']))
        self.assertEqual(config['app']['healthcheck']['test'], ['CMD', 'node', '/app/deploy/app-healthcheck.mjs', '8'])
        self.assertEqual(config['worker']['healthcheck']['test'],
                         ['CMD', 'node', '--import', 'tsx', '/app/scripts/worker-health.ts'])
        self.assertEqual(config['proxy']['depends_on']['app']['condition'], 'service_healthy')
        self.assertIn('PONG', ' '.join(config['clamav']['healthcheck']['test']))
        self.assertEqual(seconds(config['clamav']['healthcheck']['start_period']), 600)

    def test_real_compose_uses_protected_slow_host_values_not_ambient_shell(self):
        dotenv.write_changes(self.envfile, SLOW_HOST)
        config = self.render({**os.environ, **{name: '1' for name in DEFAULTS}})['services']
        for name in ('app', 'worker'):
            self.assertEqual(seconds(config[name]['healthcheck']['timeout']), 90)
            self.assertEqual(seconds(config[name]['healthcheck']['start_period']), 600)
            self.assertFalse(set(DEFAULTS) & set(config[name]['environment']))
        self.assertEqual(config['app']['healthcheck']['test'][-1], '90')

    def test_absent_or_empty_settings_keep_original_defaults_and_ignore_ambient(self):
        self.assertEqual(dotenv.health_budgets({}), DEFAULTS)
        self.assertEqual(dotenv.health_budgets({name: '' for name in DEFAULTS}), DEFAULTS)
        lines = self.envfile.read_text().splitlines()
        self.envfile.write_text('\n'.join(line for line in lines if line.split('=', 1)[0] not in DEFAULTS) + '\n')
        selected = compose.environment(ROOT, self.envfile, {name: '9999' for name in DEFAULTS})
        self.assertEqual({name: selected[name] for name in DEFAULTS}, DEFAULTS)

    def test_real_compose_accepts_bounded_maximums_without_disabling_checks(self):
        selection = {**SLOW_HOST, 'APP_HEALTH_TIMEOUT_SECONDS': '120', 'WORKER_HEALTH_TIMEOUT_SECONDS': '120'}
        dotenv.write_changes(self.envfile, selection)
        config = self.render()['services']
        for name in ('app', 'worker'):
            self.assertEqual(seconds(config[name]['healthcheck']['timeout']), 120)
            self.assertEqual(seconds(config[name]['healthcheck']['start_period']), 600)
            self.assertIsNot(config[name]['healthcheck'].get('disable'), True)
        self.assertEqual(config['app']['healthcheck']['test'][-1], '120')

    def test_rejects_noninteger_out_of_range_and_noncanonical_values_without_echo(self):
        ranges = {'APP_HEALTH_TIMEOUT_SECONDS': (8, 120), 'APP_HEALTH_START_PERIOD_SECONDS': (45, 600),
                  'WORKER_HEALTH_TIMEOUT_SECONDS': (10, 120), 'WORKER_HEALTH_START_PERIOD_SECONDS': (60, 600)}
        for name, (minimum, maximum) in ranges.items():
            for value in ('0', '-1', '090', '90.0', '90s', '1e2', 'true', 'untrusted-private-marker',
                          '$(touch /tmp/should-never-run)', str(minimum - 1), str(maximum + 1)):
                with self.subTest(key=name, invalidType='rejected_literal'):
                    with self.assertRaises(ValueError) as caught:
                        dotenv.health_budgets({**SLOW_HOST, name: value})
                    self.assertIn(name, str(caught.exception))
                    if len(value) > 3:
                        self.assertNotIn(value, str(caught.exception))

    def test_start_period_cannot_be_less_than_timeout(self):
        for service, start in [('APP', '45'), ('WORKER', '60')]:
            with self.subTest(service=service):
                with self.assertRaises(ValueError):
                    dotenv.health_budgets({**SLOW_HOST, service + '_HEALTH_TIMEOUT_SECONDS': '120',
                                          service + '_HEALTH_START_PERIOD_SECONDS': start})

    def test_protected_compose_refuses_invalid_value_before_starting_docker(self):
        marker = self.directory / 'docker-was-called'
        fake = self.directory / 'docker'
        fake.write_text('#!/bin/sh\n: > "' + str(marker) + '"\nexit 0\n')
        fake.chmod(0o700)
        private_value = 'untrusted-private-health-value'
        dotenv.write_changes(self.envfile, {'APP_HEALTH_TIMEOUT_SECONDS': private_value})
        result = subprocess.run([sys.executable, str(ROOT / 'deploy/compose.py'), str(ROOT), str(self.envfile), 'up', '-d'],
            env={**os.environ, 'PATH': str(self.directory) + os.pathsep + os.environ.get('PATH', '')},
            capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(marker.exists())
        self.assertIn('APP_HEALTH_TIMEOUT_SECONDS', result.stderr)
        self.assertNotIn(private_value, result.stdout + result.stderr)

    def test_fresh_initializer_refuses_invalid_value_before_writing_environment(self):
        target = self.directory / 'rejected.env'
        with self.assertRaises(ValueError):
            bootstrap.initialize(target, ROOT / '.env.example', self.envfile, {'WORKER_HEALTH_TIMEOUT_SECONDS': '0'})
        self.assertFalse(target.exists())

    def test_recovery_retains_explicit_slow_host_selection_and_original_keys(self):
        dotenv.write_changes(self.envfile, SLOW_HOST)
        before = dotenv.read(self.envfile)
        target = self.directory / 'recovered.env'
        with contextlib.redirect_stdout(io.StringIO()):
            bootstrap.initialize(target, ROOT / '.env.example', self.envfile, {}, recovery=True)
        after = dotenv.read(target)
        self.assertEqual({name: after[name] for name in DEFAULTS}, SLOW_HOST)
        for name in ('SESSION_SECRET', 'MFA_ENCRYPTION_KEY', 'DATABASE_URL', 'MIGRATION_DATABASE_URL'):
            self.assertEqual(after[name], before[name])


class HealthProbeTests(unittest.TestCase):
    def probe(self, budget, delay=0, status=200, payload=None):
        # A real HTTP server exercises fetch/AbortSignal, without occupying the
        # application's fixed port or sleeping in the Python test process.
        source = r"""
import { createServer } from 'node:http';
const configuration = JSON.parse(process.env.PROBE_FIXTURE);
const pending = new Set();
const server = createServer((_request, response) => {
  const timer = setTimeout(() => {
    pending.delete(timer);
    response.writeHead(configuration.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(configuration.payload));
  }, configuration.delay);
  pending.add(timer);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = (url, options) => {
  if (url !== 'http://127.0.0.1:3000/api/v1/health' || options.redirect !== 'error') {
    throw new Error('Unexpected health target or redirect policy');
  }
  calls += 1;
  return originalFetch(`http://127.0.0.1:${server.address().port}/health`, options);
};
process.argv = ['node', configuration.probe];
if (configuration.budget !== null) process.argv.push(configuration.budget);
const began = performance.now();
try { await import(configuration.probe); }
finally {
  for (const timer of pending) clearTimeout(timer);
  server.closeAllConnections();
  server.close();
}
console.log(JSON.stringify({ calls, elapsed: performance.now() - began }));
"""
        configuration = {'budget': budget, 'delay': delay, 'status': status,
                         'payload': {'status': 'ok'} if payload is None else payload,
                         'probe': (ROOT / 'deploy/app-healthcheck.mjs').as_uri()}
        result = subprocess.run([shutil.which('node') or 'node', '--input-type=module', '-e', source],
                                env={**os.environ, 'PROBE_FIXTURE': json.dumps(configuration)},
                                capture_output=True, text=True, timeout=15)
        self.assertEqual(result.stderr, '')
        return result.returncode, json.loads(result.stdout)

    def test_explicit_slow_host_budget_accepts_endpoint_after_original_six_second_limit(self):
        code, observation = self.probe('12', delay=6500)
        self.assertEqual(code, 0)
        self.assertEqual(observation['calls'], 1)
        self.assertGreaterEqual(observation['elapsed'], 6400)

    def test_default_budget_still_aborts_the_same_slow_endpoint(self):
        code, observation = self.probe(None, delay=6500)
        self.assertEqual(code, 1)
        self.assertEqual(observation['calls'], 1)
        self.assertLess(observation['elapsed'], 6500)

    def test_invalid_probe_budget_fails_before_any_http_request(self):
        for budget in ('0', '7', '121', '090', '90s', '1e2', 'private-untrusted-marker'):
            with self.subTest(budget=budget):
                code, observation = self.probe(budget)
                self.assertEqual(code, 1)
                self.assertEqual(observation['calls'], 0)

    def test_extended_budget_does_not_accept_failed_or_invalid_health(self):
        for status, payload in [(503, {'status': 'ok'}), (200, {'status': 'degraded'}), (200, {})]:
            with self.subTest(status=status, payload=payload):
                code, observation = self.probe('120', status=status, payload=payload)
                self.assertEqual(code, 1)
                self.assertEqual(observation['calls'], 1)


if __name__ == '__main__':
    unittest.main()
