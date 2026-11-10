// Executes read-only and rollback-only permission probes as the real app role.
import pg from 'pg';
let client;
try {
  const connection=new URL(process.env.DATABASE_URL || '');
  if(process.env.PRIVACY_RESTORE_DATABASE) {
    if(!/^idealmakoo_drill_[a-z0-9_]+$/.test(process.env.PRIVACY_RESTORE_DATABASE))throw new Error('Only isolated drill database overrides are allowed.');
    connection.pathname='/'+process.env.PRIVACY_RESTORE_DATABASE;
  }
  client=new pg.Client({connectionString:connection.toString(),connectionTimeoutMillis:10000,statement_timeout:30000});
  await client.connect();
  const role=(await client.query('SELECT current_user AS name,rolsuper,rolcreatedb,rolcreaterole,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
  if(role.name!=='idealmakoo_app'||role.rolsuper||role.rolcreatedb||role.rolcreaterole||role.rolbypassrls)throw new Error('Unexpected runtime privileges');
  const relations=(await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name")).rows;
  if(!relations.some(row=>row.table_name==='users'))throw new Error('Runtime cannot see required data relations');
  for(const row of relations) {
    if(row.table_name==='schema_migrations')throw new Error('Migration ledger exposed to runtime');
    const table='"'+row.table_name.replaceAll('"','""')+'"';
    await client.query(`SELECT 1 FROM public.${table} LIMIT 0`);
  }
  const forbidden=['SELECT * FROM public.schema_migrations LIMIT 0','CREATE TABLE public.runtime_must_not_create (id int)',
                   'DELETE FROM public.audit_events WHERE false','DELETE FROM public.ops_recovery_evidence WHERE false'];
  if(relations.some(row=>row.table_name==='staff_provisioned_accounts'))forbidden.push('DELETE FROM public.staff_provisioned_accounts WHERE false');
  for(const statement of forbidden) {
    await client.query('BEGIN');
    let denied=false;
    try {await client.query(statement);}catch(error){if(error.code==='42501')denied=true;else throw error;}
    finally {await client.query('ROLLBACK');}
    if(!denied)throw new Error('A forbidden runtime operation was accepted');
  }
  console.log(JSON.stringify({status:'passed',role:'idealmakoo_app',readableRelations:relations.length,deniedOperations:forbidden.length}));
}catch(error){
  await client?.query('ROLLBACK').catch(()=>{});
  console.error('Runtime permission verification failed; no credentials or row contents were printed.');
  process.exitCode=1;
}finally{await client?.end().catch(()=>{});}
