"""Static build-input contracts against the real source tree; never runs Docker.

The small COPY resolver models only the standard instructions used by this
Dockerfile and refuses unsupported options. Synthetic output markers distinguish
fresh operational files from cached builder files and generated public assets.
It proves file selection, not successful compilation or image execution.
"""
import fnmatch
import json
import os
from pathlib import Path, PurePosixPath
import re
import shlex
import unittest


ROOT = Path(os.environ.get('IDEALMAKOO_DOCKER_TEST_ROOT', Path(__file__).resolve().parents[1]))
DOCKERFILE = Path(os.environ.get('IDEALMAKOO_DOCKERFILE_UNDER_TEST', ROOT / 'Dockerfile'))


def path_match(path, pattern):
    """Segment-aware glob, including zero-or-more directories for **."""
    parts, patterns = path.split('/'), pattern.strip('/').split('/')

    def match(left, right):
        if not right:
            return not left
        if right[0] == '**':
            return match(left, right[1:]) or bool(left) and match(left[1:], right)
        return bool(left) and fnmatch.fnmatchcase(left[0], right[0]) and match(left[1:], right[1:])
    return match(parts, patterns)


def source_paths(root):
    # Generated dependency/build trees are not authored compiler inputs. No file
    # contents, credentials or environment files are read by this inventory.
    skipped = {'.git', 'node_modules', '.next', '__pycache__'}
    result = []
    for directory, names, files in os.walk(root):
        names[:] = sorted(name for name in names if name not in skipped)
        for name in sorted(files):
            path = Path(directory) / name
            if path.is_symlink():
                continue
            result.append(path.relative_to(root).as_posix())
    return result


def context_paths(paths, ignore_source):
    rules = [line.strip() for line in ignore_source.splitlines()
             if line.strip() and not line.lstrip().startswith('#')]
    selected = []
    for path in paths:
        ignored = False
        for rule in rules:
            inverse = rule.startswith('!')
            rule = rule[1:] if inverse else rule
            # Current patterns are path or basename patterns, with no escaped
            # syntax. Match ancestors too, as ignoring a directory excludes it.
            if '\\' in rule or '[' in rule:
                raise AssertionError('Review unsupported Docker ignore pattern')
            ancestors = [path] + [str(parent) for parent in PurePosixPath(path).parents if str(parent) != '.']
            if any(path_match(value, rule.strip('/')) if '/' in rule.strip('/')
                   else fnmatch.fnmatchcase(PurePosixPath(value).name, rule) for value in ancestors):
                ignored = not inverse
        if not ignored:
            selected.append(path)
    return selected


def instructions(source):
    logical = ''
    for line in source.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        logical += line[:-1] + ' ' if line.endswith('\\') else line
        if line.endswith('\\'):
            continue
        operation, _, value = logical.partition(' ')
        yield operation.upper(), value.strip()
        logical = ''
    if logical:
        raise AssertionError('Unterminated Dockerfile instruction')


def normalize(value):
    if value.startswith('/app/'):
        value = value[5:]
    elif value == '/app':
        return ''
    elif value.startswith('/'):
        raise AssertionError('Only the reviewed /app work directory is supported')
    value = value.removeprefix('./').rstrip('/')
    if value == '.':
        return ''
    if '..' in value.split('/') or '$' in value:
        raise AssertionError('Review computed or traversing COPY path')
    return value


def copy_files(value, context, stages, destination):
    words, selected_stage = shlex.split(value), None
    while words and words[0].startswith('--'):
        option = words.pop(0)
        if option.startswith('--from='):
            selected_stage = option.split('=', 1)[1]
        elif option != '--chown=10001:10001':
            raise AssertionError('Review unsupported COPY option')
    if len(words) < 2:
        raise AssertionError('COPY requires source and destination')
    sources, target = words[:-1], normalize(words[-1])
    available = context if selected_stage is None else stages[selected_stage]
    for source in sources:
        source = normalize(source)
        matches = [name for name in available if path_match(name, source)] if any(c in source for c in '*?[') else [source]
        copied = 0
        for name in sorted(matches):
            if name in available:
                leaf = PurePosixPath(name).name
                output = '/'.join(part for part in (target, leaf) if part)
                # All reviewed file COPY destinations are directories.
                if words[-1] not in ('.', './') and not words[-1].endswith('/'):
                    raise AssertionError('Review a file COPY with a non-directory destination')
                destination[output] = available[name]
                copied += 1
            else:
                prefix = name + '/' if name else ''
                for path in sorted(available):
                    if path.startswith(prefix):
                        output = '/'.join(part for part in (target, path[len(prefix):]) if part)
                        destination[output] = available[path]
                        copied += 1
        if not copied:
            raise AssertionError('COPY matched no source: ' + source)


