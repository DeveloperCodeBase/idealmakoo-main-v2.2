"""Execute the actual image RUN shell with bounded capability-tool fixtures.

No Docker or host capabilities are touched. Every external command in the RUN
is replaced by a temporary fixture, and PATH contains only that fixture folder.
The real image must still be built and executed under its production hardening.
"""
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = Path(os.environ.get('IDEALMAKOO_CADDY_DOCKERFILE_UNDER_TEST', ROOT / 'deploy/caddy/Dockerfile'))


def run_shell(source):
    commands, current = [], ''
    for line in source.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        current += line[:-1] + ' ' if line.endswith('\\') else line
        if line.endswith('\\'):
            continue
        if current.startswith('RUN '):
            commands.append(current[4:])
        current = ''
    if current or len(commands) != 1:
        raise AssertionError('Review the changed Caddy build command structure')
    return commands[0]


GETCAP = '''#!/bin/sh
[ "$#" -eq 1 ] && [ "$1" = /usr/bin/caddy ] || exit 91
probe_count=0
if [ -f "$FIXTURE_DIRECTORY/count" ]; then read -r probe_count < "$FIXTURE_DIRECTORY/count"; fi
probe_count=$((probe_count + 1))
printf '%s\\n' "$probe_count" > "$FIXTURE_DIRECTORY/count"
if [ "$probe_count" -eq 1 ]; then
    case "$FIXTURE_CASE" in
        before-error) exit 7 ;;
        before-error-output) printf '%s\\n' '/usr/bin/caddy cap_net_bind_service=ep'; exit 7 ;;
        empty) exit 0 ;;
    esac
    printf '%s\\n' '/usr/bin/caddy cap_net_bind_service=ep'
else
    case "$FIXTURE_CASE" in
        after-error) exit 8 ;;
        retained) printf '%s\\n' '/usr/bin/caddy cap_net_bind_service=ep' ;;
    esac
fi
'''

SETCAP = '''#!/bin/sh
[ "$#" -eq 2 ] && [ "$1" = -r ] && [ "$2" = /usr/bin/caddy ] || exit 92
printf '%s\\n' remove >> "$FIXTURE_DIRECTORY/removals"
[ "$FIXTURE_CASE" != remove-error ] || exit 9
'''

OPERATION = '''#!/bin/sh
printf '%s\\n' "${0##*/}" >> "$FIXTURE_DIRECTORY/operations"
'''


class CaddyCapabilityTests(unittest.TestCase):
    def probe(self, scenario):
        with tempfile.TemporaryDirectory(prefix='idealmakoo-caddy-cap-fixture-') as temporary:
            directory = Path(temporary)
            binary = directory / 'bin'
            binary.mkdir()
            for name, body in {'getcap': GETCAP, 'setcap': SETCAP,
                               **{name: OPERATION for name in ('addgroup', 'adduser', 'mkdir', 'chown')}}.items():
                path = binary / name
                path.write_text(body)
                path.chmod(0o700)
            result = subprocess.run(['/bin/sh', '-c', run_shell(DOCKERFILE.read_text())],
                                    env={'PATH': str(binary), 'FIXTURE_DIRECTORY': str(directory),
                                         'FIXTURE_CASE': scenario},
                                    capture_output=True, text=True, timeout=5)
            def lines(name):
                path = directory / name
                return path.read_text().splitlines() if path.exists() else []
            return result.returncode, lines('count'), lines('removals'), lines('operations')

    def test_existing_file_capability_is_removed_then_rechecked_before_user_setup(self):
        code, count, removals, operations = self.probe('present')
        self.assertEqual(code, 0)
        self.assertEqual(count, ['2'])
        self.assertEqual(removals, ['remove'])
        self.assertEqual(operations, ['addgroup', 'adduser', 'mkdir', 'chown'])

    def test_already_empty_base_still_verifies_without_failing_removal(self):
        code, count, removals, operations = self.probe('empty')
        self.assertEqual(code, 0)
        self.assertEqual(count, ['2'])
        self.assertEqual(removals, [])
        self.assertEqual(operations, ['addgroup', 'adduser', 'mkdir', 'chown'])

    def test_initial_inspection_failure_with_empty_output_stops_the_build(self):
        code, count, removals, operations = self.probe('before-error')
        self.assertNotEqual(code, 0)
        self.assertEqual(count, ['1'])
        self.assertEqual(removals, [])
        self.assertEqual(operations, [])

    def test_initial_inspection_failure_with_output_cannot_be_treated_as_success(self):
        code, count, removals, operations = self.probe('before-error-output')
        self.assertNotEqual(code, 0)
        self.assertEqual(count, ['1'])
        self.assertEqual(removals, [])
        self.assertEqual(operations, [])

    def test_failed_removal_does_not_proceed_to_final_check_or_user_setup(self):
        code, count, removals, operations = self.probe('remove-error')
        self.assertNotEqual(code, 0)
        self.assertEqual(count, ['1'])
        self.assertEqual(removals, ['remove'])
        self.assertEqual(operations, [])

    def test_final_inspection_error_is_not_an_empty_capability_success(self):
        code, count, removals, operations = self.probe('after-error')
        self.assertNotEqual(code, 0)
        self.assertEqual(count, ['2'])
        self.assertEqual(removals, ['remove'])
        self.assertEqual(operations, [])

    def test_remaining_capability_after_reported_removal_is_rejected(self):
        code, count, removals, operations = self.probe('retained')
        self.assertNotEqual(code, 0)
        self.assertEqual(count, ['2'])
        self.assertEqual(removals, ['remove'])
        self.assertEqual(operations, [])

    def test_original_nonroot_user_and_readonly_caddyfile_are_retained(self):
        source = DOCKERFILE.read_text()
        instructions = [shlex.split(line) for line in source.splitlines()
                        if line.startswith(('USER ', 'COPY ', 'FROM ', 'ARG '))]
        self.assertIn(['USER', '10002:10002'], instructions)
        self.assertIn(['COPY', '--chown=10002:10002', '--chmod=0444', 'Caddyfile', '/etc/caddy/Caddyfile'], instructions)
        self.assertIn(['FROM', '${CADDY_IMAGE}'], instructions)
        self.assertIn(['ARG', 'CADDY_IMAGE=caddy:2-alpine'], instructions)


if __name__ == '__main__':
    unittest.main(verbosity=2)
