"""One-off operations must never build/pull or consume their caller's input."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('existing_image_compose', ROOT / 'deploy/compose.py')
COMPOSE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPOSE)
IMAGE_ID = 'sha256:' + 'a' * 64
MODEL = {
    'name': 'protected-project',
    'services': {
        'migrate': {'image': 'deployed/app:previous', 'build': {'context': '/must-not-build'},
                    'environment': {'PASSWORD': 'literal-$$NAME-${unchanged}', 'STAFF': '["literal-$$()"]'},
                    'depends_on': {'db': {'condition': 'service_healthy'}}},
        'storage-tool': {'image': 'deployed/app:previous', 'build': {'context': '/must-not-build'},
                         'profiles': ['operations'], 'network_mode': 'none'},
        'db': {'image': 'fixture/db:cached', 'pull_policy': 'always'},
    },
    'volumes': {'storage': {'name': 'protected-project_storage'}},
}


class ExistingImageRunTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-existing-image-test-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.envfile = self.root / '.env'
        self.envfile.write_text('COMPOSE_PROJECT_NAME=protected-project\n')
        self.envfile.chmod(0o600)
        self.command = ['docker', 'compose', '--env-file', '/dev/null', '--project-directory', str(self.root),
                        '-f', str(self.root / 'docker-compose.yml')]
        self.env = {'CONTROLLED': 'protected-value'}
        self.calls = []
        self.private_path = None
        self.actual_model = None

    def selection(self, *arguments):
        return COMPOSE.existing_run_arguments(list(arguments or ('run-existing', 'migrate', 'node', 'script.js')))

    def driver(self, argv, **options):
        self.calls.append((argv, options))
        if argv[-3:] == ['config', '--format', 'json']:
            self.assertEqual(options['stdin'], subprocess.DEVNULL)
            self.assertEqual(options['env'], self.env)
            return subprocess.CompletedProcess(argv, 0, json.dumps(MODEL).encode(), b'')
        if argv[:3] == ['docker', 'image', 'inspect']:
            self.assertEqual(options['stdin'], subprocess.DEVNULL)
            self.assertEqual(argv[-1], 'deployed/app:previous')
            return subprocess.CompletedProcess(argv, 0, (IMAGE_ID + '\n').encode(), b'')
        self.assertIn('run', argv)
        self.assertNotIn('stdin', options)
        self.assertNotIn('input', options)
        self.assertNotIn('capture_output', options)
        self.private_path = Path(argv[argv.index('-f') + 1])
        self.assertEqual(stat.S_IMODE(self.private_path.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(self.private_path.parent.stat().st_mode), 0o700)
        self.actual_model = json.loads(self.private_path.read_text())
        return subprocess.CompletedProcess(argv, 2)

    def invoke(self, selection=None):
        return COMPOSE.run_existing(str(self.root), str(self.envfile), self.command, self.env,
                                    selection or self.selection())

    def test_existing_image_is_pinned_without_builds_or_pulls_and_exit_two_is_preserved(self):
        original = copy.deepcopy(MODEL)
        with mock.patch.object(COMPOSE.subprocess, 'run', side_effect=self.driver):
            code = self.invoke()
        self.assertEqual(code, 2)
        self.assertEqual(self.actual_model['services']['migrate']['image'], IMAGE_ID)
        for service in self.actual_model['services'].values():
            self.assertNotIn('build', service)
            self.assertEqual(service['pull_policy'], 'never')
        self.assertEqual(self.actual_model['services']['migrate']['environment'], original['services']['migrate']['environment'])
        self.assertEqual(self.actual_model['services']['migrate']['depends_on'], original['services']['migrate']['depends_on'])
        self.assertEqual(self.actual_model['volumes'], original['volumes'])
        self.assertEqual(MODEL, original)
        actual = self.calls[-1][0]
        start = actual.index('run')
        self.assertEqual(actual[start:start + 6], ['run', '--rm', '--no-deps', '--pull', 'never', '-T'])
        self.assertEqual(actual[actual.index('--project-name') + 1], MODEL['name'])
        self.assertFalse(self.private_path.exists())
        self.assertFalse(self.private_path.parent.exists())

    def test_profiles_restore_overrides_and_command_arguments_remain_intact(self):
        selection = self.selection('--profile', 'operations', 'run-existing', '--rm', '--no-deps',
                                   '--pull', 'never', '-T', '-e', 'PRIVACY_RESTORE_DATABASE=drill_fixture',
                                   '--volume', '/private/control:/recovery:ro', '--entrypoint', '/bin/sh',
                                   'migrate', '-c', 'cat', 'command-name', '--no-build', '--pull=always')
        with mock.patch.object(COMPOSE.subprocess, 'run', side_effect=self.driver):
            self.invoke(selection)
        config = self.calls[0][0]
        self.assertEqual(config[-5:], ['--profile', 'operations', 'config', '--format', 'json'])
        actual = self.calls[-1][0]
        self.assertEqual(actual[actual.index('--profile'):actual.index('--profile') + 2], ['--profile', 'operations'])
        self.assertEqual(actual[-12:], ['-e', 'PRIVACY_RESTORE_DATABASE=drill_fixture', '--volume',
                                       '/private/control:/recovery:ro', '--entrypoint', '/bin/sh', 'migrate',
                                       '-c', 'cat', 'command-name', '--no-build', '--pull=always'])

    def test_unsafe_compose_options_are_refused_before_the_service(self):
        unsafe = [('--no-build',), ('--build',), ('--pull', 'always'), ('--pull=missing',),
                  ('--detach',), ('--service-ports',), ('--no-deps=false',), ('--rm=false',),
                  ('--remove-orphans',), ('--privileged',)]
        for options in unsafe:
            with self.subTest(options=options), self.assertRaises(ValueError):
                self.selection('run-existing', *options, 'migrate', 'node', 'script.js')

    def test_missing_service_or_missing_option_value_is_refused(self):
        for arguments in [('run-existing',), ('run-existing', '--volume'), ('run-existing', '-T')]:
            with self.subTest(arguments=arguments), self.assertRaises(ValueError):
                self.selection(*arguments)

    def test_normal_commands_and_container_arguments_do_not_activate_the_one_off_mode(self):
        self.assertIsNone(self.selection('up', '-d', '--no-deps', '--no-build', '--pull', 'never', 'app'))
        self.assertIsNone(self.selection('exec', '-T', 'app', 'printf', 'run-existing'))
        self.assertIsNone(self.selection('--profile', 'operations', 'config', '--format', 'json'))

    def test_missing_image_fails_before_run_and_does_not_expose_daemon_output(self):
        marker = 'synthetic-private-image-inspection-marker'
        def driver(argv, **options):
            if argv[:3] == ['docker', 'image', 'inspect']:
                self.calls.append((argv, options))
                return subprocess.CompletedProcess(argv, 1, marker.encode(), marker.encode())
            return self.driver(argv, **options)
        with mock.patch.object(COMPOSE.subprocess, 'run', side_effect=driver):
            with self.assertRaisesRegex(ValueError, 'unavailable locally') as raised:
                self.invoke()
        self.assertNotIn(marker, str(raised.exception))
        self.assertEqual(len(self.calls), 2)
        self.assertIsNone(self.private_path)
        self.assertFalse(list(self.root.glob('.compose-run-*')))

    def test_invalid_image_identity_cannot_be_used_as_a_runtime_tag(self):
        for identity in (b'fixture/app:mutable\n', (IMAGE_ID + '\n' + IMAGE_ID).encode(), b'\xff'):
            def driver(argv, **options):
                if argv[:3] == ['docker', 'image', 'inspect']:
                    return subprocess.CompletedProcess(argv, 0, identity, b'')
                return self.driver(argv, **options)
            with self.subTest(identity=identity), mock.patch.object(COMPOSE.subprocess, 'run', side_effect=driver):
                with self.assertRaises(ValueError):
                    self.invoke()
            self.assertIsNone(self.private_path)

    def test_invalid_or_failed_private_config_is_redacted_and_never_runs(self):
        marker = 'synthetic-private-configuration-marker'
        cases = [(1, marker.encode()), (0, b'not-json-' + marker.encode()),
                 (0, b'{}'), (0, json.dumps({'services': {'migrate': {'image': marker + '\ninvalid'}}}).encode())]
        for status, output in cases:
            with self.subTest(status=status, output=output):
                self.calls = []
                def driver(argv, **options):
                    self.calls.append((argv, options))
                    return subprocess.CompletedProcess(argv, status, output, marker.encode())
                with mock.patch.object(COMPOSE.subprocess, 'run', side_effect=driver), self.assertRaises(ValueError) as raised:
                    self.invoke()
                self.assertNotIn(marker, str(raised.exception))
                self.assertEqual(len(self.calls), 1)
                self.assertFalse(list(self.root.glob('.compose-run-*')))

    def test_private_model_is_removed_if_the_actual_driver_cannot_start(self):
        def driver(argv, **options):
            result = self.driver(argv, **options)
            if self.private_path is not None:
                raise OSError('synthetic execution failure')
            return result
        with mock.patch.object(COMPOSE.subprocess, 'run', side_effect=driver), self.assertRaises(OSError):
            self.invoke()
        self.assertFalse(self.private_path.exists())
        self.assertFalse(self.private_path.parent.exists())

    def test_binary_pipe_is_not_consumed_by_config_or_inspect_and_exit_two_survives_the_cli(self):
        binary = self.root / 'bin'
        binary.mkdir()
        fake = binary / 'docker'
        fake.write_text('#!' + sys.executable + '\n' + r'''
import json,os,pathlib,subprocess,sys
args=sys.argv[1:]
if args[-3:]==['config','--format','json']:
    assert sys.stdin.buffer.read()==b''
    assert os.environ['SITE_URL']=='http://127.0.0.1:3088'
    assert os.environ['APP_IMAGE']=='deployed/app:observed'
    model={'name':'protected-project','services':{'migrate':{'image':os.environ['APP_IMAGE'],'build':{'context':'/must-not-build'}}}}
    print(json.dumps(model))
elif args[:2]==['image','inspect']:
    assert sys.stdin.buffer.read()==b''
    assert args[-1]=='deployed/app:observed'
    print('sha256:'+'a'*64)
else:
    assert 'run' in args and '--no-build' not in args
    model=json.loads(pathlib.Path(args[args.index('-f')+1]).read_text())
    assert model['services']['migrate']['image']=='sha256:'+'a'*64
    assert 'build' not in model['services']['migrate']
    sys.stdout.buffer.write(sys.stdin.buffer.read())
    sys.stdout.buffer.flush()
    raise SystemExit(2)
''')
        fake.chmod(0o700)
        (self.root / 'docker-compose.yml').write_text('services:\n  migrate:\n    image: ${APP_IMAGE}\n')
        self.envfile.write_text('COMPOSE_PROJECT_NAME=protected-project\nSITE_URL=http://127.0.0.1:3088\nAPP_IMAGE=deployed/app:protected\n')
        inherited = {**os.environ, 'PATH': str(binary) + os.pathsep + os.environ.get('PATH', ''),
                     'SITE_URL': 'https://ambient-must-not-win.invalid', 'APP_IMAGE': 'ambient-must-not-win',
                     'IDEALMAKOO_OBSERVED_APP_IMAGE': 'deployed/app:observed'}
        payload = bytes(range(256)) * 2048
        result = subprocess.run([sys.executable, str(ROOT / 'deploy/compose.py'), str(self.root), str(self.envfile),
                                 'run-existing', '--rm', '--no-deps', '--pull', 'never', '-T', 'migrate', 'cat'],
                                input=payload, capture_output=True, env=inherited, timeout=30)
        self.assertEqual(result.returncode, 2, result.stderr.decode(errors='replace'))
        self.assertEqual(result.stdout, payload)
        self.assertEqual(result.stderr, b'')
        self.assertFalse(list(self.root.glob('.compose-run-*')))


if __name__ == '__main__':
    unittest.main()
