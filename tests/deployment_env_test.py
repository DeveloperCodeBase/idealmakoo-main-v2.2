"""Protected dotenv parsing, explicit key restoration and non-destructive defaults."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / 'deploy/env-file.py'
SPEC = importlib.util.spec_from_file_location('deployment_env', PATH)
env = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(env)


class EnvTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-env-test-')
        self.work = Path(self.temporary.name)
        self.addCleanup(self.temporary.cleanup)
        self.current, self.old = self.work / 'current.env', self.work / 'backup.env'
        self.current.write_text('# preserve comment\nSESSION_SECRET=test_current_session\nMFA_ENCRYPTION_KEY=test_current_key\nDATABASE_APP_ROLE=idealmakoo_app\n')
        self.old.write_text('SESSION_SECRET=test_previous_session\nMFA_ENCRYPTION_KEY=test_previous_key\nDATABASE_APP_ROLE=postgres\n')
        self.current.chmod(0o600)

    def cli(self, *args):
        return subprocess.run([sys.executable, str(PATH), *map(str, args)], text=True, capture_output=True, timeout=10)

    def test_reads_literal_shell_text_without_executing_it(self):
        marker = self.work / 'must-not-exist'
        self.current.write_text("VALUE='$(touch " + str(marker) + ")'\nOTHER=plain # comment\nQUOTED='hash # retained'\n")
        values = env.read(self.current)
        self.assertIn('$(touch ', values['VALUE'])
        self.assertEqual(values['OTHER'], 'plain')
        self.assertEqual(values['QUOTED'], 'hash # retained')
        self.assertFalse(marker.exists())

    def test_defaults_preserve_existing_secrets_and_do_not_print_values(self):
        defaults = self.work / 'example'
        defaults.write_text('SESSION_SECRET=\nDATABASE_APP_ROLE=idealmakoo_app\nNEW_SETTING=false\nNAJVA_API_KEY=\nNAJVA_WEBSITE_ID=\n')
        self.current.write_text(self.current.read_text() + 'NAJVA_API_KEY=test_private_najva_credential\n')
        result = self.cli('defaults', self.current, defaults, 'NEW_SETTING=true')
        self.assertEqual(result.returncode, 0, result.stderr)
        values = env.read(self.current)
        self.assertEqual(values['SESSION_SECRET'], 'test_current_session')
        self.assertEqual(values['NEW_SETTING'], 'true')
        self.assertEqual(values['NAJVA_API_KEY'], 'test_private_najva_credential')
        self.assertEqual(values['NAJVA_WEBSITE_ID'], '')
        self.assertEqual(self.current.stat().st_mode & 0o777, 0o600)
        self.assertNotIn('test_current_session', result.stdout + result.stderr)
        self.assertNotIn('test_private_najva_credential', result.stdout + result.stderr)

    def test_key_mismatch_requires_explicit_flag_without_changing_file(self):
        before = self.current.read_bytes()
        result = self.cli('restore-keys', self.old, self.current)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--restore-keys', result.stderr)
        self.assertEqual(self.current.read_bytes(), before)

    def test_allow_different_only_validates_and_does_not_apply(self):
        before = self.current.read_bytes()
        result = self.cli('restore-keys', self.old, self.current, '--allow-different')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.current.read_bytes(), before)

    def test_apply_restores_only_encryption_keys_atomically_with_private_mode(self):
        result = self.cli('restore-keys', self.old, self.current, '--apply')
        self.assertEqual(result.returncode, 0, result.stderr)
        values = env.read(self.current)
        self.assertEqual(values['SESSION_SECRET'], 'test_previous_session')
        self.assertEqual(values['MFA_ENCRYPTION_KEY'], 'test_previous_key')
        self.assertEqual(values['DATABASE_APP_ROLE'], 'idealmakoo_app')
        self.assertIn('# preserve comment', self.current.read_text())
        self.assertEqual(self.current.stat().st_mode & 0o777, 0o600)

    def test_newline_and_null_injection_or_undocumented_default_is_rejected(self):
        before = self.current.read_bytes()
        for value in ('line\nSECOND=bad', 'line\rSECOND=bad', 'nul\x00value', "single'quote"):
            with self.assertRaises(ValueError):
                env.write_changes(self.current, {'SESSION_SECRET': value})
        result = self.cli('defaults', self.current, self.old, 'UNDOCUMENTED=true')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.current.read_bytes(), before)


if __name__ == '__main__':
    unittest.main()
