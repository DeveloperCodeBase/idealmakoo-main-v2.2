"""Exercise local Docker inspection through disposable Unix HTTP/CLI fixtures.

No Docker daemon, container or TCP listener is used. The optional source root
selects the preserved lifecycle for the narrow original-CLI regression proof.
"""
import hashlib
import http.server
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import socketserver
import stat
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get('IDEALMAKOO_TEST_INSPECT_SOURCE_ROOT', ROOT))


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def identity(name):
    return hashlib.sha256(name.encode()).hexdigest()


def observation(name, **changes):
    value = {'Id': identity(name), 'Config': {
        'Labels': {'com.docker.compose.project': 'idealmakoo', 'com.docker.compose.service': name},
        'Env': ['FIXTURE_PRIVATE=must-never-escape']},
        'State': {'Running': True, 'Paused': False, 'Status': 'running'}}
    if name != 'proxy':
        value['State']['Health'] = {'Status': 'healthy', 'Log': [{'Output': 'private-health-output'}]}
    value.update(changes)
    return value


class UnixServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True
    block_on_close = False


class DockerInspectTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-inspect-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.root = self.directory / 'release'
        (self.root / 'deploy').mkdir(parents=True)
        for name in ('compose.py', 'env-file.py'):
            shutil.copyfile(ROOT / 'deploy' / name, self.root / 'deploy' / name)
        (self.root / 'docker-compose.yml').write_text('services:\n  app:\n    image: ${APP_IMAGE}\n')
        self.envfile = self.directory / 'protected.env'
        self.envfile.write_text('COMPOSE_PROJECT_NAME=idealmakoo\nSITE_URL=http://127.0.0.1:3088\n')
        self.envfile.chmod(0o600)
        self.home = self.directory / 'home'
        self.home.mkdir()
        self.bin = self.directory / 'bin'
        self.bin.mkdir()
        self.environment = {'HOME': str(self.home), 'PATH': str(self.bin) + ':/usr/bin:/bin',
                            'PYTHONDONTWRITEBYTECODE': '1', 'LANG': 'C.UTF-8'}
        self.helper = load(ROOT / 'deploy/docker-inspect.py', 'inspect_fixture')
        self.lifecycle_module = load(SOURCE / 'deploy/service-lifecycle.py', 'inspect_lifecycle_fixture')
        self.requests = []
        self.responses = {}
        self.socket = self.directory / 'fixture.sock'
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *_arguments):
                pass

            def do_GET(self):
                owner.requests.append(self.path)
                reply = owner.responses.get(self.path)
                if reply is None:
                    if self.path == '/version':
                        value = {'ApiVersion': '1.56', 'MinAPIVersion': '1.40'}
                    else:
                        name = next((name for name in ('app', 'worker', 'proxy', 'clamav')
                                     if '/' + identity(name) + '/json?size=false' in self.path), None)
                        value = observation(name) if name else {'message': 'private-error'}
                    reply = {'body': json.dumps(value).encode()}
                body = reply.get('body', b'')
                self.send_response(reply.get('status', 200))
                headers = reply.get('headers', [('Content-Type', 'application/json'),
                                                ('Content-Length', str(len(body)))])
                for key, value in headers:
                    self.send_header(key, value)
                self.end_headers()
                try:
                    if reply.get('trickle'):
                        for byte in body:
                            self.wfile.write(bytes([byte]))
                            self.wfile.flush()
                            time.sleep(reply['trickle'])
                    else:
                        self.wfile.write(body)
                        self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError):
                    pass
                if reply.get('close'):
                    self.close_connection = True

        self.server = UnixServer(str(self.socket), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever,
                                       kwargs={'poll_interval': 0.01}, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)

    def close_server(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=1)

    def config(self, text):
        directory = self.home / '.docker'
        directory.mkdir(exist_ok=True)
        path = directory / 'config.json'
        path.unlink(missing_ok=True)
        path.write_text(text)
        return path

    def qualify(self, environment=None):
        # Only the synthetic CLI identity and socket's uid are substituted.
        # Real protected-environment construction and config parsing still run.
        original_stat = Path.stat
        endpoint = str(self.socket)

        def owned_socket_stat(path, *args, **kwargs):
            value = original_stat(path, *args, **kwargs)
            return SimpleNamespace(st_mode=value.st_mode, st_uid=0) if str(path) == endpoint else value

        with mock.patch.object(self.helper, 'DEFAULT_SOCKET', endpoint), \
                mock.patch.object(self.helper, 'standard_docker', return_value=True), \
                mock.patch.object(Path, 'stat', owned_socket_stat):
            return self.helper.qualified_socket(self.root, self.envfile, environment or self.environment)

    def invoke(self, identifiers=None, override=''):
        output, errors = io.BytesIO(), io.StringIO()
        environment = {**self.environment, 'DOCKER_API_VERSION': override}
        with mock.patch.dict(os.environ, environment, clear=True), \
                mock.patch.object(self.helper, 'qualified_socket', return_value=str(self.socket)), \
                mock.patch.object(sys, 'stdout', SimpleNamespace(buffer=output)), \
                mock.patch.object(sys, 'stderr', errors), \
                mock.patch.object(os, 'execvpe') as fallback:
            result = self.helper.main([str(self.root), str(self.envfile), *(identifiers or [identity('app')])])
        fallback.assert_not_called()
        return result, output.getvalue(), errors.getvalue()

    def api_path(self, name='app', version='1.56'):
        return '/v' + version + '/containers/' + identity(name) + '/json?size=false'

    def child_command(self, identifiers):
        # Test-only wiring: there is deliberately no production environment
        # switch that can override qualified_socket or select an arbitrary API.
        code = ('import importlib.util,sys,os,pathlib;'
                's=importlib.util.spec_from_file_location("owned_inspect",sys.argv[1]);'
                'm=importlib.util.module_from_spec(s);s.loader.exec_module(m);'
                'm.qualified_socket=lambda *a:sys.argv[2];'
                'pathlib.Path(sys.argv[3]).write_text(str(os.getpid()));'
                'raise SystemExit(m.main(sys.argv[4:]))')
        return [sys.executable, '-c', code, str(ROOT / 'deploy/docker-inspect.py'), str(self.socket),
                str(self.directory / 'reader.pid'), str(self.root), str(self.envfile), *identifiers]

    def runner(self):
        module, owner = self.lifecycle_module, self

        class ReaderRunner(module.CommandRunner):
            calls = []

            def run(self, command, deadline, maximum=60):
                self.calls.append((list(command), maximum))
                if len(command) > 1 and str(command[1]).endswith('/deploy/docker-inspect.py'):
                    command = owner.child_command(command[4:])
                return super().run(command, deadline, maximum)

        return ReaderRunner()

    def test_default_configuration_and_current_user_home_qualify_without_requests(self):
        for config in (None, '{}', '{"currentContext":"default","auths":{"fixture.invalid":{"auth":"private"}}}'):
            with self.subTest(config=config is None):
                if config is not None:
                    self.config(config)
                self.assertEqual(self.qualify(), str(self.socket))
        with mock.patch.object(self.helper.pwd, 'getpwuid', return_value=SimpleNamespace(pw_dir=str(self.home))):
            without_home = dict(self.environment)
            without_home.pop('HOME')
            self.assertEqual(self.qualify(without_home), str(self.socket))
            self.assertEqual(self.qualify({**without_home, 'HOME': ''}), str(self.socket))
            with self.envfile.open('a') as stream:
                stream.write('HOME=' + str(self.home) + '\n')
            self.assertEqual(self.qualify(without_home), str(self.socket))
        self.assertEqual(self.requests, [])

    def test_protected_selectors_or_resolved_home_mismatch_preserve_cli(self):
        original = self.envfile.read_text()
        changes = {'HOME': str(self.directory / 'other-home'), 'DOCKER_HOST': 'unix:///other.sock',
                   'DOCKER_CONTEXT': 'other', 'DOCKER_API_VERSION': '1.45', 'DOCKER_CONFIG': '/other'}
        for key, value in changes.items():
            with self.subTest(key=key):
                self.envfile.write_text(original + key + '=' + value + '\n')
                self.assertIsNone(self.qualify())
        self.assertEqual(self.requests, [])

    def test_custom_transport_context_headers_and_invalid_api_override_preserve_cli(self):
        changes = {'DOCKER_HOST': 'tcp://127.0.0.1:2375', 'DOCKER_CONTEXT': 'default',
                   'DOCKER_CONFIG': str(self.home / '.docker'), 'DOCKER_TLS': '1',
                   'DOCKER_TLS_VERIFY': '1', 'DOCKER_CERT_PATH': '/fixture/certs',
                   'DOCKER_CUSTOM_HEADERS': 'X-Fixture=private', 'DOCKER_API_VERSION': '1.99'}
        for key, value in changes.items():
            with self.subTest(key=key):
                self.assertIsNone(self.qualify({**self.environment, key: value}))
        self.assertIsNone(self.qualify({**self.environment, 'DOCKER_HOST': 'unix:///run/user/1000/docker.sock'}))
        self.assertIsNone(self.qualify({**self.environment, 'DOCKER_API_VERSION': 'not-a-version'}))
        self.assertEqual(self.requests, [])

    def test_unreadable_or_ambiguous_configuration_cannot_select_api(self):
        values = ['{', '[]', '{"HttpHeaders":{"X-Private":"secret"}}',
                  '{"httpheaders":{"X-Private":"secret"}}', '{"CURRENTCONTEXT":"remote"}',
                  '{"currentContext":"default","CurrentContext":"remote"}',
                  '{"currentContext":"default","currentContext":"remote"}',
                  '{"unused":NaN}', ' ' * (self.helper.CONFIG_LIMIT + 1)]
        for value in values:
            with self.subTest(case=values.index(value)):
                self.config(value)
                self.assertIsNone(self.qualify())
        config = self.config('{}')
        config.unlink()
        config.symlink_to(self.directory / 'absent')
        self.assertIsNone(self.qualify())
        config.unlink()
        os.mkfifo(config)
        self.assertIsNone(self.qualify())
        config.unlink()
        self.config('{}')
        with mock.patch.object(self.helper.os, 'open', side_effect=PermissionError('private-path')):
            self.assertIsNone(self.qualify())
        self.assertEqual(self.requests, [])

    def test_both_paths_must_select_same_root_owned_standard_docker_binary(self):
        safe = SimpleNamespace(st_mode=stat.S_IFREG | 0o755, st_uid=0)
        with mock.patch.object(self.helper.sys, 'platform', 'linux'), \
                mock.patch.object(Path, 'lstat', return_value=safe), \
                mock.patch.object(Path, 'open', mock.mock_open(read_data=b'\x7fELFrest')), \
                mock.patch.object(self.helper.shutil, 'which', side_effect=['/usr/bin/docker', '/usr/bin/docker']) as which:
            self.assertTrue(self.helper.standard_docker({'PATH': '/ambient'}, {'PATH': '/protected'}))
            self.assertEqual([call.kwargs['path'] for call in which.call_args_list], ['/ambient', '/protected'])
        for paths in (['/usr/bin/docker', '/wrapper/docker'], ['/wrapper/docker'], [None]):
            with self.subTest(paths=paths), mock.patch.object(self.helper.shutil, 'which', side_effect=paths):
                self.assertFalse(self.helper.standard_docker({}, {}))
        for mode, uid, header in ((stat.S_IFREG | 0o777, 0, b'\x7fELF'),
                                  (stat.S_IFREG | 0o755, 1000, b'\x7fELF'),
                                  (stat.S_IFLNK | 0o777, 0, b'\x7fELF'),
                                  (stat.S_IFREG | 0o755, 0, b'#!/b')):
            with self.subTest(mode=mode, uid=uid), \
                    mock.patch.object(self.helper.shutil, 'which', return_value='/usr/bin/docker'), \
                    mock.patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=mode, st_uid=uid)), \
                    mock.patch.object(Path, 'open', mock.mock_open(read_data=header)):
                self.assertFalse(self.helper.standard_docker({}, {}))

    def test_fallback_execs_exact_original_cli_and_environment_before_any_request(self):
        class ExecBoundary(Exception):
            pass
        environment = {**self.environment, 'DOCKER_HOST': 'ssh://fixture.invalid', 'PRIVATE_FIXTURE': 'not-printed'}
        with mock.patch.dict(os.environ, environment, clear=True), \
                mock.patch.object(self.helper, 'qualified_socket', return_value=None), \
                mock.patch.object(self.helper, 'inspect_local') as api, \
                mock.patch.object(os, 'execvpe', side_effect=ExecBoundary) as execute:
            with self.assertRaises(ExecBoundary):
                self.helper.main([str(self.root), str(self.envfile), identity('app')])
        execute.assert_called_once_with('docker', ['docker', 'inspect', '--type', 'container', '--format',
                                                   self.lifecycle_module.INSPECT_FORMAT, identity('app')], environment)
        api.assert_not_called()
        self.assertEqual(self.requests, [])
        self.assertEqual(self.helper.INSPECT_FORMAT, self.lifecycle_module.INSPECT_FORMAT)

    def test_negotiated_batch_only_projects_original_seven_safe_fields(self):
        large = observation('app')
        large['Config']['Env'].append('BULK=' + 'x' * 180000)
        self.responses[self.api_path()] = {'body': json.dumps(large).encode()}
        identifiers = [identity(name) for name in ('app', 'worker', 'proxy', 'clamav')]
        code, output, errors = self.invoke(identifiers)
        self.assertEqual((code, errors), (0, ''))
        rows = [json.loads(line) for line in output.splitlines()]
        self.assertEqual([row['id'] for row in rows], identifiers)
        self.assertTrue(all(set(row) == {'id', 'project', 'service', 'running', 'paused', 'status', 'health'} for row in rows))
        self.assertIsNone(rows[2]['health'])
        self.assertLess(len(output), self.lifecycle_module.OUTPUT_LIMIT)
        self.assertNotIn(b'PRIVATE', output)
        self.assertNotIn(b'private-health', output)
        self.assertEqual(self.requests, ['/version', *(self.api_path(name) for name in ('app', 'worker', 'proxy', 'clamav'))])

    def test_explicit_version_skips_negotiation_and_supported_range_is_numeric(self):
        code, _, errors = self.invoke(override='1.45')
        self.assertEqual((code, errors), (0, ''))
        self.assertEqual(self.requests, [self.api_path(version='1.45')])
        self.requests.clear()
        self.responses['/version'] = {'body': b'{"ApiVersion":"1.100","MinAPIVersion":"1.44"}'}
        self.assertEqual(self.invoke()[0], 0)
        self.assertEqual(self.requests[-1], self.api_path(version='1.56'))
        for versions in ({'ApiVersion': '1.39', 'MinAPIVersion': '1.24'},
                         {'ApiVersion': '1.57', 'MinAPIVersion': '1.57'},
                         {'ApiVersion': 'private-invalid', 'MinAPIVersion': '1.40'}):
            self.requests.clear()
            self.responses['/version'] = {'body': json.dumps(versions).encode()}
            self.assertEqual(self.invoke(), (1, b'', 'DOCKER_INSPECT_READ_FAILED\n'))
            self.assertEqual(self.requests, ['/version'])

    def test_http_errors_invalid_json_and_truncated_or_oversized_body_fail_without_retry(self):
        cases = [{'status': 404, 'body': b'private daemon error'},
                 {'status': 302, 'body': b'', 'headers': [('Location', 'http://private.invalid')]},
                 {'body': b'{"private":'}, {'body': b'{"Id":1,"Id":2}'},
                 {'body': b'{}', 'headers': [('Content-Type', 'application/json'), ('Content-Length', '99')], 'close': True},
                 {'body': b'', 'headers': [('Content-Type', 'application/json'),
                                           ('Content-Length', str(self.helper.RAW_INSPECT_LIMIT + 1))]},
                 {'body': b'{}', 'headers': [('Content-Type', 'application/json'), ('Content-Length', '2'), ('Content-Length', '2')]},
                 {'body': b'{}', 'headers': [('Content-Type', 'text/plain'), ('Content-Length', '2')]},
                 {'body': b'{}', 'headers': [('Content-Type', 'application/json'), ('Content-Length', '2'), ('Content-Encoding', 'gzip')]}]
        for index, reply in enumerate(cases):
            with self.subTest(case=index):
                self.requests.clear()
                self.responses[self.api_path()] = reply
                self.assertEqual(self.invoke(), (1, b'', 'DOCKER_INSPECT_READ_FAILED\n'))
                self.assertEqual(self.requests, ['/version', self.api_path()])

    def test_api_batch_failure_emits_no_partial_observation_or_config_values(self):
        self.responses[self.api_path('worker')] = {'status': 500, 'body': b'FIXTURE_PRIVATE=secret'}
        self.assertEqual(self.invoke([identity('app'), identity('worker')]),
                         (1, b'', 'DOCKER_INSPECT_READ_FAILED\n'))
        invalid = observation('app')
        invalid['Config']['Labels']['com.docker.compose.service'] = 'SECRET_NOT_A_SERVICE'
        self.responses[self.api_path()] = {'body': json.dumps(invalid).encode()}
        self.assertEqual(self.invoke(), (1, b'', 'DOCKER_INSPECT_READ_FAILED\n'))

    def test_invalid_identity_inputs_cannot_reach_qualification_or_transport(self):
        for identifiers in ([], ['short'], [identity('app')] * 2, [identity(str(x)) for x in range(5)], ['../private']):
            with self.subTest(count=len(identifiers)), \
                    mock.patch.object(self.helper, 'qualified_socket') as qualify, \
                    mock.patch.object(sys, 'stderr', io.StringIO()):
                self.assertEqual(self.helper.main([str(self.root), str(self.envfile), *identifiers]), 1)
                qualify.assert_not_called()
        self.assertEqual(self.requests, [])

    def test_lifecycle_keeps_strict_identity_cardinality_and_health_checks(self):
        row = self.helper.projection(observation('app'))
        rows = [[{**row, 'id': identity('other')}], [{**row, 'project': 'foreign'}],
                [{**row, 'service': 'worker'}], [row, row], [], [{**row, 'running': 1}]]
        for output in rows:
            with self.subTest(output=output), mock.patch.object(self.lifecycle_module.CommandRunner, 'run',
                    return_value=('\n'.join(json.dumps(value) for value in output) + '\n').encode()):
                lifecycle = self.lifecycle_module.Lifecycle(self.root, self.envfile)
                with self.assertRaises(self.lifecycle_module.LifecycleError):
                    lifecycle.inspect([identity('app')], self.lifecycle_module.Deadline(2), ('app',))
        lifecycle = self.lifecycle_module.Lifecycle(self.root, self.envfile)
        with mock.patch.object(lifecycle, 'inspect', return_value={'app': {**row, 'health': None}}):
            with self.assertRaises(self.lifecycle_module.LifecycleError) as failure:
                lifecycle.wait_ready({'app': identity('app')}, self.lifecycle_module.Deadline(0.05))
        self.assertEqual(failure.exception.code, 'SERVICE_HEALTHCHECK_MISSING')

    def test_qualified_reader_avoids_cli_startup_stall_inside_unchanged_parent_budget(self):
        docker = self.bin / 'docker'
        docker.write_text('#!' + sys.executable + '\nimport time\ntime.sleep(5)\n')
        docker.chmod(0o700)
        runner = self.runner()
        lifecycle = self.lifecycle_module.Lifecycle(self.root, self.envfile, runner)
        with mock.patch.dict(os.environ, self.environment, clear=True):
            started = time.monotonic()
            rows = lifecycle.inspect([identity('app'), identity('worker'), identity('proxy')],
                                     self.lifecycle_module.Deadline(2))
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(set(rows), {'app', 'worker', 'proxy'})
        self.assertEqual([maximum for _command, maximum in runner.calls], [15])
        self.assertEqual(len(self.requests), 4)

    def test_slow_api_body_cannot_renew_shared_deadline_and_owned_child_is_reaped(self):
        self.responses[self.api_path()] = {'body': json.dumps(observation('app')).encode(), 'trickle': 0.03}
        runner = self.runner()
        lifecycle = self.lifecycle_module.Lifecycle(self.root, self.envfile, runner)
        with mock.patch.dict(os.environ, self.environment, clear=True):
            started = time.monotonic()
            with self.assertRaises(self.lifecycle_module.LifecycleError) as failure:
                lifecycle.inspect([identity('app')], self.lifecycle_module.Deadline(0.4), ('app',))
        self.assertLess(time.monotonic() - started, 2)
        self.assertEqual(failure.exception.status, 124)
        self.assertTrue(runner.termination_verified)
        details = self.lifecycle_module.failed_command_snapshot(failure.exception)
        self.assertEqual(details['class'], 'container-inspect')
        self.assertEqual(details['services'], ['app'])
        self.assertEqual(details['suppliedMaximumSeconds'], 15)
        self.assertLessEqual(details['effectiveMaximumSeconds'], 0.4)
        pid = int((self.directory / 'reader.pid').read_text())
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)


if __name__ == '__main__':
    unittest.main()
