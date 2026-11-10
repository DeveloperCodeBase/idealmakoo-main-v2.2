"""Exercise the actual lifecycle against disposable process/filesystem fixtures.

No Docker daemon, network, database or application process is used. The optional
test-only source root permits running the isolated proposed helper before merge.
"""
from contextlib import redirect_stderr
import hashlib
import http.client
import importlib.util
import io
import itertools
import json
import os
from pathlib import Path
import shutil
import signal
import ssl
import stat
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest
from unittest import mock
import urllib.error


ROOT = Path(__file__).resolve().parents[1]
REFERENCE = Path(os.environ.get('IDEALMAKOO_TEST_SOURCE_ROOT', ROOT))


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class Driver:
    def __init__(self, module, clock):
        self.module, self.clock = module, clock
        self.termination_verified = True
        self.rows = {}
        self.events = []
        self.polls = {}
        self.fail_list = False
        self.partial_up = None
        self.fail_stop = False
        self.force_unhealthy = None
        self.public = []

    def add(self, name, running=False, health='healthy'):
        self.rows[name] = {'id': hashlib.sha256(name.encode()).hexdigest(), 'project': 'idealmakoo',
                           'service': name, 'running': running, 'paused': False,
                           'status': 'running' if running else 'exited',
                           'health': None if name == 'proxy' else health}

    def run(self, argv, deadline, maximum=60):
        deadline.remaining(maximum)
        self.clock.advance(0.01)
        self.events.append({'argv': list(argv), 'states': json.loads(json.dumps(self.rows))})
        if len(argv) > 2 and argv[2] == '--readiness-probe':
            result = self.public.pop(0) if self.public else True
            if not result:
                raise self.module.LifecycleError('COMMAND_FAILED')
            return b''
        if str(argv[1]).endswith('/deploy/compose.py'):
            args = argv[4:]
            if args[0] == 'list-existing':
                if self.fail_list:
                    raise self.module.LifecycleError('COMMAND_FAILED')
                return ('\n'.join(json.dumps({'id': self.rows[x]['id'], 'service': x})
                                  for x in args[1:] if x in self.rows) + '\n').encode()
            assert args[:6] == ['up', '-d', '--no-deps', '--no-build', '--pull', 'never'] and len(args) == 7
            name = args[-1]
            if name not in self.rows:
                self.add(name)
            self.rows[name].update(running=True, status='running', health=None if name == 'proxy' else 'starting')
            self.polls[name] = 3
            if self.partial_up == name:
                raise self.module.LifecycleError('COMMAND_FAILED')
            return b''
        if str(argv[1]).endswith('/deploy/docker-inspect.py'):
            result = []
            for identifier in argv[4:]:
                found = next((row for row in self.rows.values() if row['id'] == identifier), None)
                if found is None:
                    raise self.module.LifecycleError('COMMAND_FAILED')
                row = dict(found)
                name = row['service']
                if row['running'] and name != 'proxy':
                    self.polls[name] = max(0, self.polls.get(name, 0) - 1)
                    row['health'] = 'starting' if self.polls[name] else 'healthy'
                    if self.force_unhealthy == name:
                        row['health'] = 'unhealthy'
                    self.rows[name]['health'] = row['health']
                result.append(row)
            return ('\n'.join(json.dumps(row) for row in result) + '\n').encode()
        assert argv[0] == 'docker'
        if argv[1] == 'start':
            assert len(argv) == 3
            row = next(row for row in self.rows.values() if row['id'] == argv[2])
            row.update(running=True, status='running', health=None if row['service'] == 'proxy' else 'starting')
            self.polls[row['service']] = 2
            return b''
        assert argv[1:4] == ['stop', '--time', '60']
        if self.fail_stop:
            raise self.module.LifecycleError('COMMAND_FAILED')
        for identifier in argv[4:]:
            row = next(row for row in self.rows.values() if row['id'] == identifier)
            row.update(running=False, status='exited')
        return b''


