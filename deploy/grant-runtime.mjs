// This is an owner-only deployment command. A missing role must never succeed.
const role = process.env.DATABASE_APP_ROLE;
if (role !== 'idealmakoo_app') {
  console.error('Runtime database grants failed: DATABASE_APP_ROLE must be explicitly set to idealmakoo_app.');
  process.exitCode = 1;
} else {
  const { default: pg } = await import('pg');
  let client;
  try {
    let connectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
    if (process.env.PRIVACY_RESTORE_DATABASE) {
      if (!/^idealmakoo_drill_[a-z0-9_]+$/.test(process.env.PRIVACY_RESTORE_DATABASE)) throw new Error('Only isolated drill database overrides are allowed.');
      const connection = new URL(connectionString || '');
      connection.pathname = '/' + process.env.PRIVACY_RESTORE_DATABASE;
      connectionString = connection.toString();
    }
    client = new pg.Client({ connectionString });
    await client.connect();
    await client.query('BEGIN');
    const database = (await client.query('SELECT current_database() AS name')).rows[0].name;
    const quotedDatabase = `"${String(database).replaceAll('"', '""')}"`;
    await client.query(`REVOKE ALL ON DATABASE ${quotedDatabase} FROM PUBLIC`);
    await client.query(`GRANT CONNECT ON DATABASE ${quotedDatabase} TO idealmakoo_app`);
    await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC, idealmakoo_app');
    await client.query('GRANT USAGE ON SCHEMA public TO idealmakoo_app');
    await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO idealmakoo_app');
    await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO idealmakoo_app');
    for (const table of ['schema_migrations', 'audit_events', 'ops_recovery_evidence', 'staff_provisioned_accounts']) {
      const exists = await client.query('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${table}`]);
      if (!exists.rows[0].present) continue;
      const statement = table === 'audit_events'
        ? 'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE public.audit_events FROM idealmakoo_app'
        : ['ops_recovery_evidence', 'staff_provisioned_accounts'].includes(table)
          ? `REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.${table} FROM idealmakoo_app`
          : 'REVOKE ALL ON TABLE public.schema_migrations FROM idealmakoo_app';
      await client.query(statement);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => {});
    const code = typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : 'connection-or-query-error';
    // Driver messages can contain a password, URL or SQL parameter. Never print them.
    console.error('Runtime database grants failed:', code);
    process.exitCode = 1;
  } finally { await client?.end().catch(() => {}); }
}

