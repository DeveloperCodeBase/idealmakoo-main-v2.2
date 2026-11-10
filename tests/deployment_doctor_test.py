"""Doctor must agree with the configured health deadline on a slow host."""
from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DoctorHealthBudgetTests(unittest.TestCase):
    def run_doctor(self, budget, delay_ms):
        with tempfile.TemporaryDirectory(prefix='idealmakoo-doctor-') as temporary:
            root = Path(temporary)
            (root / 'scripts').mkdir()
            (root / 'deploy').mkdir()
            shutil.copyfile(ROOT / 'scripts/doctor.sh', root / 'scripts/doctor.sh')
            shutil.copyfile(ROOT / 'deploy/app-healthcheck.mjs', root / 'deploy/app-healthcheck.mjs')
            (root / 'deploy/bootstrap-environment.py').write_text('# Configuration validation is covered separately.\n')
            # Keep Docker and configuration outside this probe-dispatch regression.
            # The production HTTP probe itself runs unchanged and its abort signal
            # is honored by a delayed, otherwise healthy endpoint response.
            (root / 'deploy/lib.sh').write_text('''#!/usr/bin/env bash
set -Eeuo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_ROOT/private.env"
require_environment() { :; }
release_id() { printf fixture; }
log() { printf '%s\\n' "$*" >&2; }
env_get() {
  case "$1" in
    APP_HEALTH_TIMEOUT_SECONDS) cat "$ENV_FILE" ;;
    COMPOSE_PROFILES) printf '' ;;
    *) return 1 ;;
  esac
}
privacy_cli() { :; }
dc() {
  if [[ "$1 $2 $3" == 'exec -T app' ]]; then
    shift 5
    node "$PROJECT_ROOT/deploy/fetch-fixture.mjs" "$PROJECT_ROOT/deploy/app-healthcheck.mjs" "${1:-8}"
  fi
}
'''.replace('"$1 $2 $3"', '"${1:-} ${2:-} ${3:-}"'))
            (root / 'private.env').write_text(budget)
            (root / 'private.env').chmod(0o600)
            (root / 'deploy/fetch-fixture.mjs').write_text('''
import { pathToFileURL } from 'node:url';
const modulePath = process.argv[2];
process.argv = [process.argv[0], modulePath, process.argv[3]];
globalThis.fetch = async (_url, { signal }) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => resolve({ ok: true, json: async () => ({ status: 'ok' }) }), Number(process.env.PROBE_DELAY_MS));
  signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted')); }, { once: true });
});
await import(pathToFileURL(modulePath));
''')
            return subprocess.run(['bash', str(root / 'scripts/doctor.sh')],
                                  env={**os.environ, 'PROBE_DELAY_MS': str(delay_ms)},
                                  capture_output=True, text=True, timeout=20)

    def test_configured_slow_healthy_probe_is_not_rejected_by_default_deadline(self):
        result = self.run_doctor('90', 7000)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Application health: ready', result.stderr)
        self.assertNotIn('Application health: unavailable', result.stderr)

    def test_blank_budget_uses_the_documented_default(self):
        result = self.run_doctor('', 20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('Application health: ready', result.stderr)


if __name__ == '__main__':
    unittest.main()
