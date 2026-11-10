"""Exercise the installer's actual profile selection with minimal env input."""
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]


class InstallerProfileTests(unittest.TestCase):
    def test_absent_antivirus_setting_keeps_default_and_explicit_opt_out_is_preserved(self):
        source = (ROOT / 'scripts/install-ubuntu.sh').read_text()
        reader = re.search(r'^  input_value\(\) \{.*\}$', source, re.MULTILINE).group(0)
        selection = re.search(r'^  if .*antivirus_set == 0.*COMPOSE_PROFILES.*; fi$', source, re.MULTILINE).group(0)
        script = '\n'.join([
            'set -euo pipefail', 'SOURCE_ROOT="$1"', 'input_env="$2"',
            'antivirus="$3"', 'antivirus_set="$4"', reader, selection,
            'printf "%s" "$antivirus"',
        ])
        for content, initial, explicit, expected in [
            ('SITE_ADDRESS=example.invalid\n', 1, 0, '1'),
            ('COMPOSE_PROFILES=antivirus\n', 1, 0, '1'),
            ('COMPOSE_PROFILES=antivirus,operations\n', 1, 0, '1'),
            ('COMPOSE_PROFILES=\n', 1, 0, '0'),
            ('COMPOSE_PROFILES=operations\n', 1, 0, '0'),
            ('COMPOSE_PROFILES=antivirus\n', 0, 1, '0'),
        ]:
            with self.subTest(content=content, explicit=explicit), tempfile.TemporaryDirectory() as temporary:
                env = Path(temporary) / 'minimal.env'
                env.write_text(content)
                env.chmod(0o600)
                result = subprocess.run(
                    ['bash', '-c', script, 'installer-profile', str(ROOT), str(env), str(initial), str(explicit)],
                    text=True, capture_output=True, timeout=10,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(result.stdout, expected)


if __name__ == '__main__':
    unittest.main()
