import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import pg from 'pg';

async function main() {
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required');
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock(917264830)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = resolve(process.cwd(), 'db/migrations');
    for (const file of (await readdir(directory)).filter(name => /^\d+.*\.sql$/.test(name)).sort()) {
      const sql = await readFile(resolve(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const found = await client.query('SELECT checksum FROM schema_migrations WHERE name=$1', [file]);
      if (found.rows[0]) { if (found.rows[0].checksum !== checksum) throw new Error('Applied migration changed: ' + file); continue; }
      await client.query('BEGIN');
      try { await client.query(sql); await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [file, checksum]); await client.query('COMMIT'); console.log('Applied ' + file); }
      catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally { await client.query('SELECT pg_advisory_unlock(917264830)').catch(() => {}); await client.end(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'Migration failed'); process.exitCode = 1; });
