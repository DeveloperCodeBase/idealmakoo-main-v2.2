import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

const globalDb = globalThis as typeof globalThis & { __idealmakooPool?: pg.Pool };
export function pool(): pg.Pool {
  if (!globalDb.__idealmakooPool) {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const ssl = process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined;
    const instance = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl,
      max: Math.max(2, Math.min(50, Number(process.env.DB_POOL_SIZE) || 10)),
      idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000, application_name: 'idealmakoo',
    });
    instance.on('error', error => console.error(JSON.stringify({ level: 'error', event: 'database_pool', code: (error as NodeJS.ErrnoException).code || 'DB_CONNECTION' })));
    globalDb.__idealmakooPool = instance;
  }
  return globalDb.__idealmakooPool;
}
export function query<T extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) {
  return pool().query<T>(text, params);
}
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool().connect();
  try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function closeDb() { const current = globalDb.__idealmakooPool; delete globalDb.__idealmakooPool; if (current) await current.end(); }
export async function audit(actorId: string | null, action: string, entityType: string, entityId: string, details: unknown = {}, client?: PoolClient) {
  const sql = 'INSERT INTO audit_events(actor_id,action,entity_type,entity_id,details) VALUES ($1,$2,$3,$4,$5::jsonb)';
  const args = [actorId, action, entityType, entityId, JSON.stringify(details)];
  if (client) await client.query(sql, args); else await query(sql, args);
}

