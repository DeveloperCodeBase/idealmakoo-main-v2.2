#!/usr/bin/env python3
"""Run the shipped installer CLI/env/path preflight without host installation.

The fixture removes only Ubuntu/root discovery and its Python-package bootstrap,
then stops before operating-system prerequisites. Argument parsing, literal env
reading, canonicalization, symlinks and the actual path guard run unchanged in
Bash. No Docker/systemd/package command is executed, and no real target is made.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


ROOT = Path(os.environ.get('IDEALMAKOO_TEST_SOURCE_ROOT', Path(__file__).resolve().parents[1]))


class InstallerPathPreflightTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-installer-path-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        (self.root / 'scripts').mkdir()
        (self.root / 'deploy').mkdir()
        for name in ('lib.sh', 'env-file.py'):
            shutil.copyfile(ROOT / 'deploy' / name, self.root / 'deploy' / name)
        for name in ('Dockerfile', 'package-lock.json'):
            (self.root / name).touch()
        source = (ROOT / 'scripts/install-ubuntu.sh').read_text()
        before_host = '[[ "$EUID" == 0 ]] || die "Run the installer with sudo."\n'
        after_host = 'if [[ -z "$input_env" && -f "$SOURCE_ROOT/.env" ]]; then input_env="$SOURCE_ROOT/.env"; fi\n'
        before_install = "install_phase='operating-system prerequisites'\n"
        for marker in (before_host, after_host, before_install):
            self.assertEqual(source.count(marker), 1, 'Installer fixture boundary changed')
        self.assertLess(source.index(before_host), source.index(after_host))
        self.assertLess(source.index(after_host), source.index(before_install))
        preflight = source[:source.index(before_host)] + source[source.index(after_host):source.index(before_install)]
        self.assertNotIn('apt-get ', preflight)
        self.script = self.root / 'scripts/install-preflight.sh'
        self.script.write_text(preflight + '\nprintf "PREFLIGHT_ACCEPTED:%s:%s\\n" "$app_dir" "$backup_timer"\n')

    def run_preflight(self, *arguments):
        return subprocess.run(
            ['bash', str(self.script), '--domain', '127.0.0.1', '--http',
             '--skip-resource-check', *map(str, arguments)],
            cwd=self.root, env={'PATH': os.defpath, 'LC_ALL': 'C'},
            capture_output=True, text=True, timeout=10,
        )

    def assert_timer_rejected(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertNotIn('PREFLIGHT_ACCEPTED:', result.stdout)
        for text in ('daily backup timer', '/var/www', '/opt', '--without-backup-timer'):
            self.assertIn(text, result.stderr)

    def assert_accepted(self, result, path, timer=1):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip(), f'PREFLIGHT_ACCEPTED:{path}:{timer}')

    def test_daily_timer_rejects_each_protected_subtree(self):
        for path in ('/home/operator/site', '/root/site', '/run/user/1000/site', '/run/user', '/tmp/site', '/var/tmp/site', '/var/tmp'):
            with self.subTest(path=path):
                self.assert_timer_rejected(self.run_preflight('--app-dir', path))

    def test_explicit_manual_backup_mode_preserves_protected_subdirectories(self):
        for path in ('/home/operator/site', '/root/site', '/run/user/1000/site', '/tmp/site', '/var/tmp/site'):
            with self.subTest(path=path):
                self.assert_accepted(self.run_preflight('--app-dir', path, '--without-backup-timer'), path, 0)

    def test_parent_components_are_canonicalized_before_timer_validation(self):
        for path in ('/var/www/../../home/operator/site', '/opt/../root/site', '/var/../run/user/1000/site', '/opt/../tmp/site', '/opt/../var/tmp/site'):
            with self.subTest(path=path):
                self.assert_timer_rejected(self.run_preflight('--app-dir', path))

    def test_real_symlink_into_protected_tree_is_rejected_unless_manual(self):
        for index, protected in enumerate(('/home', '/root', '/run/user', '/tmp', '/var/tmp')):
            with self.subTest(protected=protected):
                alias = self.root / f'protected-alias-{index}'
                alias.symlink_to(protected, target_is_directory=True)
                selected = alias / 'operator/site'
                self.assert_timer_rejected(self.run_preflight('--app-dir', selected))
                self.assert_accepted(self.run_preflight('--app-dir', selected, '--without-backup-timer'), protected + '/operator/site', 0)

    def test_literal_environment_root_and_explicit_cli_override(self):
        alias = self.root / 'protected-alias'
        alias.symlink_to('/root', target_is_directory=True)
        environment = self.root / 'selected.env'
        environment.write_text(f'INSTALL_ROOT={alias}/site\n')
        environment.chmod(0o600)
        self.assert_timer_rejected(self.run_preflight('--env-file', environment))
        self.assert_accepted(self.run_preflight('--env-file', environment, '--app-dir', '/var/www/site'), '/var/www/site')
        self.assert_accepted(self.run_preflight('--env-file', environment, '--without-backup-timer'), '/root/site', 0)

    def test_supported_roots_and_similar_prefixes_remain_accepted(self):
        self.assert_accepted(self.run_preflight(), '/var/www/idealmakoo')
        for path in ('/var/www/site', '/opt/site', '/home-sites/site', '/root-site/site', '/run/username/site', '/tmp-sites/site', '/var/tmp-sites/site'):
            with self.subTest(path=path):
                self.assert_accepted(self.run_preflight('--app-dir', path), path)

    def test_real_alias_to_supported_root_is_accepted_after_resolution(self):
        alias = self.root / 'deployment-alias'
        alias.symlink_to('/opt', target_is_directory=True)
        self.assert_accepted(self.run_preflight('--app-dir', alias / 'site'), '/opt/site')


if __name__ == '__main__':
    unittest.main()
