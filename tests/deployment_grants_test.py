"""Exercise the grant CLI boundary without database credentials or networking."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class GrantCliTests(unittest.TestCase):
    def invoke(self, role=None, failure=False):
        with tempfile.TemporaryDirectory(prefix='idealmakoo-grants-test-') as directory:
            work = Path(directory)
            log = work / 'queries.json'
            stub = work / 'pg.mjs'
            stub.write_text("""import { writeFileSync } from 'node:fs';
const queries=[];
function record(text){queries.push(text);writeFileSync(process.env.TEST_GRANT_LOG,JSON.stringify(queries));}
export default {Client:class {
 async connect(){record('CONNECT');if(process.env.TEST_GRANT_FAILURE==='true')throw new Error('test_private_database_password');}
 async query(sql){record(sql);return {rows:sql.includes('current_database')?[{name:'test_database'}]:[{present:true}]};}
 async end(){record('END');}
}};
""")
            hook = work / 'hook.mjs'
            hook.write_text("import {registerHooks} from 'node:module';\n"
                "registerHooks({resolve(specifier,context,next){return specifier==='pg'"
                "?{url:new URL('./pg.mjs',import.meta.url).href,shortCircuit:true}:next(specifier,context);}});\n")
            env = {key: os.environ[key] for key in ('PATH', 'SystemRoot', 'LD_LIBRARY_PATH') if key in os.environ}
            env.update(TEST_GRANT_LOG=str(log), TEST_GRANT_FAILURE=str(failure).lower())
            if role is not None:
                env['DATABASE_APP_ROLE'] = role
            result = subprocess.run([shutil.which('node') or 'node', '--import', str(hook), str(ROOT / 'deploy/grant-runtime.mjs')],
                                    env=env, text=True, capture_output=True, timeout=20)
            queries = json.loads(log.read_text()) if log.exists() else []
            return result, queries

    def test_absent_or_unexpected_role_fails_before_connect(self):
        for role in (None, '', 'postgres', 'idealmakoo_owner'):
            with self.subTest(role=role):
                result, queries = self.invoke(role)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('DATABASE_APP_ROLE', result.stderr)
                self.assertEqual(queries, [])

    def test_valid_explicit_role_commits_only_runtime_permissions(self):
        result, queries = self.invoke('idealmakoo_app')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(queries[0:2], ['CONNECT', 'BEGIN'])
        self.assertEqual(queries[-2:], ['COMMIT', 'END'])
        self.assertIn('REVOKE ALL ON TABLE public.schema_migrations FROM idealmakoo_app', queries)
        self.assertIn('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_events FROM idealmakoo_app', queries)
        self.assertIn('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.ops_recovery_evidence FROM idealmakoo_app', queries)
        self.assertIn('REVOKE CREATE ON SCHEMA public FROM PUBLIC, idealmakoo_app', queries)

    def test_driver_failure_is_nonzero_and_credential_free(self):
        result, queries = self.invoke('idealmakoo_app', failure=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('connection-or-query-error', result.stderr)
        self.assertNotIn('test_private_database_password', result.stdout + result.stderr)
        self.assertNotIn('COMMIT', queries)
        self.assertIn('ROLLBACK', queries)

    def test_malformed_connection_urls_never_echo_credentials(self):
        marker = 'private-connection-value-must-never-appear'
        env = {key: os.environ[key] for key in ('PATH', 'SystemRoot', 'LD_LIBRARY_PATH') if key in os.environ}
        env.update(DATABASE_APP_ROLE='idealmakoo_app', DATABASE_URL=marker, MIGRATION_DATABASE_URL=marker)
        for script in ('grant-runtime.mjs', 'backup-inventory.mjs', 'verify-runtime-role.mjs'):
            with self.subTest(script=script):
                result = subprocess.run([shutil.which('node') or 'node', str(ROOT / 'deploy' / script)],
                                        env=env, text=True, capture_output=True, timeout=20)
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn(marker, result.stdout + result.stderr)
                self.assertNotIn('input:', result.stderr)


if __name__ == '__main__':
    unittest.main()
