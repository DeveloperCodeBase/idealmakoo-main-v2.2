"""Refuse key/archive aliases before any network call or private-file creation."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DownloadDestinationTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='idealmakoo-download-destination-')
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.marker = self.directory / 'ssh-was-called'
        self.commands = self.directory / 'commands'
        self.commands.mkdir()
        executable = self.commands / 'ssh'
        executable.write_text('#!/bin/sh\n: > "$DOWNLOAD_SSH_MARKER"\nexit 55\n')
        executable.chmod(0o700)
        self.environment = {**os.environ, 'PATH': str(self.commands) + os.pathsep + os.environ.get('PATH', ''),
                            'DOWNLOAD_SSH_MARKER': str(self.marker)}

    def refused(self, output, identity):
        result = subprocess.run(['bash', str(ROOT / 'scripts/download-backup.sh'),
                                 '--host', 'operator@backup.invalid', '--output', output,
                                 '--recovery-key-output', identity], cwd=self.directory,
                                env=self.environment, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('different physical destination', result.stderr)
        self.assertFalse(self.marker.exists())
        self.assertFalse(list(self.directory.rglob('*.partial.*')))
        self.assertFalse((self.directory / 'site.tar.age').exists())
        self.assertFalse((self.directory / 'site.tar.age.sha256').exists())

    def test_relative_and_absolute_archive_alias(self):
        self.refused('./site.tar.age', str(self.directory / 'site.tar.age'))

    def test_relative_and_absolute_checksum_alias(self):
        self.refused(str(self.directory / 'site.tar.age'), './site.tar.age.sha256')

    def test_parent_symlink_alias(self):
        (self.directory / 'alias').symlink_to(self.directory, target_is_directory=True)
        self.refused('./site.tar.age', './alias/site.tar.age')


if __name__ == '__main__':
    unittest.main()
