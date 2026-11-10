// Owner-only read-only inventory. Rows are streamed in bounded cursor batches;
// only counts and hashes leave this process, never customer contents or secrets.
import pg from 'pg';
import { createHash } from 'node:crypto';

const quote = name => `"${String(name).replaceAll('"', '""')}"`;
const hash = value => createHash('sha256').update(value).digest('hex');
let client;
try {
  const address = new URL(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || '');
  if (process.env.PRIVACY_RESTORE_DATABASE) {
    if (!/^idealmakoo_drill_[a-z0-9_]+$/.test(process.env.PRIVACY_RESTORE_DATABASE)) throw new Error('Only isolated drill database overrides are allowed.');
    address.pathname = '/' + process.env.PRIVACY_RESTORE_DATABASE;
  }
  client = new pg.Client({ connectionString: address.toString(), connectionTimeoutMillis: 10000, statement_timeout: 600000 });
  await client.connect();
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query("SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle TO ISO,YMD; SET LOCAL extra_float_digits=3");
  const relations = (await client.query("SELECT c.relname AS name,c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m') ORDER BY c.relname COLLATE \"C\"")).rows;
  const tables = [];
  for (const relation of relations) {
    const digest = createHash('sha256');
    let rows = 0;
    const name = quote(relation.name);
    await client.query(`DECLARE backup_rows NO SCROLL CURSOR FOR SELECT row_to_json(t)::text AS value FROM public.${name} t ORDER BY row_to_json(t)::text COLLATE "C"`);
    while (true) {
      const batch = (await client.query('FETCH FORWARD 128 FROM backup_rows')).rows;
      if (!batch.length) break;
      for (const row of batch) {
        const bytes = Buffer.from(row.value, 'utf8');
        digest.update(String(bytes.length) + ':'); digest.update(bytes); digest.update('\n'); rows++;
      }
    }
    await client.query('CLOSE backup_rows');
    tables.push({name:relation.name,kind:relation.kind,rows,sha256:digest.digest('hex')});
  }
  const columns = (await client.query("SELECT table_name,column_name,ordinal_position,data_type,udt_name,is_nullable,column_default,is_identity,identity_generation,is_generated,generation_expression FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name COLLATE \"C\",ordinal_position")).rows;
  const constraints = (await client.query("SELECT c.conrelid::regclass::text AS relation,c.conname AS name,pg_get_constraintdef(c.oid,true) AS definition FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY c.conrelid::regclass::text COLLATE \"C\",c.conname COLLATE \"C\"")).rows;
  const triggers = (await client.query("SELECT c.relname AS relation,t.tgname AS name,pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname COLLATE \"C\",t.tgname COLLATE \"C\"")).rows;
  const routines = (await client.query("SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.proname COLLATE \"C\",pg_get_function_identity_arguments(p.oid) COLLATE \"C\"")).rows;
  const indexes = (await client.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename COLLATE \"C\",indexname COLLATE \"C\"")).rows;
  const views = (await client.query("SELECT viewname,definition FROM pg_views WHERE schemaname='public' ORDER BY viewname COLLATE \"C\"")).rows;
  const sequenceNames = (await client.query("SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename COLLATE \"C\"")).rows;
  const sequences=[];
  for(const {sequencename} of sequenceNames) {
    const row=(await client.query(`SELECT last_value::text,is_called FROM public.${quote(sequencename)}`)).rows[0];
    sequences.push({name:sequencename,...row});
  }
  const migrations=(await client.query('SELECT name,checksum FROM public.schema_migrations ORDER BY name COLLATE "C"')).rows;
  await client.query('COMMIT');
  process.stdout.write(JSON.stringify({format:1,relations:tables,sequences,migrations,structureSha256:hash(JSON.stringify({columns,constraints,triggers,routines,indexes,views})),totalRows:tables.reduce((sum,t)=>sum+t.rows,0)})+'\n');
} catch(error) {
  await client?.query('ROLLBACK').catch(()=>{});
  const code=typeof error?.code==='string' && /^[A-Z0-9]{5}$/.test(error.code)?error.code:'INVENTORY_FAILED';
  console.error('Database backup inventory failed:',code);
  process.exitCode=1;
} finally { await client?.end().catch(()=>{}); }
