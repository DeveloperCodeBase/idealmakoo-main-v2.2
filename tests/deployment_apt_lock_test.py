"""Execute the shipped prerequisite commands with a recording package manager.

These tests never install packages or touch locks. They cover the exact native
timeout argument and propagation of the package manager's bounded-wait failure.
"""
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class AptLockTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-apt-lock-test-')
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.record = self.directory / 'arguments.txt'
        fake = self.directory / 'apt-get'
        fake.write_text('''#!/bin/sh
printf '%s\\n' "$*" >> "$APT_TEST_LOG"
for argument in "$@"; do
  if [ "$argument" = install ] && [ "$APT_TEST_FAIL_INSTALL" = true ]; then
    exit 100
  fi
done
exit 0
''')
        fake.chmod(0o700)

    def commands(self):
        commands = []
        for name, count in [('install-ubuntu.sh', 5), ('recover-ubuntu.sh', 1)]:
            lines = [line.strip() for line in (ROOT / 'scripts' / name).read_text().splitlines()
                     if (line.lstrip().startswith('apt-get ') or line.lstrip().startswith('network_step apt-install -- apt-get ')) and ' install ' in line]
            self.assertEqual(len(lines), count, name)
            commands.extend((name, line) for line in lines)
        return commands

    def run_fragment(self, fragment, fail=False):
        if self.record.exists():
            self.record.unlink()
        prologue = 'SOURCE_ROOT=' + shlex.quote(str(ROOT)) + '\nnetwork_step() { python3 "$SOURCE_ROOT/deploy/network-steps.py" --attempts 3 --timeout 900 "$@"; }\n'
        result = subprocess.run(['bash', '-eu', '-c', prologue + fragment + '\nprintf REACHED_END\n'],
                                env={'PATH': str(self.directory) + ':' + os.defpath,
                                     'APT_TEST_LOG': str(self.record),
                                     'APT_TEST_FAIL_INSTALL': str(fail).lower()},
                                capture_output=True, text=True, timeout=5)
        calls = [shlex.split(line) for line in self.record.read_text().splitlines()]
        return result, calls

    def test_all_install_paths_use_native_bounded_wait(self):
        for name, command in self.commands():
            with self.subTest(script=name, command=command):
                result, calls = self.run_fragment(command)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, 'REACHED_END')
                self.assertEqual(len(calls), 1)
                self.assertEqual(calls[0][:2], ['-o', 'DPkg::Lock::Timeout=180'])
                install = calls[0].index('install')
                self.assertEqual(calls[0][install:install+3], ['install', '-y', '--no-install-recommends'])
                self.assertGreater(len(calls[0]), 5)

    def test_expired_wait_stops_every_install_path_without_retry(self):
        for name, command in self.commands():
            with self.subTest(script=name, command=command):
                result, calls = self.run_fragment(command, fail=True)
                self.assertEqual(result.returncode, 100)
                self.assertNotIn('REACHED_END', result.stdout)
                self.assertEqual(len(calls), 1)

    def bootstrap(self, filename, marker):
        source = (ROOT / 'scripts' / filename).read_text()
        self.assertEqual(source.count(marker), 1)
        start = source.index(marker)
        end = source.index('\nfi\n', start) + len('\nfi\n')
        # Only availability is absent. The original conditional, export, update
        # and installation commands are otherwise executed without alteration.
        return 'command() { return 1; }\n' + source[start:end]

    def test_missing_python_installer_bootstrap_keeps_update_fail_closed(self):
        fragment = self.bootstrap('install-ubuntu.sh', 'if ! command -v python3 >/dev/null 2>&1; then\n')
        result, calls = self.run_fragment(fragment, fail=True)
        self.assertEqual(result.returncode, 100)
        self.assertEqual(calls, [['-o', 'Acquire::Retries=2', '-o', 'Acquire::http::Timeout=30', '-o', 'Acquire::https::Timeout=30', '-o', 'APT::Update::Error-Mode=any', 'update'],
                                ['-o', 'DPkg::Lock::Timeout=180', 'install', '-y', '--no-install-recommends', 'python3', 'ca-certificates']])
        self.assertNotIn('REACHED_END', result.stdout)

    def test_missing_age_recovery_bootstrap_keeps_update_fail_closed(self):
        fragment = self.bootstrap('recover-ubuntu.sh', 'if ! command -v age >/dev/null || ! command -v python3 >/dev/null; then\n')
        result, calls = self.run_fragment(fragment, fail=True)
        self.assertEqual(result.returncode, 100)
        self.assertEqual(calls, [['-o', 'APT::Update::Error-Mode=any', 'update'],
                                ['-o', 'DPkg::Lock::Timeout=180', 'install', '-y', '--no-install-recommends', 'age', 'python3', 'ca-certificates']])
        self.assertNotIn('REACHED_END', result.stdout)


if __name__ == '__main__':
    unittest.main()
