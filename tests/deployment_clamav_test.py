"""Run the shipped scanner entrypoint against bounded executable substitutes.

Only its fixed /tmp and /var/lib/clamav paths are relocated into the test's
private directory. The actual shell writes its configuration, gates scanner
startup on successful signature initialization and supervises both children.
These tests do not claim to execute the ClamAV engine or detect a specimen;
the isolated Ubuntu acceptance separately exercises real INSTREAM results.
"""
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


STUB = r'''
import json
import os
from pathlib import Path
import signal
import sys
import time

root = Path(os.environ['SCANNER_TEST_ROOT'])
kind = Path(sys.argv[0]).name
if kind == 'sleep':
    time.sleep(0.02)
    raise SystemExit(0)
if kind == 'freshclam':
    if '--daemon' not in sys.argv:
        (root / 'initial-signature-fetch').touch()
        if os.environ['SCANNER_TEST_FETCH_FAILURE'] == '1':
            raise SystemExit(49)
        (root / 'database' / 'main.cvd').write_bytes(b'fixture-signatures')
        raise SystemExit(0)
    (root / 'updater-started').touch()
    deadline = time.monotonic() + 3
    while not (root / 'scanner-started').exists():
        if time.monotonic() >= deadline:
            raise SystemExit(71)
        time.sleep(0.01)
    # An updater which exits must take the scanner out of service too.
    raise SystemExit(5)
if kind != 'clamd':
    raise SystemExit(72)

def stopped(_signal, _frame):
    (root / 'scanner-stopped').touch()
    raise SystemExit(0)

signal.signal(signal.SIGTERM, stopped)
config_args = [arg for arg in sys.argv[1:] if arg.startswith('--config-file=')]
if len(config_args) != 1 or not (root / 'database' / 'main.cvd').is_file():
    raise SystemExit(73)
path = Path(config_args[0].split('=', 1)[1])
(root / 'scanner-observed.json').write_text(json.dumps({
    'configuration': path.read_text(),
    'mode': path.stat().st_mode & 0o777,
    'arguments': sys.argv[1:],
}))
(root / 'scanner-started').touch()
while True:
    signal.pause()
'''


class ScannerEntrypointTests(unittest.TestCase):
    def execute(self, *, initialized=False, fetch_failure=False):
        source = (ROOT / 'deploy/clamav/idealmakoo-clamav.sh').read_text()
        with tempfile.TemporaryDirectory(prefix='idealmakoo-clamav-entrypoint-') as directory:
            root = Path(directory)
            for part in ('temporary', 'database', 'bin'):
                (root / part).mkdir(mode=0o700)
            if initialized:
                (root / 'database' / 'main.cvd').write_bytes(b'existing-fixture-signatures')
            for command in ('clamd', 'freshclam', 'sleep'):
                path = root / 'bin' / command
                path.write_text('#!' + sys.executable + '\n' + STUB)
                path.chmod(0o700)
            # Relocation changes no startup/control-flow/configuration decisions.
            source = source.replace('/tmp/', str(root / 'temporary') + '/')
            source = source.replace('/var/lib/clamav', str(root / 'database'))
            path = root / 'entrypoint.sh'
            path.write_text(source)
            process = subprocess.run(['sh', str(path)], env={
                **os.environ, 'PATH': str(root / 'bin') + os.pathsep + os.environ['PATH'],
                'SCANNER_TEST_ROOT': directory,
                'SCANNER_TEST_FETCH_FAILURE': str(int(fetch_failure)),
            }, text=True, capture_output=True, timeout=10)
            observed = root / 'scanner-observed.json'
            return {
                'status': process.returncode,
                'stderr': process.stderr,
                'observed': json.loads(observed.read_text()) if observed.exists() else None,
                'fetched': (root / 'initial-signature-fetch').exists(),
                'scannerStarted': (root / 'scanner-started').exists(),
                'scannerStopped': (root / 'scanner-stopped').exists(),
                'updaterStarted': (root / 'updater-started').exists(),
                'freshclamMode': stat.S_IMODE((root / 'temporary' / 'freshclam.conf').stat().st_mode),
            }

    def test_emitted_configuration_refuses_detected_encryption_and_exceeded_limits(self):
        result = self.execute(initialized=True)
        self.assertEqual(result['status'], 1, result)
        self.assertIsNotNone(result['observed'], result)
        configuration = {}
        for line in result['observed']['configuration'].splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            key, value = line.split(None, 1)
            self.assertNotIn(key, configuration, 'Conflicting duplicate scanner option: ' + key)
            configuration[key] = value
        self.assertEqual(configuration['AlertExceedsMax'], 'yes')
        self.assertEqual(configuration['AlertEncrypted'], 'yes')
        self.assertEqual(configuration['MaxRecursion'], '16')
        self.assertEqual(configuration['MaxFiles'], '10000')
        self.assertEqual(configuration['MaxFileSize'], '96M')
        self.assertEqual(configuration['MaxScanSize'], '192M')
        self.assertEqual(result['observed']['mode'], 0o600)
        self.assertEqual(result['freshclamMode'], 0o600)
        self.assertFalse(result['fetched'])
        self.assertTrue(result['scannerStopped'], result)

    def test_empty_signature_store_is_initialized_before_scanner_and_updater_start(self):
        result = self.execute()
        self.assertEqual(result['status'], 1, result)
        self.assertTrue(result['fetched'], result)
        self.assertTrue(result['scannerStarted'], result)
        self.assertTrue(result['updaterStarted'], result)
        self.assertTrue(result['scannerStopped'], result)

    def test_signature_download_failure_never_starts_scanner_or_background_updater(self):
        result = self.execute(fetch_failure=True)
        self.assertEqual(result['status'], 49, result)
        self.assertTrue(result['fetched'], result)
        self.assertFalse(result['scannerStarted'], result)
        self.assertFalse(result['updaterStarted'], result)
        self.assertIsNone(result['observed'], result)


if __name__ == '__main__':
    unittest.main()