class ReadinessDriver(Driver):
    """Exercise real lifecycle decisions with bounded fake read observations."""
    def __init__(self, module, clock):
        super().__init__(module, clock)
        self.inspect_faults = {}
        self.default_inspect_fault = None
        self.inspections = []
        self.listings = []
        self.list_fault = None

    def fault(self, specification, argv, deadline, maximum):
        self.events.append({'argv': list(argv), 'states': json.loads(json.dumps(self.rows))})
        started = self.clock()
        cap = deadline.remaining(maximum)
        if specification['kind'] == 'timeout':
            self.clock.advance(cap)
            error = self.module.LifecycleError('COMMAND_TIMEOUT', specification.get('status', 124))
            if self.clock() >= deadline.end:
                try:
                    deadline.remaining()
                except self.module.LifecycleError as expired:
                    error = expired
        else:
            self.clock.advance(0.01)
            if specification['kind'] == 'raw':
                return specification['value']
            error = self.module.LifecycleError(specification['code'], specification.get('status', 1))
        # Model cancellation or an unreaped descendant discovered while the
        # original timed-out child is being terminated, before it returns.
        callback = specification.get('after')
        if callback:
            callback()
        error._command_timing = {
            'elapsedSeconds': self.clock() - started, 'suppliedMaximumSeconds': maximum,
            'effectiveMaximumSeconds': cap,
            'overallRemainingSeconds': max(0, deadline.end - self.clock()),
        }
        raise error

    def run(self, argv, deadline, maximum=60):
        if str(argv[1]).endswith('/deploy/compose.py') and argv[4] == 'list-existing':
            self.listings.append(tuple(argv[5:]))
            if self.list_fault:
                return self.fault(self.list_fault, argv, deadline, maximum)
        if str(argv[1]).endswith('/deploy/docker-inspect.py'):
            self.inspections.append({'identifiers': tuple(argv[4:]), 'maximum': maximum})
            specification = self.inspect_faults.get(len(self.inspections), self.default_inspect_fault)
            if specification:
                if specification['kind'] == 'rows':
                    raw = super().run(argv, deadline, maximum=maximum)
                    rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
                    specification['change'](rows)
                    return ('\n'.join(json.dumps(row) for row in rows) + '\n').encode()
                return self.fault(specification, argv, deadline, maximum)
        return super().run(argv, deadline, maximum=maximum)


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-lifecycle-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.root = self.directory / 'release'
        deploy = self.root / 'deploy'
        deploy.mkdir(parents=True)
        shutil.copy(ROOT / 'deploy/service-lifecycle.py', deploy / 'service-lifecycle.py')
        shutil.copy(ROOT / 'deploy/docker-inspect.py', deploy / 'docker-inspect.py')
        shutil.copy(REFERENCE / 'deploy/env-file.py', deploy / 'env-file.py')
        (deploy / 'compose.py').write_text('# selected deployment fixture; driver simulates its Docker boundary\n')
        self.env_file = self.directory / 'private.env'
        self.env_file.write_text('COMPOSE_PROJECT_NAME=idealmakoo\nSITE_URL=https://site.invalid\nCOMPOSE_PROFILES=\n')
        self.env_file.chmod(0o600)
        spec = importlib.util.spec_from_file_location('lifecycle_under_test', deploy / 'service-lifecycle.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.clock = Clock()
        self.driver = Driver(self.module, self.clock)
        self.lifecycle = self.module.Lifecycle(self.root, self.env_file, self.driver, self.clock, self.clock.advance)

    def deadline(self, seconds=1200):
        return self.module.Deadline(seconds, clock=self.clock)

    def captured(self, selection):
        for service in self.module.SERVICES:
            self.driver.add(service, running=service in selection)
        target = self.directory / ('snapshot-' + str(len(list(self.directory.glob('snapshot-*')))) + '.json')
        self.lifecycle.snapshot(target, self.deadline(30))
        return target, self.lifecycle.load_snapshot(target)

    def readiness_fixture(self, services=(), scanner=False):
        self.clock = Clock()
        self.driver = ReadinessDriver(self.module, self.clock)
        self.lifecycle = self.module.Lifecycle(self.root, self.env_file, self.driver,
                                               self.clock, self.clock.advance)
        self.lifecycle.antivirus = scanner
        for service in services:
            self.driver.add(service, running=True)
        return {service: self.driver.rows[service]['id'] for service in services}

    def test_readiness_post_up_timeout_reuses_exact_ids_without_repeating_list_or_mutation(self):
        self.readiness_fixture()
        self.driver.inspect_faults[1] = {'kind': 'timeout'}
        try:
            self.lifecycle.start(('app',), self.deadline(80))
        except self.module.LifecycleError as error:
            self.fail('A reaped read timeout aborted available startup readiness: ' + error.code)
        identity = self.driver.rows['app']['id']
        self.assertEqual(self.driver.listings, [('app',)])
        self.assertEqual(sum('up' in event['argv'] for event in self.driver.events), 1)
        self.assertGreater(len(self.driver.inspections), 2)
        self.assertEqual({item['identifiers'] for item in self.driver.inspections}, {(identity,)})
        self.assertEqual({item['maximum'] for item in self.driver.inspections}, {15})
        self.assertEqual(self.lifecycle.attempted, {'app': identity})
        self.assertEqual(self.driver.rows['app']['health'], 'healthy')
        self.assertGreaterEqual(self.clock(), 17)
        self.assertLess(self.clock(), 80)

    def test_readiness_health_and_initial_public_cycle_retry_only_fixed_read_observations(self):
        for method in ('wait_healthy', 'wait_ready'):
            with self.subTest(method=method):
                mapping = self.readiness_fixture(('app',))
                self.driver.inspect_faults[1] = {'kind': 'timeout'}
                getattr(self.lifecycle, method)(mapping, self.deadline(40))
                self.assertGreaterEqual(len(self.driver.inspections), 2)
                self.assertEqual({x['identifiers'] for x in self.driver.inspections}, {tuple(mapping.values())})
                self.assertEqual({x['maximum'] for x in self.driver.inspections}, {15})
                self.assertEqual(self.driver.listings, [])
                self.assertFalse(any('up' in x['argv'] or x['argv'][0] == 'docker' for x in self.driver.events))

    def test_readiness_post_up_never_adopts_a_replacement_id_or_duplicate_listing(self):
        self.readiness_fixture()
        original = hashlib.sha256(b'app').hexdigest()
        self.driver.inspect_faults[1] = {
            'kind': 'timeout', 'after': lambda: self.driver.rows['app'].update(id='e' * 64),
        }
        with self.assertRaises(self.module.LifecycleError) as failure:
            self.lifecycle.start(('app', 'worker'), self.deadline(80))
        self.assertEqual(failure.exception.code, 'COMMAND_FAILED')
        self.assertEqual([x['identifiers'] for x in self.driver.inspections], [(original,), (original,)])
        self.assertEqual(self.driver.listings, [('app',)])
        self.assertEqual(self.lifecycle.attempted, {'app': None})
        self.assertNotIn('worker', self.driver.rows)
        self.readiness_fixture()
        duplicate = json.dumps({'id': original, 'service': 'app'})
        self.driver.list_fault = {'kind': 'raw', 'value': (duplicate + '\n' + duplicate + '\n').encode()}
        with self.assertRaises(self.module.LifecycleError) as failure:
            self.lifecycle.start(('app',), self.deadline(80))
        self.assertEqual(failure.exception.code, 'INVALID_CONTAINER_IDENTITIES')
        self.assertEqual(self.driver.inspections, [])
        self.assertEqual(self.driver.listings, [('app',)])
        self.assertEqual(self.lifecycle.attempted, {'app': None})

    def test_readiness_persistent_reads_end_at_original_global_deadline_before_next_start(self):
        self.readiness_fixture()
        self.driver.default_inspect_fault = {'kind': 'timeout'}
        with self.assertRaises(self.module.LifecycleError) as failure:
            self.lifecycle.start(('app', 'worker', 'proxy'), self.deadline(40))
        self.assertEqual((failure.exception.code, failure.exception.status), ('DEADLINE_EXCEEDED', 124))
        self.assertAlmostEqual(self.clock(), 40)
        self.assertEqual(len(self.driver.inspections), 3)
        self.assertEqual({x['maximum'] for x in self.driver.inspections}, {15})
        self.assertEqual(self.driver.listings, [('app',)])
        self.assertEqual([x['argv'][-1] for x in self.driver.events if 'up' in x['argv']], ['app'])
        self.assertEqual(self.lifecycle.attempted, {'app': None})
        self.assertEqual(set(self.driver.rows), {'app'})

    def test_readiness_cancellation_after_timeout_keeps_original_signal_status(self):
        for signum in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signum=signum):
                mapping = self.readiness_fixture(('app',))
                cancellation = self.module.Cancellation()
                self.driver.inspect_faults[1] = {
                    'kind': 'timeout', 'after': lambda: cancellation.receive(signum, None),
                }
                deadline = self.module.Deadline(80, cancellation, clock=self.clock)
                with self.assertRaises(self.module.LifecycleError) as failure:
                    self.lifecycle.wait_healthy(mapping, deadline)
                self.assertEqual((failure.exception.code, failure.exception.status), ('INTERRUPTED', 128 + signum))
                self.assertEqual(len(self.driver.inspections), 1)
                self.assertEqual(self.clock(), 15)

    def test_readiness_unreaped_client_blocks_retry_and_preserves_sticky_failure(self):
        mapping = self.readiness_fixture(('app',))
        self.driver.termination_verified = False
        with self.assertRaises(self.module.LifecycleError) as failure:
            self.lifecycle.wait_healthy(mapping, self.deadline(80))
        self.assertEqual(failure.exception.code, 'CLIENT_PROCESS_NOT_REAPED')
        self.assertEqual(self.driver.inspections, [])
        mapping = self.readiness_fixture(('app',))
        self.driver.inspect_faults[1] = {
            'kind': 'timeout', 'after': lambda: setattr(self.driver, 'termination_verified', False),
        }
        with self.assertRaises(self.module.LifecycleError) as failure:
            self.lifecycle.wait_healthy(mapping, self.deadline(80))
        self.assertEqual((failure.exception.code, failure.exception.status), ('COMMAND_TIMEOUT', 124))
        self.assertEqual(len(self.driver.inspections), 1)
        self.assertIs(self.driver.termination_verified, False)
        with self.assertRaises(self.module.LifecycleError) as failure:
            self.lifecycle.wait_healthy(mapping, self.deadline(80))
        self.assertEqual(failure.exception.code, 'CLIENT_PROCESS_NOT_REAPED')
        self.assertEqual(len(self.driver.inspections), 1)

    def test_readiness_non_timeout_identity_shape_and_health_errors_remain_fatal(self):
        cases = [
            ('nonzero', {'kind': 'error', 'code': 'COMMAND_FAILED'}, 'COMMAND_FAILED'),
            ('output-cap', {'kind': 'error', 'code': 'COMMAND_OUTPUT_LIMIT'}, 'COMMAND_OUTPUT_LIMIT'),
            ('wrong-status', {'kind': 'timeout', 'status': 1}, 'COMMAND_TIMEOUT'),
            ('json', {'kind': 'raw', 'value': b'not-json\n'}, 'INVALID_CONTAINER_OBSERVATION'),
            ('missing-row', {'kind': 'raw', 'value': b''}, 'CONTAINER_OBSERVATION_INCOMPLETE'),
            ('extra-field', {'extra': 'private-marker'}, 'CONTAINER_IDENTITY_OR_STATE_MISMATCH'),
            ('project', {'project': 'another'}, 'CONTAINER_IDENTITY_OR_STATE_MISMATCH'),
            ('service', {'service': 'worker'}, 'CONTAINER_IDENTITY_OR_STATE_MISMATCH'),
            ('id', {'id': 'f' * 64}, 'CONTAINER_IDENTITY_OR_STATE_MISMATCH'),
            ('bool', {'running': 1}, 'CONTAINER_IDENTITY_OR_STATE_MISMATCH'),
            ('paused', {'paused': True}, 'SERVICE_NOT_RUNNING'),
            ('stopped', {'running': False, 'status': 'exited'}, 'SERVICE_NOT_RUNNING'),
            ('dead', {'status': 'dead'}, 'SERVICE_NOT_RUNNING'),
            ('missing-health', {'health': None}, 'SERVICE_HEALTHCHECK_MISSING'),
            ('unhealthy', {'health': 'unhealthy'}, 'SERVICE_UNHEALTHY'),
            ('duplicate-row', {'kind': 'rows', 'change': lambda rows: rows.append(dict(rows[0]))},
             'CONTAINER_IDENTITY_OR_STATE_MISMATCH'),
        ]
        for name, specification, expected in cases:
            with self.subTest(case=name):
                mapping = self.readiness_fixture(('app',))
                if 'kind' not in specification:
                    changes = dict(specification)
                    specification = {'kind': 'rows', 'change': lambda rows, value=changes: rows[0].update(value)}
                self.driver.inspect_faults[1] = specification
                with self.assertRaises(self.module.LifecycleError) as failure:
                    self.lifecycle.wait_healthy(mapping, self.deadline(80))
                self.assertEqual(failure.exception.code, expected)
                self.assertEqual(len(self.driver.inspections), 1)
                self.assertEqual(self.driver.listings, [])
                self.assertLessEqual(self.clock(), 15)

    def test_readiness_final_inspect_timeout_requires_a_new_public_probe(self):
        mapping = self.readiness_fixture(('app', 'proxy'))
        self.driver.inspect_faults[2] = {'kind': 'timeout'}
        self.driver.public = [True, False, True]
        self.lifecycle.wait_ready(mapping, self.deadline(80))
        probes = [i for i, event in enumerate(self.driver.events) if event['argv'][2] == '--readiness-probe']
        self.assertEqual(len(probes), 3)
        self.assertEqual(len(self.driver.inspections), 5)
        self.assertEqual({x['identifiers'] for x in self.driver.inspections}, {tuple(mapping.values())})
        self.assertEqual({x['maximum'] for x in self.driver.inspections}, {15})
        self.assertEqual(self.driver.listings, [])
        self.assertGreaterEqual(self.clock(), 19)
        self.assertTrue(all(str(self.driver.events[i - 1]['argv'][1]).endswith('/deploy/docker-inspect.py')
                            for i in probes))

    def test_readiness_explicit_check_and_scanner_retry_after_initial_discovery_only(self):
        mapping = self.readiness_fixture(('app', 'proxy', 'clamav'), scanner=True)
        self.driver.inspect_faults[2] = {'kind': 'timeout'}
        deadline = self.deadline(80)
        stderr = io.StringIO()
        with mock.patch.object(self.module, 'Lifecycle', return_value=self.lifecycle), \
                mock.patch.object(self.module, 'Deadline', return_value=deadline), redirect_stderr(stderr):
            status = self.module.main(['--root', str(self.root), '--env-file', str(self.env_file),
                                       'check', '--timeout', '80', 'app', 'proxy'])
        self.assertEqual(status, 0, stderr.getvalue())
        self.assertEqual(self.driver.listings, [('app', 'proxy'), ('clamav',)])
        self.assertEqual([x['identifiers'] for x in self.driver.inspections[:3]],
                         [(mapping['app'], mapping['proxy']), (mapping['clamav'],), (mapping['clamav'],)])
        self.assertEqual(self.lifecycle.attempted, {})
        self.assertFalse(any('up' in x['argv'] or x['argv'][0] == 'docker' for x in self.driver.events))

    def test_readiness_preflight_snapshot_stop_and_cleanup_remain_fail_fast(self):
        for operation in ('discover', 'snapshot', 'stop', 'captured-start', 'cleanup', 'check'):
            with self.subTest(operation=operation):
                mapping = self.readiness_fixture(('app',))
                self.driver.inspect_faults[1] = {'kind': 'timeout'}
                deadline = self.deadline(80)
                path = self.directory / 'readiness-failed-snapshot.json'
                if operation == 'cleanup':
                    self.lifecycle.attempted = {'app': None}
                    self.assertIs(self.lifecycle.cleanup(), False)
                elif operation == 'check':
                    stderr = io.StringIO()
                    with mock.patch.object(self.module, 'Lifecycle', return_value=self.lifecycle), \
                            mock.patch.object(self.module, 'Deadline', return_value=deadline), redirect_stderr(stderr):
                        status = self.module.main(['--root', str(self.root), '--env-file', str(self.env_file),
                                                   'check', '--timeout', '80', 'app'])
                    self.assertEqual(status, 124)
                    result = json.loads(stderr.getvalue())
                    self.assertEqual(result['code'], 'COMMAND_TIMEOUT')
                    self.assertFalse(result['cleanupAttempted'])
                else:
                    with self.assertRaises(self.module.LifecycleError) as failure:
                        if operation == 'discover':
                            self.lifecycle.discover(('app',), deadline, required=True)
                        elif operation == 'snapshot':
                            self.lifecycle.snapshot(path, deadline)
                        elif operation == 'stop':
                            self.lifecycle.stop(mapping, deadline)
                        else:
                            self.lifecycle.start(('app',), deadline, existing=mapping)
                    self.assertEqual((failure.exception.code, failure.exception.status), ('COMMAND_TIMEOUT', 124))
                self.assertEqual(len(self.driver.inspections), 1)
                self.assertFalse(path.exists())
                self.assertFalse(any('up' in x['argv'] or x['argv'][0] == 'docker' for x in self.driver.events))

    def test_readiness_does_not_retry_listing_or_claim_ownership_before_validation(self):
        for specification, expected in (({'kind': 'timeout'}, 'COMMAND_TIMEOUT'),
                                        ({'kind': 'raw', 'value': b'not-json\n'}, 'INVALID_CONTAINER_LIST'),
                                        ({'kind': 'raw', 'value': b''}, 'SELECTED_SERVICE_MISSING')):
            with self.subTest(expected=expected):
                self.readiness_fixture()
                self.driver.list_fault = specification
                with self.assertRaises(self.module.LifecycleError) as failure:
                    self.lifecycle.start(('app', 'worker'), self.deadline(100))
                self.assertEqual(failure.exception.code, expected)
                self.assertEqual(self.driver.listings, [('app',)])
                self.assertEqual(self.driver.inspections, [])
                self.assertEqual(self.lifecycle.attempted, {'app': None})
                self.assertEqual([x['argv'][-1] for x in self.driver.events if 'up' in x['argv']], ['app'])

    def test_readiness_recovered_timeout_cannot_label_a_later_health_failure(self):
        mapping = self.readiness_fixture(('app',))
        self.driver.inspect_faults[1] = {'kind': 'timeout'}
        self.driver.force_unhealthy = 'app'
        with self.assertRaises(self.module.LifecycleError) as failure:
            self.lifecycle.wait_healthy(mapping, self.deadline(80))
        self.assertEqual(failure.exception.code, 'SERVICE_UNHEALTHY')
        self.assertIsNone(self.module.failed_command_snapshot(failure.exception))
        self.assertEqual(len(self.driver.inspections), 2)

    def test_readiness_requires_exact_inspect_timeout_provenance(self):
        for context in (None, {'class': 'container-list', 'services': ('app',)}):
            with self.subTest(context=context):
                mapping = self.readiness_fixture(('app',))
                failure = self.module.LifecycleError('COMMAND_TIMEOUT', 124)
                if context is not None:
                    failure._command_context = context
                with mock.patch.object(self.lifecycle, 'inspect', side_effect=failure) as inspect:
                    with self.assertRaises(self.module.LifecycleError) as caught:
                        self.lifecycle.wait_healthy(mapping, self.deadline(80))
                self.assertIs(caught.exception, failure)
                self.assertEqual(inspect.call_count, 1)
                self.assertEqual(self.clock(), 0)

    def test_all_eight_previous_running_subsets_keep_ids_and_omit_stopped_services(self):
        for bits in itertools.product((False, True), repeat=3):
            selection = tuple(name for name, enabled in zip(self.module.SERVICES, bits) if enabled)
            with self.subTest(selection=selection):
                # Each subset represents a separate CLI invocation, with no
                # ownership left over from a previous independent resumption.
                self.driver = Driver(self.module, self.clock)
                self.lifecycle = self.module.Lifecycle(self.root, self.env_file, self.driver, self.clock, self.clock.advance)
                path, mapping = self.captured(selection)
                self.assertEqual(list(mapping), list(selection))
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
                original_ids = {name: row['id'] for name, row in self.driver.rows.items()}
                self.lifecycle.stop(mapping, self.deadline(90))
                self.lifecycle.start(tuple(mapping), self.deadline(), existing=mapping)
                self.assertEqual({name for name, row in self.driver.rows.items() if row['running']}, set(selection))
                self.assertEqual({name: row['id'] for name, row in self.driver.rows.items()}, original_ids)
                self.assertFalse(any('up' in event['argv'] for event in self.driver.events))
                started = [event['argv'][2] for event in self.driver.events if event['argv'][:2] == ['docker', 'start']]
                self.assertEqual(started, [mapping[name] for name in selection])

    def test_proxy_subsets_resume_without_starting_absent_app_or_requiring_its_http(self):
        for selection in (('proxy',), ('worker', 'proxy')):
            with self.subTest(selection=selection):
                self.clock = Clock()
                self.driver = Driver(self.module, self.clock)
                self.lifecycle = self.module.Lifecycle(self.root, self.env_file, self.driver,
                                                       self.clock, self.clock.advance)
                _, mapping = self.captured(selection)
                original_ids = {name: row['id'] for name, row in self.driver.rows.items()}
                self.lifecycle.stop(mapping, self.deadline(90))
                self.driver.events.clear()
                # The app was deliberately stopped before capture, so its HTTP
                # endpoint must remain unavailable throughout exact-ID resume.
                self.driver.public = [False] * 20
                try:
                    self.lifecycle.start(selection, self.deadline(20), existing=mapping)
                except self.module.LifecycleError as failure:
                    self.fail('Exact captured subset cannot resume with its app absent: ' + failure.code)
                self.assertEqual({name for name, row in self.driver.rows.items() if row['running']}, set(selection))
                self.assertEqual({name: row['id'] for name, row in self.driver.rows.items()}, original_ids)
                self.assertFalse(self.driver.rows['app']['running'])
                self.assertFalse(any('up' in event['argv'] for event in self.driver.events))
                self.assertEqual([event['argv'][2] for event in self.driver.events
                                  if event['argv'][:2] == ['docker', 'start']],
                                 [mapping[name] for name in selection])
                self.assertFalse(any(event['argv'][2] == '--readiness-probe' for event in self.driver.events))
                self.assertLess(self.clock(), 20)
                self.assertTrue(any(str(event['argv'][1]).endswith('/deploy/docker-inspect.py') for event in self.driver.events))
                if 'worker' in selection:
                    self.assertEqual(self.driver.rows['worker']['health'], 'healthy')

    def test_captured_app_proxy_new_up_and_explicit_check_keep_bounded_public_gate(self):
        cases = [('resume-app-proxy', ('app', 'proxy'), 'start'),
                 ('resume-all', self.module.SERVICES, 'start'),
                 ('up-proxy', ('proxy',), 'up'),
                 ('check-proxy', ('proxy',), 'check')]
        for label, selection, operation in cases:
            with self.subTest(case=label):
                self.clock = Clock()
                self.driver = Driver(self.module, self.clock)
                self.lifecycle = self.module.Lifecycle(self.root, self.env_file, self.driver,
                                                       self.clock, self.clock.advance)
                mapping = None
                if operation == 'start':
                    _, mapping = self.captured(selection)
                    self.lifecycle.stop(mapping, self.deadline(90))
                else:
                    for service in self.module.SERVICES:
                        self.driver.add(service, running=operation == 'check' and service == 'proxy')
                self.driver.events.clear()
                self.driver.public = [False] * 20
                started = self.clock()
                deadline = self.deadline(20)
                if operation == 'check':
                    error_stream = io.StringIO()
                    with mock.patch.object(self.module, 'Lifecycle', return_value=self.lifecycle), \
                            mock.patch.object(self.module, 'Deadline', return_value=deadline), \
                            redirect_stderr(error_stream):
                        status = self.module.main(['--root', str(self.root), '--env-file', str(self.env_file),
                                                   'check', '--timeout', '20', 'proxy'])
                    self.assertEqual(status, 124)
                    result = json.loads(error_stream.getvalue())
                    self.assertEqual(result['code'], 'DEADLINE_EXCEEDED')
                    self.assertFalse(result['cleanupAttempted'])
                    self.assertFalse(any(event['argv'][:2] in (['docker', 'start'], ['docker', 'stop'])
                                         or 'up' in event['argv'] for event in self.driver.events))
                else:
                    with self.assertRaises(self.module.LifecycleError) as failure:
                        self.lifecycle.start(selection, deadline, existing=mapping)
                    self.assertEqual(failure.exception.code, 'DEADLINE_EXCEEDED')
                    self.assertEqual(failure.exception.status, 124)
                self.assertTrue(any(event['argv'][2] == '--readiness-probe' for event in self.driver.events))
                self.assertLessEqual(self.clock() - started, 20.05)
                if operation != 'check':
                    self.assertTrue(self.lifecycle.cleanup())

    def test_failed_writer_listing_never_creates_snapshot_or_starts_snapshot_work(self):
        self.driver.fail_list = True
        path = self.directory / 'failed.json'
        with self.assertRaises(self.module.LifecycleError):
            self.lifecycle.snapshot(path, self.deadline(30))
        self.assertFalse(path.exists())
        self.assertEqual(len(self.driver.events), 1)

    def test_snapshot_refuses_overwrite_and_unstable_or_foreign_container(self):
        path, _ = self.captured(('app',))
        original = path.read_bytes()
        with self.assertRaises(FileExistsError):
            self.lifecycle.snapshot(path, self.deadline(30))
        self.assertEqual(path.read_bytes(), original)
        for field, value in [('project', 'another'), ('paused', True), ('status', 'restarting')]:
            with self.subTest(field=field):
                self.driver.add('app', running=True)
                self.driver.rows['app'][field] = value
                with self.assertRaises(self.module.LifecycleError):
                    self.lifecycle.snapshot(self.directory / ('bad-' + field + '.json'), self.deadline())

    def test_private_snapshot_binding_permissions_and_duplicate_identity_are_enforced(self):
        path, _ = self.captured(('app', 'worker'))
        original = json.loads(path.read_text())
        for mutate in [lambda value: value.update(project='another'),
                       lambda value: value.update(environmentPath='/different/private.env'),
                       lambda value: value['services'][1].update(containerId=value['services'][0]['containerId'])]:
            value = json.loads(json.dumps(original)); mutate(value)
            path.write_text(json.dumps(value))
            with self.assertRaises(self.module.LifecycleError):
                self.lifecycle.load_snapshot(path)
        path.write_text(json.dumps(original)); path.chmod(0o644)
        with self.assertRaises(self.module.LifecycleError):
            self.lifecycle.load_snapshot(path)

    def test_existing_prevalidates_every_captured_id_before_starting_any_service(self):
        _, mapping = self.captured(('app', 'worker'))
        self.lifecycle.stop(mapping, self.deadline())
        self.driver.rows['worker']['id'] = 'f' * 64
        self.driver.events.clear()
        with self.assertRaises(self.module.LifecycleError):
            self.lifecycle.start(tuple(mapping), self.deadline(), existing=mapping)
        self.assertFalse(any(event['argv'][:2] == ['docker', 'start'] for event in self.driver.events))

    def test_up_is_individual_ordered_and_waits_for_real_prior_health(self):
        self.lifecycle.start(self.module.SERVICES, self.deadline())
        up = [event for event in self.driver.events if 'up' in event['argv']]
        self.assertEqual([event['argv'][-1] for event in up], ['app', 'worker', 'proxy'])
        self.assertEqual(up[1]['states']['app']['health'], 'healthy')
        self.assertEqual(up[2]['states']['app']['health'], 'healthy')
        self.assertEqual(up[2]['states']['worker']['health'], 'healthy')
        for event in up:
            self.assertEqual(event['argv'][4:-1], ['up', '-d', '--no-deps', '--no-build', '--pull', 'never'])
        self.assertTrue(all(row['running'] for row in self.driver.rows.values()))

    def test_partial_up_failure_cleans_already_started_exact_services(self):
        self.driver.add('db', running=True)
        self.driver.add('clamav', running=True)
        self.driver.partial_up = 'worker'
        with self.assertRaises(self.module.LifecycleError) as error:
            self.lifecycle.start(self.module.SERVICES, self.deadline())
        self.assertEqual(error.exception.code, 'COMMAND_FAILED')
        self.assertTrue(self.lifecycle.cleanup())
        self.assertFalse(self.driver.rows['app']['running'])
        self.assertFalse(self.driver.rows['worker']['running'])
        self.assertNotIn('proxy', self.driver.rows)
        self.assertTrue(self.driver.rows['db']['running'] and self.driver.rows['clamav']['running'])

    def test_unhealthy_app_blocks_worker_and_proxy(self):
        self.driver.force_unhealthy = 'app'
        with self.assertRaises(self.module.LifecycleError):
            self.lifecycle.start(self.module.SERVICES, self.deadline())
        self.assertEqual(list(self.driver.rows), ['app'])
        self.assertTrue(self.lifecycle.cleanup())

    def test_missing_docker_health_is_allowed_only_for_a_running_proxy(self):
        # The real Docker formatter regression is recorded separately against
        # Caddy, which omits State.Health. Accepting its null observation must
        # not also accept an unchecked app, worker or enabled scanner.
        for service in ('app', 'worker', 'clamav'):
            with self.subTest(service=service):
                self.driver.add(service, running=True)
                row = dict(self.driver.rows[service], health=None)
                with self.assertRaises(self.module.LifecycleError) as error:
                    self.lifecycle.healthy(row)
                self.assertEqual(error.exception.code, 'SERVICE_HEALTHCHECK_MISSING')
        self.driver.add('proxy', running=True)
        proxy = dict(self.driver.rows['proxy'])
        self.assertIsNone(proxy['health'])
        self.assertTrue(self.lifecycle.healthy(proxy))
        for changes in ({'running': False, 'status': 'exited'}, {'paused': True}):
            with self.subTest(changes=changes):
                with self.assertRaises(self.module.LifecycleError) as error:
                    self.lifecycle.healthy(dict(proxy, **changes))
                self.assertEqual(error.exception.code, 'SERVICE_NOT_RUNNING')

    def test_proxy_without_docker_health_still_requires_public_readiness(self):
        for service in self.module.SERVICES:
            self.driver.add(service, running=True)
        self.driver.public = [False] * 10
        mapping = {name: self.driver.rows[name]['id'] for name in self.module.SERVICES}
        with self.assertRaises(self.module.LifecycleError) as error:
            self.lifecycle.wait_ready(mapping, self.deadline(3))
        self.assertEqual(error.exception.code, 'DEADLINE_EXCEEDED')
        self.assertTrue(any(len(event['argv']) > 2 and event['argv'][2] == '--readiness-probe'
                            for event in self.driver.events))
        self.assertFalse(any(event['argv'][1] in {'start', 'stop'} or 'up' in event['argv']
                             for event in self.driver.events))

    def test_empty_existing_snapshot_has_no_docker_av_or_public_action(self):
        path, mapping = self.captured(())
        self.lifecycle.antivirus = True
        self.driver.events.clear()
        self.lifecycle.stop(mapping, self.deadline())
        self.lifecycle.start(tuple(mapping), self.deadline(), existing=mapping)
        self.assertEqual(self.driver.events, [])
        self.assertEqual(json.loads(path.read_text())['services'], [])

    def test_stop_name_selection_accepts_absent_or_stopped_but_never_unselected(self):
        self.driver.add('app', running=True)
        self.driver.add('proxy', running=True)
        rows = self.lifecycle.discover(('app', 'worker'), self.deadline())
        mapping = {name: row['id'] for name, row in rows.items()}
        self.lifecycle.stop(mapping, self.deadline())
        self.lifecycle.stop(mapping, self.deadline())
        self.assertFalse(self.driver.rows['app']['running'])
        self.assertTrue(self.driver.rows['proxy']['running'])

    def test_check_is_read_only_requires_enabled_scanner_and_retries_public_failure(self):
        for service in (*self.module.SERVICES, 'clamav'):
            self.driver.add(service, running=True)
        self.lifecycle.antivirus = True
        self.driver.public = [False, False, True]
        mapping = {name: self.driver.rows[name]['id'] for name in self.module.SERVICES}
        self.lifecycle.wait_ready(mapping, self.deadline(240), scanner=True)
        self.assertGreaterEqual(self.clock(), 4)
        self.assertFalse(any(event['argv'][1] in {'start', 'stop'} or 'up' in event['argv'] for event in self.driver.events))
        self.driver.rows.pop('clamav')
        with self.assertRaises(self.module.LifecycleError):
            self.lifecycle.wait_ready(mapping, self.deadline(240), scanner=True)

    def test_one_deadline_is_shared_by_all_stages_and_final_http(self):
        with self.assertRaises(self.module.LifecycleError) as error:
            self.lifecycle.start(self.module.SERVICES, self.deadline(3))
        self.assertEqual(error.exception.status, 124)
        self.assertNotIn('proxy', self.driver.rows)
        self.assertLessEqual(self.clock(), 3.01)

    def test_stop_failure_is_explicit_and_does_not_claim_cleanup_verified(self):
        self.lifecycle.start(('app',), self.deadline())
        self.driver.fail_stop = True
        self.assertFalse(self.lifecycle.cleanup())
        self.assertTrue(self.driver.rows['app']['running'])

    def test_main_preserves_original_failure_when_cleanup_cannot_stop(self):
        self.driver.partial_up = 'app'; self.driver.fail_stop = True
        error_stream = io.StringIO()
        with mock.patch.object(self.module, 'Lifecycle', return_value=self.lifecycle), redirect_stderr(error_stream):
            status = self.module.main(['--root', str(self.root), '--env-file', str(self.env_file), 'up', 'app'])
        self.assertEqual(status, 1)
        result = json.loads(error_stream.getvalue())
        self.assertEqual(result['code'], 'COMMAND_FAILED')
        self.assertIs(result['cleanupVerified'], False)

    def test_stop_rejects_snapshot_and_service_args_without_daemon_action(self):
        path, _ = self.captured(('app',)); self.driver.events.clear()
        with mock.patch.object(self.module, 'Lifecycle', return_value=self.lifecycle), redirect_stderr(io.StringIO()):
            status = self.module.main(['--root', str(self.root), '--env-file', str(self.env_file), 'stop', '--snapshot', str(path), 'worker'])
        self.assertEqual(status, 1)
        self.assertEqual(self.driver.events, [])

    def test_unexpected_cleanup_error_never_masks_original_failure_or_prints_driver_detail(self):
        self.driver.partial_up = 'app'
        output = io.StringIO()
        with mock.patch.object(self.module, 'Lifecycle', return_value=self.lifecycle), \
                mock.patch.object(self.lifecycle, 'stop', side_effect=TypeError('private-driver-marker')), \
                redirect_stderr(output):
            status = self.module.main(['--root', str(self.root), '--env-file', str(self.env_file), 'up', 'app'])
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(output.getvalue())['code'], 'COMMAND_FAILED')
        self.assertIs(json.loads(output.getvalue())['cleanupVerified'], False)
        self.assertNotIn('private-driver-marker', output.getvalue())

    def test_failed_command_reports_real_child_cap_without_arguments_or_output(self):
        self.lifecycle.runner = self.module.CommandRunner()
        private = 'token=private-diagnostic-marker https://private.invalid/ ' + 'f' * 64
        command = [sys.executable, '-c',
                   'import sys,time; print(sys.argv[1],flush=True); '
                   'print(sys.argv[1],file=sys.stderr,flush=True); time.sleep(10)', private]
        with self.assertRaises(self.module.LifecycleError) as failure:
            self.lifecycle.run_command(command, self.module.Deadline(3), maximum=0.08,
                                       command_class='container-inspect', services=('app',))
        self.assertEqual((failure.exception.code, failure.exception.status), ('COMMAND_TIMEOUT', 124))
        context = self.module.failed_command_snapshot(failure.exception)
        self.assertEqual(set(context), {'class', 'services', 'elapsedSeconds', 'suppliedMaximumSeconds',
                                        'effectiveMaximumSeconds', 'overallRemainingSeconds'})
        self.assertEqual((context['class'], context['services']), ('container-inspect', ['app']))
        self.assertEqual(context['suppliedMaximumSeconds'], 0.08)
        self.assertEqual(context['effectiveMaximumSeconds'], 0.08)
        self.assertGreaterEqual(context['elapsedSeconds'], 0.075)
        self.assertLess(context['elapsedSeconds'], 1)
        self.assertGreater(context['overallRemainingSeconds'], 1)
        self.assertIs(self.lifecycle.runner.termination_verified, True)
        serialized = json.dumps(context)
        for forbidden in (private, 'private-diagnostic-marker', 'private.invalid', 'f' * 64,
                          sys.executable, 'time.sleep', 'stdout', 'stderr'):
            self.assertNotIn(forbidden, serialized)

    def test_failed_command_survives_actual_cleanup_failure_with_original_exit(self):
        environment = self.process_fixture()
        docker = self.directory / 'bin/docker'
        original = docker.read_text()
        stop = "elif args[:3]==['stop','--time','60']: (root/'stopped').touch()"
        self.assertIn(stop, original)
        docker.write_text(original.replace(stop, "elif args[:3]==['stop','--time','60']: "
                          "print('private-cleanup-output',file=sys.stderr); raise SystemExit(3)"))
        process = subprocess.run([sys.executable, str(self.root / 'deploy/service-lifecycle.py'),
            '--root', str(self.root), '--env-file', str(self.env_file), 'up', '--timeout', '1', 'app'],
            env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=5)
        self.assertEqual(process.returncode, 124, process.stderr)
        self.assertEqual(process.stdout, '')
        result = json.loads(process.stderr)
        self.assertEqual(result['code'], 'DEADLINE_EXCEEDED')
        self.assertIs(result['cleanupAttempted'], True)
        self.assertIs(result['cleanupVerified'], False)
        self.assertIs(result['clientProcessTerminationVerified'], True)
        context = result['failedCommand']
        self.assertEqual((context['class'], context['services']), ('container-inspect', ['app']))
        self.assertEqual(context['suppliedMaximumSeconds'], 15)
        self.assertGreater(context['effectiveMaximumSeconds'], 0)
        self.assertLessEqual(context['effectiveMaximumSeconds'], 1)
        self.assertEqual(context['overallRemainingSeconds'], 0)
        for forbidden in ('private-cleanup-output', str(self.root), str(self.env_file),
                          hashlib.sha256(b'app').hexdigest(), 'site.invalid'):
            self.assertNotIn(forbidden, process.stderr)
        self.assert_fixture_client_exited()

    def test_failed_command_is_copied_before_cleanup_can_change_exception_metadata(self):
        failure = self.module.LifecycleError('COMMAND_TIMEOUT', 124)
        failure._command_context = {'class': 'container-list', 'services': ['app']}
        failure._command_timing = {'elapsedSeconds': 0.25, 'suppliedMaximumSeconds': 60,
                                   'effectiveMaximumSeconds': 0.25, 'overallRemainingSeconds': 20}

        def cleanup():
            failure._command_context['class'] = 'container-stop'
            failure._command_context['services'].append('worker')
            failure._command_timing['elapsedSeconds'] = 90
            return False

        output = io.StringIO()
        with mock.patch.object(self.module, 'Lifecycle', return_value=self.lifecycle), \
                mock.patch.object(self.lifecycle, 'start', side_effect=failure), \
                mock.patch.object(self.lifecycle, 'cleanup', side_effect=cleanup), redirect_stderr(output):
            status = self.module.main(['--root', str(self.root), '--env-file', str(self.env_file), 'up', 'app'])
        result = json.loads(output.getvalue())
        self.assertEqual((status, result['code']), (124, 'COMMAND_TIMEOUT'))
        self.assertIs(result['cleanupVerified'], False)
        self.assertEqual(result['failedCommand']['class'], 'container-list')
        self.assertEqual(result['failedCommand']['services'], ['app'])
        self.assertEqual(result['failedCommand']['elapsedSeconds'], 0.25)

    def test_failed_command_invalid_metadata_is_omitted_without_changing_exit_codes(self):
        for code, status, context, timing in (
            ('COMMAND_FAILED', 1, {'class': 'secret-class', 'services': ['app']}, {}),
            ('COMMAND_TIMEOUT', 124, {'class': 'container-start', 'services': ['secret-service']}, {}),
            ('INTERRUPTED', 143, {'class': 'container-start', 'services': ['app']},
             {'elapsedSeconds': float('nan'), 'suppliedMaximumSeconds': None,
              'effectiveMaximumSeconds': 5, 'overallRemainingSeconds': 0}),
        ):
            with self.subTest(code=code):
                failure = self.module.LifecycleError(code, status)
                failure._command_context, failure._command_timing = context, timing
                output = io.StringIO()
                with mock.patch.object(self.module, 'Lifecycle', return_value=self.lifecycle), \
                        mock.patch.object(self.lifecycle, 'start', side_effect=failure), \
                        mock.patch.object(self.lifecycle, 'cleanup', return_value=False), redirect_stderr(output):
                    actual = self.module.main(['--root', str(self.root), '--env-file', str(self.env_file), 'up', 'app'])
                result = json.loads(output.getvalue())
                self.assertEqual((actual, result['code'], result['exitCode']), (status, code, status))
                self.assertNotIn('failedCommand', result)
                self.assertNotIn('secret', output.getvalue())

    def test_failed_command_recording_error_preserves_real_child_failure_and_termination(self):
        original_error = self.module.LifecycleError

        class RejectDiagnosticMetadata(original_error):
            def __setattr__(self, name, value):
                if name in {'_command_context', '_command_timing'}:
                    raise RuntimeError('private-diagnostic-write-error')
                super().__setattr__(name, value)

        self.lifecycle.runner = self.module.CommandRunner()
        with mock.patch.object(self.module, 'LifecycleError', RejectDiagnosticMetadata):
            with self.assertRaises(RejectDiagnosticMetadata) as failure:
                self.lifecycle.run_command([sys.executable, '-c', 'raise SystemExit(7)'],
                                           self.module.Deadline(2), maximum=None,
                                           command_class='container-start', services=('worker',))
        self.assertEqual((failure.exception.code, failure.exception.status), ('COMMAND_FAILED', 1))
        self.assertIs(self.lifecycle.runner.termination_verified, True)
        self.assertIsNone(self.module.failed_command_snapshot(failure.exception))
        self.assertNotIn('private-diagnostic-write-error', str(failure.exception))

    def test_failed_command_retryable_public_timeout_does_not_label_later_failure(self):
        self.driver.add('app', running=True)
        self.driver.add('proxy', running=True)
        original_run = self.driver.run
        probes = []

        def run(argv, deadline, maximum=60):
            if len(argv) > 2 and argv[2] == '--readiness-probe':
                probes.append(True)
                failure = self.module.LifecycleError('COMMAND_TIMEOUT', 124)
                failure._command_timing = {'elapsedSeconds': 12, 'suppliedMaximumSeconds': maximum,
                                           'effectiveMaximumSeconds': maximum, 'overallRemainingSeconds': 100}
                raise failure
            return original_run(argv, deadline, maximum=maximum)

        output = io.StringIO()
        with mock.patch.object(self.driver, 'run', side_effect=run), \
                mock.patch.object(self.module, 'Lifecycle', return_value=self.lifecycle), \
                mock.patch.object(self.lifecycle, 'pause', side_effect=self.module.LifecycleError('SERVICE_UNHEALTHY')), \
                redirect_stderr(output):
            status = self.module.main(['--root', str(self.root), '--env-file', str(self.env_file),
                                       'check', 'app', 'proxy'])
        self.assertEqual(len(probes), 1)
        result = json.loads(output.getvalue())
        self.assertEqual((status, result['code']), (1, 'SERVICE_UNHEALTHY'))
        self.assertNotIn('failedCommand', result)

    def test_public_probe_requires_exact_http_and_readiness_fields(self):
        class Response:
            def __init__(self, status, body): self.status, self.body = status, body
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, limit): return self.body[:limit]
        good = {'status': 'ok', 'database': 'ok', 'privacy': 'ready'}
        cases = [(200, json.dumps(good).encode(), True), (503, json.dumps(good).encode(), False),
                 (302, json.dumps(good).encode(), False), (200, b'not-json', False),
                 (200, b'x' * (self.module.SNAPSHOT_LIMIT + 1), False)]
        for key in good:
            bad = dict(good); bad[key] = 'not-ready'; cases.append((200, json.dumps(bad).encode(), False))
        for status, body, expected in cases:
            opener = mock.Mock(); opener.open.return_value = Response(status, body)
            with mock.patch.object(self.module.urllib.request, 'build_opener', return_value=opener) as factory:
                self.assertEqual(self.module.http_probe('https://site.invalid/api/v1/health/ready', 1), expected)
                handlers = factory.call_args.args
                self.assertIsInstance(handlers[0], self.module.NoRedirect)
                self.assertEqual(handlers[1]._context.verify_mode, ssl.CERT_REQUIRED)
                self.assertTrue(handlers[1]._context.check_hostname)
        self.assertIsNone(self.module.NoRedirect().redirect_request(None, None, 302, '', {}, 'https://other.invalid'))

    def test_public_probe_treats_reset_and_protocol_errors_as_retryable(self):
        for error in [ConnectionResetError(), TimeoutError(), OSError(), urllib.error.URLError('fixture'),
                      http.client.RemoteDisconnected(), http.client.IncompleteRead(b'partial')]:
            opener = mock.Mock(); opener.open.side_effect = error
            with self.subTest(error=type(error).__name__), mock.patch.object(self.module.urllib.request, 'build_opener', return_value=opener):
                self.assertIs(self.module.http_probe('https://site.invalid/api/v1/health/ready', 1), False)

    def test_probe_is_owned_child_with_timeout_capped_to_remaining_budget(self):
        self.driver.public = [False, True]
        deadline = self.deadline(4)
        self.assertFalse(self.lifecycle.public_ready(deadline))
        self.assertTrue(self.lifecycle.public_ready(deadline))
        for event in self.driver.events:
            self.assertEqual(event['argv'][2], '--readiness-probe')
            self.assertLessEqual(float(event['argv'][-1]), 4)

    def test_public_probe_never_retries_or_succeeds_after_unverified_client_termination(self):
        for outcome in ('timeout', 'success'):
            with self.subTest(outcome=outcome):
                self.driver.termination_verified = True
                def run(*_args, **_kwargs):
                    self.driver.termination_verified = False
                    if outcome == 'timeout':
                        raise self.module.LifecycleError('COMMAND_TIMEOUT', 124)
                    return b''
                with mock.patch.object(self.driver, 'run', side_effect=run) as call:
                    with self.assertRaises(self.module.LifecycleError) as failure:
                        self.lifecycle.public_ready(self.deadline())
                    self.assertEqual(failure.exception.code,
                                     'COMMAND_TIMEOUT' if outcome == 'timeout' else 'CLIENT_PROCESS_NOT_REAPED')
                    self.assertEqual(call.call_count, 1)
                    with self.assertRaises(self.module.LifecycleError):
                        self.lifecycle.public_ready(self.deadline())
                    self.assertEqual(call.call_count, 1)

    def test_invalid_origin_or_duplicate_selection_fails_before_start(self):
        for origin in ['https://user:secret@site.invalid', 'file:///etc/passwd', 'https://site.invalid/?secret=x']:
            self.lifecycle.site_url = origin
            with self.assertRaises(self.module.LifecycleError):
                self.lifecycle.start(('proxy',), self.deadline())
        with self.assertRaises(self.module.LifecycleError):
            self.module.selected_services(('app', 'app'))
        self.assertEqual(self.driver.events, [])

    def test_implementation_location_is_independent_of_historical_compose_root(self):
        historical = self.directory / 'old-release'
        (historical / 'deploy').mkdir(parents=True)
        (historical / 'deploy/compose.py').write_text('# historical selected wrapper\n')
        old = self.module.Lifecycle(historical, self.env_file, self.driver, self.clock, self.clock.advance)
        old.start(('app',), self.deadline())
        commands = [event['argv'] for event in self.driver.events if 'up' in event['argv']]
        self.assertEqual(commands[0][1], str(historical / 'deploy/compose.py'))
        self.assertFalse((historical / 'deploy/service-lifecycle.py').exists())

    def write_compose_fixture(self, code):
        # Like the shipped wrapper, importing a disposable CLI must not run it.
        # It intentionally has no environment() API, so inspection retains the
        # fixture's original Docker CLI and all process/cleanup assertions.
        (self.root / 'deploy/compose.py').write_text('if __name__ == "__main__":\n' + textwrap.indent(code, ' '))

    def process_fixture(self, close_stdio=False):
        binary = self.directory / 'bin'; binary.mkdir(exist_ok=True)
        identifier = hashlib.sha256(b'app').hexdigest()
        self.write_compose_fixture('''import json,pathlib,sys
root=pathlib.Path(sys.argv[1]).parent
args=sys.argv[3:]
if args[0]=='up': (root/'started').touch()
elif args[0]=='list-existing': print(json.dumps({'id':''' + repr(identifier) + ''','service':'app'}))
else: raise SystemExit(2)
''')
        docker = binary / 'docker'
        docker.write_text('#!' + sys.executable + '''
import json,os,pathlib,sys,time
root=pathlib.Path(os.environ['LIFECYCLE_FIXTURE_DIRECTORY'])
args=sys.argv[1:]
if args[0]=='inspect':
 if not (root/'blocked-pid').exists():
  if ''' + repr(close_stdio) + ''':
   os.close(1)
   os.close(2)
  (root/'blocked-pid').write_text(str(os.getpid()))
  time.sleep(30)
 running=(root/'started').exists() and not (root/'stopped').exists()
 print(json.dumps({'id':''' + repr(identifier) + ''','project':'idealmakoo','service':'app','running':running,'paused':False,'status':'running' if running else 'exited','health':'healthy'}))
elif args[:3]==['stop','--time','60']: (root/'stopped').touch()
else: raise SystemExit(3)
''')
        docker.chmod(0o700)
        return {**os.environ, 'PATH': str(binary) + os.pathsep + os.environ['PATH'],
                'LIFECYCLE_FIXTURE_DIRECTORY': str(self.directory)}

    def wait_for_fixture(self, process):
        end = time.monotonic() + 3
        while not (self.directory / 'blocked-pid').exists():
            if process.poll() is not None or time.monotonic() >= end:
                self.fail('Disposable fixture did not reach the intended blocking boundary.')
            time.sleep(0.01)

    def assert_fixture_client_exited(self):
        pid = int((self.directory / 'blocked-pid').read_text())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    def test_actual_signal_terminates_owned_client_then_cleans_once_and_preserves_status(self):
        self.assert_actual_signal_termination(close_stdio=False)

    def test_actual_closed_stdio_stall_preserves_signal_status_and_terminates_client(self):
        self.assert_actual_signal_termination(close_stdio=True)

    def assert_actual_signal_termination(self, close_stdio):
        for signum in (signal.SIGINT, signal.SIGTERM):
            with self.subTest(signum=signum):
                for name in ('blocked-pid', 'started', 'stopped'):
                    (self.directory / name).unlink(missing_ok=True)
                environment = self.process_fixture(close_stdio=close_stdio)
                process = subprocess.Popen([sys.executable, str(self.root / 'deploy/service-lifecycle.py'),
                    '--root', str(self.root), '--env-file', str(self.env_file), 'up', '--timeout', '5', 'app'],
                    env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                try:
                    self.wait_for_fixture(process)
                    process.send_signal(signum)
                    stdout, stderr = process.communicate(timeout=4)
                    self.assertEqual(process.returncode, 128 + signum, stderr)
                    self.assertEqual(stdout, '')
                    result = json.loads(stderr)
                    self.assertIs(result['cleanupVerified'], True)
                    self.assertTrue((self.directory / 'stopped').exists())
                    self.assert_fixture_client_exited()
                finally:
                    if process.poll() is None:
                        process.kill(); process.communicate(timeout=2)

    def test_actual_blocked_inspect_cannot_exceed_total_deadline_or_claim_readiness(self):
        environment = self.process_fixture()
        started = time.monotonic()
        process = subprocess.run([sys.executable, str(self.root / 'deploy/service-lifecycle.py'),
            '--root', str(self.root), '--env-file', str(self.env_file), 'check', '--timeout', '1', 'app'],
            env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, timeout=4)
        self.assertEqual(process.returncode, 124, process.stderr)
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(process.stdout, '')
        self.assertIs(json.loads(process.stderr)['cleanupAttempted'], False)
        self.assertFalse((self.directory / 'started').exists() or (self.directory / 'stopped').exists())
        self.assert_fixture_client_exited()

    def startup_latency_driver(self, seconds, observations):
        original_run = self.driver.run

        def run(argv, deadline, maximum=60):
            started = self.clock()
            budget = deadline.remaining(maximum)
            mutating = ((str(argv[1]).endswith('/deploy/compose.py') and argv[4] == 'up')
                        or argv[:2] == ['docker', 'start'])
            observations.append({'argv': list(argv), 'deadline': deadline,
                                 'maximum': maximum, 'budget': budget, 'mutating': mutating})
            # Docker may apply a mutation before its client finishes, so retain
            # the fixture's side effect even if the command budget expires.
            result = original_run(argv, deadline, maximum=maximum)
            if mutating:
                self.clock.advance(max(0, min(seconds, budget) - (self.clock() - started)))
                if seconds >= budget:
                    self.clock.advance(0.000001)
                    deadline.remaining()
                    raise self.module.LifecycleError('COMMAND_TIMEOUT', 124)
                deadline.remaining()
            return result

        return run

    def test_slow_mutating_up_and_existing_start_finish_within_operation_budget(self):
        for existing in (False, True):
            with self.subTest(existing=existing):
                self.clock = Clock()
                self.driver = Driver(self.module, self.clock)
                self.lifecycle = self.module.Lifecycle(self.root, self.env_file, self.driver,
                                                       self.clock, self.clock.advance)
                mapping = None
                if existing:
                    for service in self.module.SERVICES:
                        self.driver.add(service)
                    mapping = {name: row['id'] for name, row in self.driver.rows.items()}
                observations = []
                deadline = self.deadline(400)
                delayed = self.startup_latency_driver(75, observations)
                with mock.patch.object(self.driver, 'run', side_effect=delayed):
                    try:
                        self.lifecycle.start(self.module.SERVICES, deadline, existing=mapping)
                    except self.module.LifecycleError as error:
                        self.fail('75-second startup with remaining operation budget failed: ' + error.code)
                mutations = [entry for entry in observations if entry['mutating']]
                self.assertEqual(len(mutations), 3)
                self.assertTrue(all(entry['budget'] > 75 for entry in mutations))
                self.assertTrue(all(entry['deadline'] is deadline for entry in observations))
                self.assertGreaterEqual(self.clock(), 225)
                self.assertLess(self.clock(), 400)
                self.assertTrue(all(row['running'] for row in self.driver.rows.values()))
                self.assertTrue(all(self.driver.rows[name]['health'] == 'healthy' for name in ('app', 'worker')))
                if existing:
                    self.assertEqual({name: row['id'] for name, row in self.driver.rows.items()}, mapping)
                lists = [entry for entry in observations
                         if str(entry['argv'][1]).endswith('/deploy/compose.py') and entry['argv'][4] == 'list-existing']
                inspections = [entry for entry in observations if str(entry['argv'][1]).endswith('/deploy/docker-inspect.py')]
                probes = [entry for entry in observations if entry['argv'][2] == '--readiness-probe']
                if not existing:
                    self.assertTrue(lists)
                self.assertTrue(inspections and probes)
                self.assertTrue(all(entry['maximum'] == 60 for entry in lists))
                self.assertTrue(all(entry['maximum'] == 15 for entry in inspections))
                self.assertTrue(all(0 < entry['maximum'] <= 12 for entry in probes))

    def test_slow_mutating_starts_exhaust_one_deadline_before_later_service(self):
        for existing in (False, True):
            with self.subTest(existing=existing):
                self.clock = Clock()
                self.driver = Driver(self.module, self.clock)
                self.lifecycle = self.module.Lifecycle(self.root, self.env_file, self.driver,
                                                       self.clock, self.clock.advance)
                self.driver.add('db', running=True)
                self.driver.add('clamav', running=True)
                mapping = None
                if existing:
                    for service in self.module.SERVICES:
                        self.driver.add(service)
                    mapping = {name: self.driver.rows[name]['id'] for name in self.module.SERVICES}
                observations = []
                deadline = self.deadline(70)
                delayed = self.startup_latency_driver(40, observations)
                with mock.patch.object(self.driver, 'run', side_effect=delayed):
                    with self.assertRaises(self.module.LifecycleError) as failure:
                        self.lifecycle.start(self.module.SERVICES, deadline, existing=mapping)
                    self.assertEqual(failure.exception.code, 'DEADLINE_EXCEEDED')
                    self.assertEqual(failure.exception.status, 124)
                    self.assertAlmostEqual(self.clock(), 70, places=4)
                    mutations = [entry for entry in observations if entry['mutating']]
                    self.assertEqual(len(mutations), 2)
                    self.assertLess(mutations[1]['budget'], 40)
                    self.assertTrue(all(entry['deadline'] is deadline for entry in observations))
                    self.assertFalse(any(entry['argv'][2] == '--readiness-probe' for entry in observations))
                    self.assertEqual(list(self.lifecycle.attempted), ['app', 'worker'])
                    self.assertTrue(self.lifecycle.cleanup())
                self.assertFalse(self.driver.rows['app']['running'] or self.driver.rows['worker']['running'])
                self.assertTrue(self.driver.rows['db']['running'] and self.driver.rows['clamav']['running'])
                if existing:
                    self.assertFalse(self.driver.rows['proxy']['running'])
                else:
                    self.assertNotIn('proxy', self.driver.rows)

    def test_actual_hung_mutating_child_and_descendant_end_at_deadline_with_cleanup(self):
        identifier = hashlib.sha256(b'app').hexdigest()
        self.write_compose_fixture('''import json,os,pathlib,signal,subprocess,sys,time
root=pathlib.Path(os.environ['LIFECYCLE_FIXTURE_DIRECTORY'])
def identity(name):
 fields=pathlib.Path('/proc/self/stat').read_text().rsplit(')',1)[1].split()
 (root/name).write_text(json.dumps({'pid':os.getpid(),'startTicks':int(fields[19]),'pgid':os.getpgrp()}))
if sys.argv[1:]==['--descendant']:
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 identity('startup-descendant.json')
 time.sleep(30)
 raise SystemExit(0)
args=sys.argv[3:]
if args[0]=='up':
 (root/'started').touch()
 identity('startup-client.json')
 subprocess.Popen([sys.executable,__file__,'--descendant'])
 time.sleep(30)
elif args==['list-existing','app']:
 print(json.dumps({'id':''' + repr(identifier) + ''','service':'app'}))
else: raise SystemExit(71)
''')
        binary = self.directory / 'bin'
        binary.mkdir()
        docker = binary / 'docker'
        docker.write_text('#!' + sys.executable + '''
import json,os,pathlib,sys
root=pathlib.Path(os.environ['LIFECYCLE_FIXTURE_DIRECTORY'])
args=sys.argv[1:]
with (root/'docker-calls.jsonl').open('a') as output: output.write(json.dumps(args)+'\\n')
identifier=''' + repr(identifier) + '''
if args[:3]==['inspect','--type','container']:
 assert args[5:]==[identifier]
 running=(root/'started').exists() and not (root/'stopped').exists()
 print(json.dumps({'id':identifier,'project':'idealmakoo','service':'app',
  'running':running,'paused':False,'status':'running' if running else 'exited','health':'healthy'}))
elif args==['stop','--time','60',identifier]: (root/'stopped').touch()
else: raise SystemExit(72)
''')
        docker.chmod(0o700)
        environment = {**os.environ, 'PATH': str(binary) + os.pathsep + os.environ['PATH'],
                       'LIFECYCLE_FIXTURE_DIRECTORY': str(self.directory)}

        def same_live_process(record):
            try:
                fields = Path('/proc', str(record['pid']), 'stat').read_text().rsplit(')', 1)[1].split()
            except FileNotFoundError:
                return False
            return int(fields[19]) == record['startTicks'] and fields[0] != 'Z'

        started = time.monotonic()
        process = subprocess.Popen([sys.executable, str(self.root / 'deploy/service-lifecycle.py'),
            '--root', str(self.root), '--env-file', str(self.env_file), 'up', '--timeout', '2', 'app'],
            env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, start_new_session=True)
        try:
            try:
                stdout, stderr = process.communicate(timeout=7)
            except subprocess.TimeoutExpired:
                self.fail('Mutating startup escaped its operation deadline and cleanup bound.')
            self.assertLess(time.monotonic() - started, 6)
            self.assertEqual(process.returncode, 124, stderr)
            self.assertEqual(stdout, '')
            result = json.loads(stderr)
            self.assertIn(result['code'], {'DEADLINE_EXCEEDED', 'COMMAND_TIMEOUT'})
            self.assertTrue(result['cleanupAttempted'] and result['cleanupVerified'])
            self.assertTrue(result['clientProcessTerminationVerified'])
            self.assertTrue((self.directory / 'stopped').is_file())
            calls = [json.loads(line) for line in (self.directory / 'docker-calls.jsonl').read_text().splitlines()]
            self.assertEqual(sum(args[:3] == ['stop', '--time', '60'] for args in calls), 1)
            for name in ('startup-client.json', 'startup-descendant.json'):
                record = json.loads((self.directory / name).read_text())
                self.assertFalse(same_live_process(record), name + ' is still executing')
        finally:
            for name in ('startup-descendant.json', 'startup-client.json'):
                path = self.directory / name
                if path.is_file():
                    record = json.loads(path.read_text())
                    if same_live_process(record):
                        try:
                            if (os.getpgid(record['pid']) == record['pgid']
                                    and record['pgid'] != os.getpgrp()):
                                os.killpg(record['pgid'], signal.SIGKILL)
                        except ProcessLookupError:
                            pass
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.communicate(timeout=2)

    def test_installer_exit_listing_is_bounded_kills_descendant_and_preserves_original_status(self):
        # Execute the shipped EXIT trap and Compose wrapper, with only Docker
        # replaced. No installer preflight, package install or daemon is used.
        for name in ('lib.sh', 'compose.py'):
            shutil.copy(REFERENCE / 'deploy' / name, self.root / 'deploy' / name)
        (self.root / 'docker-compose.yml').write_text('services: {}\n')
        scripts = self.root / 'scripts'
        scripts.mkdir()
        (scripts / 'doctor.sh').touch()
        installer = (ROOT / 'scripts/install-ubuntu.sh').read_text()
        self.assertEqual(installer.count('usage() {\n'), 1)
        fixture = scripts / 'failure-trap.sh'
        fixture.write_text(installer.split('usage() {\n', 1)[0] + '''
release_dir="$PROJECT_ROOT"
ENV_FILE="$1"
stop_writers_on_failure=1
install_phase='fixture original failure'
exit 37
''')
        binary = self.directory / 'bin'
        binary.mkdir()
        docker = binary / 'docker'
        docker.write_text('#!' + sys.executable + '''
import hashlib,json,os,pathlib,signal,subprocess,sys,time
root=pathlib.Path(os.environ['LIFECYCLE_FIXTURE_DIRECTORY'])
def identity(name):
 fields=pathlib.Path('/proc/self/stat').read_text().rsplit(')',1)[1].split()
 (root/name).write_text(json.dumps({'pid':os.getpid(),'startTicks':int(fields[19]),'pgid':os.getpgrp()}))
args=sys.argv[1:]
if args==['--descendant']:
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 identity('listing-descendant.json')
 time.sleep(60)
 raise SystemExit(0)
with (root/'docker-calls.jsonl').open('a') as output: output.write(json.dumps(args)+'\\n')
ids={hashlib.sha256(name.encode()).hexdigest():name for name in ('app','worker')}
if args[0]=='compose':
 tail=args[args.index('ps')+1:]
 if not tail:
  identity('listing-client.json')
  subprocess.Popen([sys.executable,__file__,'--descendant'])
  time.sleep(60)
 else: raise SystemExit(61)
elif args[:2]==['container','ls']:
 assert '--all' in args and '--no-trunc' in args
 for identifier,service in ids.items(): print(json.dumps({'id':identifier,'service':service}))
elif args[:3]==['inspect','--type','container']:
 running=not (root/'writers-stopped').exists()
 for identifier in args[5:]:
  print(json.dumps({'id':identifier,'project':'idealmakoo','service':ids[identifier],
   'running':running,'paused':False,'status':'running' if running else 'exited','health':'healthy'}))
elif args[:3]==['stop','--time','60']:
 assert set(args[3:])==set(ids)
 (root/'writers-stopped').touch()
else: raise SystemExit(62)
''')
        docker.chmod(0o700)
        environment = {**os.environ, 'PATH': str(binary) + os.pathsep + os.environ['PATH'],
                       'LIFECYCLE_FIXTURE_DIRECTORY': str(self.directory)}

        def same_live_process(record):
            try:
                fields = Path('/proc', str(record['pid']), 'stat').read_text().rsplit(')', 1)[1].split()
            except FileNotFoundError:
                return False
            return int(fields[19]) == record['startTicks'] and fields[0] != 'Z'

        started = time.monotonic()
        process = subprocess.Popen(['bash', str(fixture), str(self.env_file)], cwd=self.root,
                                   env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True, start_new_session=True)
        try:
            try:
                stdout, stderr = process.communicate(timeout=20)
            except subprocess.TimeoutExpired:
                self.fail('Installer EXIT diagnostic exceeded its bounded lifetime.')
            self.assertLess(time.monotonic() - started, 19)
            self.assertEqual(process.returncode, 37, stderr)
            self.assertIn('fixture original failure (exit 37)', stderr)
            self.assertTrue((self.directory / 'writers-stopped').is_file())
            calls = [json.loads(line) for line in (self.directory / 'docker-calls.jsonl').read_text().splitlines()]
            stop = next(index for index, args in enumerate(calls) if args[:3] == ['stop', '--time', '60'])
            listing = next(index for index, args in enumerate(calls) if args[0] == 'compose' and args[-1] == 'ps')
            self.assertLess(stop, listing)
            failures = [json.loads(line) for line in stderr.splitlines() if line.startswith('{"operation":')]
            self.assertEqual(len(failures), 1, stderr)
            self.assertEqual(failures[0]['operation'], 'ps')
            self.assertEqual(failures[0]['exitCode'], 124)
            self.assertFalse(failures[0]['cleanupAttempted'])
            self.assertTrue(failures[0]['clientProcessTerminationVerified'])
            for name in ('listing-client.json', 'listing-descendant.json'):
                record = json.loads((self.directory / name).read_text())
                self.assertFalse(same_live_process(record), name + ' is still executing')
        finally:
            # Also bound a failing pre-fix run. Signal only still-matching
            # disposable process identities/groups created by this fixture.
            for name in ('listing-descendant.json', 'listing-client.json'):
                path = self.directory / name
                if path.is_file():
                    record = json.loads(path.read_text())
                    if same_live_process(record):
                        try:
                            if (os.getpgid(record['pid']) == record['pgid']
                                    and record['pgid'] != os.getpgrp()):
                                os.killpg(record['pgid'], signal.SIGKILL)
                        except ProcessLookupError:
                            pass
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.communicate(timeout=2)


if __name__ == '__main__':
    unittest.main()
