"""Exercise shipped discovery with an isolated Docker CLI boundary, never a daemon.

The original helpers can be selected for a retained regression demonstration;
the unchanged dotenv reader and a disposable deployment model remain available.
No container, application, database or network operation is performed.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(os.environ.get('IDEALMAKOO_TEST_DISCOVERY_SOURCE_ROOT', ROOT))
PROJECT_LABEL = 'com.docker.compose.project'
SERVICE_LABEL = 'com.docker.compose.service'
CONFIG_LABEL = 'com.docker.compose.config-hash'
LIST_FORMAT = '{"id":{{json .ID}},"service":{{json (.Label "com.docker.compose.service")}}}'


def identity(name):
    return hashlib.sha256(name.encode()).hexdigest()


def container(name, *, service=None, running=True, oneoff=False, project='idealmakoo', config=True):
    return {'id': identity(name), 'project': project, 'service': service or name,
            'running': running, 'paused': False, 'status': 'running' if running else 'exited',
            'health': None if (service or name) == 'proxy' else 'healthy',
            'config': config, 'oneoff': oneoff}


FAKE_DOCKER = r'''
import json,os,pathlib,sys,time
root=pathlib.Path(os.environ['DISCOVERY_FIXTURE_DIRECTORY'])
state=json.loads((root/'state.json').read_text())
args=sys.argv[1:]
fields=['COMPOSE_PROJECT_NAME','COMPOSE_FILE','COMPOSE_FAKE','DOCKER_HOST','DOCKER_CONTEXT',
        'DOCKER_CONFIG','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','APP_IMAGE']
with (root/'calls.jsonl').open('a') as out:
 out.write(json.dumps({'args':args,'pid':os.getpid(),'environment':{k:os.environ.get(k) for k in fields}})+'\n')
if args and args[0]=='compose':
 if state.get('composeStall'): time.sleep(60)
 if args[-1:] == ['ps']:
  print('unchanged diagnostic ps')
  raise SystemExit(0)
 raise SystemExit(71)
if args[:2]==['container','ls']:
 if state.get('listStall'): time.sleep(60)
 if 'listOutput' in state:
  sys.stdout.write(state['listOutput'])
 else:
  filters=[args[i+1] for i,x in enumerate(args) if x=='--filter']
  for row in state['containers']:
   labels={'com.docker.compose.project':row['project'],'com.docker.compose.service':row['service'],
           'com.docker.compose.oneoff':'True' if row['oneoff'] else 'False'}
   if row['config']: labels['com.docker.compose.config-hash']=''
   matched=True
   for value in filters:
    assert value.startswith('label=')
    key,sep,wanted=value[6:].partition('=')
    if key not in labels or sep and labels[key]!=wanted: matched=False
   if matched and ('--all' in args or row['running']):
    print(json.dumps({'id':row['id'],'service':row['service']}))
 raise SystemExit(state.get('listExit',0))
if args[:3]==['inspect','--type','container']:
 if state.get('inspectStall'): time.sleep(60)
 for identifier in args[5:]:
  if identifier in state.get('inspectOmit',[]): continue
  row=next((x for x in state['containers'] if x['id']==identifier),None)
  if row is None: raise SystemExit(72)
  observed={k:row[k] for k in ['id','project','service','running','paused','status','health']}
  observed.update(state.get('inspectOverrides',{}).get(identifier,{}))
  print(json.dumps(observed))
 raise SystemExit(0)
raise SystemExit(73)
'''


class ExistingDiscoveryContracts(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-discovery-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.root = self.directory / 'release'
        self.deploy = self.root / 'deploy'
        self.deploy.mkdir(parents=True)
        for name in ('compose.py', 'service-lifecycle.py', 'docker-inspect.py'):
            shutil.copyfile(SOURCE / 'deploy' / name, self.deploy / name)
        shutil.copyfile(ROOT / 'deploy/env-file.py', self.deploy / 'env-file.py')
        (self.root / 'docker-compose.yml').write_text('services:\n  app:\n    image: ${APP_IMAGE}\n')
        self.envfile = self.directory / 'private.env'
        self.envfile.write_text('COMPOSE_PROJECT_NAME=idealmakoo\nSITE_URL=http://127.0.0.1:3088\n')
        self.envfile.chmod(0o600)
        self.binary = self.directory / 'bin'
        self.binary.mkdir()
        docker = self.binary / 'docker'
        docker.write_text('#!' + sys.executable + '\n' + FAKE_DOCKER)
        docker.chmod(0o700)
        self.environment = {**os.environ, 'PATH': str(self.binary) + os.pathsep + os.environ['PATH'],
                            'DISCOVERY_FIXTURE_DIRECTORY': str(self.directory)}
        self.state = {'containers': [container('app'), container('worker'), container('proxy')]}
        self.sequence = 0

    def write_state(self):
        (self.directory / 'state.json').write_text(json.dumps(self.state))
        (self.directory / 'calls.jsonl').unlink(missing_ok=True)

    def calls(self):
        path = self.directory / 'calls.jsonl'
        return [json.loads(x) for x in path.read_text().splitlines()] if path.exists() else []

    def wrapper(self, *arguments):
        self.write_state()
        return subprocess.run([sys.executable, str(self.deploy / 'compose.py'), str(self.root),
                               str(self.envfile), *arguments], env=self.environment,
                              stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=5)

    def snapshot(self, *, seconds=30, root=None):
        self.write_state()
        self.sequence += 1
        path = self.directory / ('snapshot-' + str(self.sequence) + '.json')
        started = time.monotonic()
        result = subprocess.run([sys.executable, str(self.deploy / 'service-lifecycle.py'),
                                 '--root', str(root or self.root), '--env-file', str(self.envfile),
                                 'snapshot', '--output', str(path), '--timeout', str(seconds)],
                                env=self.environment, stdin=subprocess.DEVNULL,
                                capture_output=True, text=True, timeout=seconds + 5)
        return result, path, time.monotonic() - started

    def assert_no_mutation(self):
        self.assertTrue(all(c['args'][:2] == ['container', 'ls'] or
                            c['args'][:3] == ['inspect', '--type', 'container'] for c in self.calls()))

    def test_snapshot_avoids_stalled_compose_ps_with_original_thirty_second_budget(self):
        # This same test demonstrably fails on the old helpers at their real
        # 30-second deadline. The alternative boundary still inspects real IDs.
        self.state['composeStall'] = True
        result, path, elapsed = self.snapshot(seconds=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertLess(elapsed, 30)
        calls = self.calls()
        self.assertEqual(len(calls), 2, calls)
        self.assertEqual(calls[0]['args'][:2], ['container', 'ls'])
        self.assertEqual(calls[1]['args'][:3], ['inspect', '--type', 'container'])
        self.assertEqual(set(calls[1]['args'][5:]), {identity(x) for x in ('app', 'worker', 'proxy')})
        self.assertEqual([x['service'] for x in json.loads(path.read_text())['services']], ['app', 'worker', 'proxy'])

    def test_list_has_exact_project_hash_presence_all_states_and_no_oneoff_filter(self):
        self.state['containers'] = [container('regular', service='app'),
                                    container('stopped', service='app', running=False),
                                    container('oneoff', service='app', oneoff=True),
                                    container('other-project', service='app', project='foreign'),
                                    container('no-config', service='app', config=False), container('worker')]
        result = self.wrapper('list-existing', 'app')
        self.assertEqual(result.returncode, 0, result.stderr)
        args = self.calls()[0]['args']
        filters = [args[i + 1] for i, value in enumerate(args) if value == '--filter']
        self.assertEqual(filters, ['label=' + PROJECT_LABEL + '=idealmakoo', 'label=' + CONFIG_LABEL,
                                   'label=' + SERVICE_LABEL + '=app'])
        self.assertIn('--all', args)
        self.assertIn('--no-trunc', args)
        self.assertEqual(args[args.index('--format') + 1], LIST_FORMAT)
        self.assertEqual({x['id'] for x in map(json.loads, result.stdout.splitlines())},
                         {identity(x) for x in ('regular', 'stopped', 'oneoff')})

    def test_multi_service_membership_is_exact_without_repeated_service_filters(self):
        self.state['containers'] += [container('db'), container('orphan'), container('app-extra'),
                                     container('foreign', service='app', project='foreign')]
        self.state['containers'][1]['running'] = False
        self.state['containers'][1]['status'] = 'exited'
        result, path, _ = self.snapshot()
        self.assertEqual(result.returncode, 0, result.stderr)
        calls = self.calls()
        self.assertFalse(any('label=' + SERVICE_LABEL + '=' in x for x in calls[0]['args']))
        self.assertEqual(set(calls[1]['args'][5:]), {identity(x) for x in ('app', 'worker', 'proxy')})
        self.assertEqual([x['service'] for x in json.loads(path.read_text())['services']], ['app', 'proxy'])
        self.assert_no_mutation()

    def test_protected_docker_environment_and_release_values_reach_direct_list(self):
        protected = {'DOCKER_HOST': 'unix:///fixture/protected.sock', 'DOCKER_CONTEXT': 'fixture-protected',
                     'DOCKER_CONFIG': '/fixture/protected-config', 'DOCKER_TLS_VERIFY': '1',
                     'DOCKER_CERT_PATH': '/fixture/protected-cert', 'APP_IMAGE': 'fixture/env-image'}
        with self.envfile.open('a') as stream:
            for key, value in protected.items():
                stream.write(key + '=' + value + '\n')
        (self.root / '.release.env').write_text('APP_IMAGE=fixture/release-image\n')
        for key in protected:
            self.environment[key] = 'ambient-must-not-win'
        self.environment.update(COMPOSE_PROJECT_NAME='ambient-project', COMPOSE_FILE='/ambient/model.yml',
                                COMPOSE_FAKE='ambient-profile-control')
        result = self.wrapper('list-existing', 'app', 'worker')
        self.assertEqual(result.returncode, 0, result.stderr)
        observed = self.calls()[0]['environment']
        for key, value in protected.items():
            self.assertEqual(observed[key], 'fixture/release-image' if key == 'APP_IMAGE' else value)
        self.assertEqual(observed['COMPOSE_PROJECT_NAME'], 'idealmakoo')
        self.assertIsNone(observed['COMPOSE_FILE'])
        self.assertIsNone(observed['COMPOSE_FAKE'])

    def test_internal_selection_rejects_unknown_duplicate_empty_and_option_arguments(self):
        for arguments in [('list-existing',), ('list-existing', 'app', 'app'),
                          ('list-existing', 'db'), ('list-existing', '--all', 'app'),
                          ('list-existing', 'app', 'worker', 'proxy', 'clamav', 'extra')]:
            with self.subTest(arguments=arguments):
                result = self.wrapper(*arguments)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(self.calls(), [])

    def test_ordinary_diagnostic_ps_still_uses_compose(self):
        result = self.wrapper('ps')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, 'unchanged diagnostic ps\n')
        self.assertEqual(self.calls()[0]['args'][0], 'compose')

    def test_reviewed_discovery_uses_historical_config_without_requiring_new_legacy_interface(self):
        old = self.directory / 'historical-release'
        (old / 'deploy').mkdir(parents=True)
        (old / 'docker-compose.yml').write_text('services:\n  app:\n    image: ${APP_IMAGE}\n')
        (old / '.release.env').write_text('APP_IMAGE=fixture/historical-image\n')
        (self.root / '.release.env').write_text('APP_IMAGE=fixture/current-image\n')
        marker = self.directory / 'legacy-wrapper-call.json'
        (old / 'deploy/compose.py').write_text('''import json,pathlib,sys
args=sys.argv[3:]
pathlib.Path(''' + repr(str(marker)) + ''').write_text(json.dumps(sys.argv[1:]))
if args==['ps']: print('historical diagnostic ps')
else: raise SystemExit(74)
''')
        self.envfile = self.directory / 'historical-private.env'
        self.envfile.write_text('COMPOSE_PROJECT_NAME=historical\nSITE_URL=http://127.0.0.1:3088\n'
                                'DOCKER_CONTEXT=fixture-historical-context\n')
        self.envfile.chmod(0o600)
        for row in self.state['containers']:
            row['project'] = 'historical'
        result, path, _ = self.snapshot(root=old)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(marker.exists(), 'Discovery tried to use the old wrapper internal interface.')
        observed = self.calls()[0]['environment']
        self.assertEqual(observed['APP_IMAGE'], 'fixture/historical-image')
        self.assertEqual(observed['DOCKER_CONTEXT'], 'fixture-historical-context')
        saved = json.loads(path.read_text())
        self.assertEqual(saved['project'], 'historical')
        self.assertEqual(saved['environmentPath'], str(self.envfile))
        diagnostic = subprocess.run([sys.executable, str(self.deploy / 'service-lifecycle.py'),
                                     '--root', str(old), '--env-file', str(self.envfile),
                                     'ps', '--timeout', '5'], env=self.environment,
                                    stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=7)
        self.assertEqual(diagnostic.returncode, 0, diagnostic.stderr)
        self.assertEqual(diagnostic.stdout, 'historical diagnostic ps\n')
        self.assertEqual(json.loads(marker.read_text()), [str(old), str(self.envfile), 'ps'])

    def test_genuine_empty_inventory_publishes_empty_snapshot_without_inspection(self):
        self.state['containers'] = []
        result, path, _ = self.snapshot()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(path.read_text())['services'], [])
        self.assertEqual(len(self.calls()), 1)

    def test_oneoff_selection_and_duplicate_service_observations_are_not_silently_hidden(self):
        self.state['containers'] = [container('owned-oneoff', service='app', oneoff=True)]
        result, path, _ = self.snapshot()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(path.read_text())['services'],
                         [{'service': 'app', 'containerId': identity('owned-oneoff')}])
        self.state['containers'].append(container('regular-app', service='app', running=False))
        result, path, _ = self.snapshot()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(path.exists())
        self.assert_no_mutation()

    def test_invalid_duplicate_or_failed_list_never_creates_snapshot(self):
        valid = {'id': identity('app'), 'service': 'app'}
        cases = [('malformed', '{', 0), ('array', '[]\n', 0), ('missing', '{"service":"app"}\n', 0),
                 ('extra', json.dumps({**valid, 'secret': 'not-allowed'}) + '\n', 0),
                 ('short-id', json.dumps({**valid, 'id': 'a' * 12}) + '\n', 0),
                 ('wrong-service-type', json.dumps({**valid, 'service': ['app']}) + '\n', 0),
                 ('duplicate-id', (json.dumps(valid) + '\n') * 2, 0),
                 ('nonzero-with-valid-output', json.dumps(valid) + '\n', 23)]
        for label, output, status in cases:
            with self.subTest(case=label):
                self.state.update(listOutput=output, listExit=status)
                result, path, _ = self.snapshot()
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(path.exists())
                self.assertEqual(len(self.calls()), 1)
                self.assert_no_mutation()

    def test_foreign_incomplete_and_service_rebound_inspection_never_creates_snapshot(self):
        for label, extra in [('foreign', {'inspectOverrides': {identity('app'): {'project': 'foreign'}}}),
                             ('missing-id', {'inspectOmit': [identity('worker')]}),
                             ('rebound', {'inspectOverrides': {identity('app'): {'service': 'worker'},
                                                               identity('worker'): {'service': 'app'}}})]:
            with self.subTest(case=label):
                self.state = {'containers': [container('app'), container('worker'), container('proxy')], **extra}
                result, path, _ = self.snapshot()
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(path.exists())
                self.assertEqual(len(self.calls()), 2)
                self.assert_no_mutation()

    def test_owned_list_timeout_is_reaped_without_snapshot_or_mutation(self):
        self.state['listStall'] = True
        result, path, elapsed = self.snapshot(seconds=1)
        self.assertEqual(result.returncode, 124, result.stderr)
        self.assertLess(elapsed, 4)
        self.assertFalse(path.exists())
        outcome = json.loads(result.stderr)
        self.assertTrue(outcome['clientProcessTerminationVerified'])
        self.assertFalse(outcome['cleanupAttempted'])
        self.assertEqual(len(self.calls()), 1)
        with self.assertRaises(ProcessLookupError):
            os.kill(self.calls()[0]['pid'], 0)
        self.assert_no_mutation()


if __name__ == '__main__':
    unittest.main()
