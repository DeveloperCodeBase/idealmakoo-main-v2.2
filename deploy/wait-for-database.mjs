import pg from 'pg';
const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required.');
const deadline = Date.now() + Number(process.env.DB_STARTUP_TIMEOUT_MS || 120000);
let ready = false;
while (Date.now() < deadline) {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  try {
    await client.connect();
    await client.query('SELECT 1');
    ready = true;
    break;
  } catch {
    // Connection strings and credentials deliberately never enter logs.
    await new Promise(resolve => setTimeout(resolve, 2000));
  } finally {
    await client.end().catch(() => {});
  }
}
if (!ready) {
  console.error('Database did not become ready before the startup deadline.');
  process.exitCode = 1;
}