def resolve(source, context, runtime_context=None):
    """Resolve actual COPY selections; substitute only clearly marked RUN output."""
    stages, stage, compiler_inputs = {}, None, None
    for operation, value in instructions(source):
        if operation == 'FROM':
            words = value.split()
            if len(words) != 3 or words[1].upper() != 'AS':
                raise AssertionError('Review Docker stage declaration')
            stage = words[2]
            stages[stage] = dict(stages.get(words[0], {}))
        elif operation == 'WORKDIR' and value != '/app':
            raise AssertionError('Review changed working directory')
        elif operation == 'COPY':
            current = runtime_context if stage == 'runtime' and runtime_context is not None else context
            copy_files(value, current, stages, stages[stage])
        elif operation == 'RUN' and stage == 'dependencies':
            stages[stage]['node_modules/.fixture'] = b'installed-dependencies'
        elif operation == 'RUN' and stage == 'builder':
            if 'npm run build' not in value or compiler_inputs is not None:
                raise AssertionError('Review changed compiler command')
            compiler_inputs = dict(stages[stage])
            stages[stage].update({
                '.next/standalone/server.js': b'compiled-server',
                '.next/standalone/.next/BUILD_ID': b'compiled-build-id',
                '.next/static/fixture.js': b'compiled-static',
                'public/service-worker-classic.js': b'generated-by-prebuild',
            })
    if compiler_inputs is None:
        raise AssertionError('No compilation boundary found')
    return compiler_inputs, stages['runtime']


def typed_inputs(paths, config):
    result = set()
    for path in paths:
        if not path.endswith(('.ts', '.tsx')) or not any(path_match(path, pattern) for pattern in config['include']):
            continue
        excluded = any(path == pattern or path.startswith(pattern.rstrip('/') + '/') or path_match(path, pattern)
                       for pattern in config.get('exclude', []))
        if not excluded:
            result.add(path)
    return result


class DockerBuildInputsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = DOCKERFILE.read_text()
        cls.paths = source_paths(ROOT)
        cls.config = json.loads((ROOT / 'tsconfig.json').read_text())
        cls.context = {path: ROOT / path for path in context_paths(cls.paths, (ROOT / '.dockerignore').read_text())}
        cls.compiler, cls.runtime = resolve(cls.source, cls.context)

    def test_all_current_authored_typescript_inputs_reach_compiler_at_original_paths(self):
        expected = typed_inputs(self.paths, self.config)
        self.assertTrue(expected)
        self.assertFalse(expected - self.compiler.keys(), 'A tsconfig-included input was omitted from the builder')
        for path in expected:
            with self.subTest(file=path):
                self.assertEqual(self.compiler[path], ROOT / path)

    def test_real_package_prebuild_and_its_source_assets_are_present(self):
        scripts = json.loads((ROOT / 'package.json').read_text())['scripts']
        command = shlex.split(scripts['prebuild'])
        self.assertEqual(command[0], 'node')
        self.assertEqual(len(command), 2)
        self.assertEqual(self.compiler[command[1]], ROOT / command[1])
        prebuild = (ROOT / command[1]).read_text()
        reads = set(re.findall(r"readFile\(resolve\(root,'([^']+)'\)", prebuild))
        self.assertTrue(reads, 'Review changed prebuild input discovery')
        for path in reads:
            self.assertEqual(self.compiler[path], ROOT / path)
        self.assertEqual(scripts['build'], 'next build --webpack')

    def test_guides_shell_operations_and_python_tests_do_not_enter_compilation(self):
        excluded = {path for path in self.context if path.startswith(('docs/', 'deploy/'))
                    or path.endswith('.sh') or path in {'README.md', 'SECURITY.md', 'docker-compose.yml', '.env.example'}
                    or path.startswith('tests/') and path.endswith(('.py', '.mjs'))}
        self.assertTrue(excluded)
        self.assertFalse(excluded & self.compiler.keys())

    def test_operational_edits_leave_compiler_inputs_unchanged_and_reach_runtime(self):
        changed = dict(self.context)
        probes = {'scripts/entrypoint.sh': b'current-entrypoint',
                  'scripts/backup.sh': b'current-backup',
                  'deploy/service-lifecycle.py': b'new-current-lifecycle',
                  'db/migrations/fixture.sql': b'current-migration',
                  'docs/fixture.md': b'current-guide',
                  'tests/deployment_fixture_test.py': b'current-python-test',
                  'RELEASE-MANIFEST.json': b'current-source-manifest'}
        changed.update(probes)
        compiler, runtime = resolve(self.source, changed)
        self.assertEqual(compiler, self.compiler)
        for path, value in probes.items():
            if path.startswith(('scripts/', 'deploy/', 'db/')):
                self.assertEqual(runtime[path], value)
        # Changing the context after the modeled build exposes stale --from=builder
        # operational copies even if a broad builder COPY were reintroduced.
        _, late_runtime = resolve(self.source, self.context, changed)
        for path, value in probes.items():
            if path.startswith(('scripts/', 'deploy/', 'db/')):
                self.assertEqual(late_runtime[path], value)

    def test_runtime_keeps_generated_service_worker_and_compiled_outputs(self):
        self.assertEqual(self.runtime['public/service-worker-classic.js'], b'generated-by-prebuild')
        self.assertEqual(self.runtime['server.js'], b'compiled-server')
        self.assertEqual(self.runtime['.next/BUILD_ID'], b'compiled-build-id')
        self.assertEqual(self.runtime['.next/static/fixture.js'], b'compiled-static')
        for path in self.context:
            if path.startswith(('src/', 'worker/', 'scripts/', 'deploy/', 'db/')):
                self.assertEqual(self.runtime[path], self.context[path])

    def test_real_application_and_dependency_edits_change_compiler_inputs(self):
        for path in ('src/components/Application.tsx', 'package-lock.json', 'scripts/build-service-worker.mjs',
                     'public/sw-policy.js', 'tests/server-api.integration.test.ts'):
            self.assertIn(path, self.context)
            changed = {**self.context, path: b'changed-actual-input'}
            compiler, _ = resolve(self.source, changed)
            self.assertNotEqual(compiler, self.compiler)
            self.assertEqual(compiler[path], b'changed-actual-input')

    def test_missing_typed_script_or_prebuild_asset_is_detected(self):
        required = typed_inputs(self.paths, self.config)
        broken_source = self.source.replace('COPY scripts/*.ts ./scripts/\n', '')
        self.assertNotEqual(broken_source, self.source)
        broken, _ = resolve(broken_source, self.context)
        self.assertEqual(required - broken.keys(), {path for path in required if path.startswith('scripts/')})
        context = dict(self.context)
        del context['public/sw-policy.js']
        compiler, _ = resolve(self.source, context)
        self.assertNotIn('public/sw-policy.js', compiler)

    def test_glob_resolution_handles_root_types_and_does_not_cross_single_star(self):
        self.assertTrue(path_match('next-env.d.ts', '**/*.ts'))
        self.assertTrue(path_match('tests/e2e/helpers/auth-budget.ts', '**/*.ts'))
        self.assertFalse(path_match('scripts/nested/new.ts', 'scripts/*.ts'))
        self.assertEqual(context_paths(['.env', '.env.example', 'deploy/x.py', 'deploy/x.log'],
                                       (ROOT / '.dockerignore').read_text()), ['.env.example', 'deploy/x.py'])


if __name__ == '__main__':
    unittest.main(verbosity=2)
