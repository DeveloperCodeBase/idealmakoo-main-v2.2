import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {query,transaction,closeDb} from '../src/server/db.ts';
import {getWorkspace} from '../src/server/workspace.ts';
import {createCrmTask,getCrmTask,updateCrmTask,setCrmTaskOccurrence,runCrmTaskReminders,canDeliverCrmTaskReminder} from '../src/server/crm-operations.ts';
import {getNotificationPreferences,patchNotificationPreferences,flushNotificationDigests} from '../src/server/notification-policy.ts';
import {deliverOutbox} from '../src/server/notifications.ts';
import {decrypt} from '../src/server/crypto.ts';

const database=process.env.TEST_ADMIN_DATABASE_URL||process.env.MIGRATION_DATABASE_URL||process.env.TEST_DATABASE_URL;
const languages=['fa','en','tr','ar','ru'];
const actor=(id,role='business')=>({id,name:id,email:id+'@example.invalid',role,mfaVerified:true,qualityScope:true,allowedLocales:languages});
const admin=actor('task-policy-admin','admin'),assignee=actor('task-policy-assignee'),other=actor('task-policy-other');
const text=value=>Object.fromEntries(languages.map(locale=>[locale,value]));
async function makeTask(options={}){
  const id='reminder-record-'+randomUUID(),record={id,collection:'leads',title:text('Isolated task target'),summary:text(''),status:'active',owner:'business',ownerId:assignee.id,tags:options.quality?['quality']:[],history:[],details:{},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),demo:false};
  await query("INSERT INTO workspace_entities(bucket,id,collection,status,data,created_by,updated_by) VALUES('records',$1,'leads','active',$2::jsonb,$3,$3)",[id,JSON.stringify(record),admin.id]);
  return createCrmTask(admin,{recordId:id,assigneeUserId:assignee.id,title:'Isolated task '+randomUUID(),body:'No external message is sent.',due:{kind:'instant',at:new Date(Date.now()-10000).toISOString()},recurrence:null,reminderMinutes:0});
}
async function occurrence(task){return(await query('SELECT * FROM crm_task_occurrences WHERE id=$1',[task.occurrences[0].id])).rows[0];}
async function outbox(id){return(await query('SELECT * FROM outbox WHERE id=$1',[id])).rows[0];}
async function claim(id){const row=(await query("UPDATE outbox SET state='running',attempts=attempts+1,lock_token=$2,locked_at=now() WHERE id=$1 AND state='pending' RETURNING id,kind,payload,attempts,lock_token",[id,randomUUID()])).rows[0];assert.ok(row);return row;}
async function deliver(id){await deliverOutbox(await claim(id),{sendMail:async()=>{throw new Error('Internal task reminders must never contact an external provider.');}});}
async function preferences(by=assignee,update=()=>{}){const row=await getNotificationPreferences(by);row.preferences.timezone='UTC';const policy=row.preferences.topics.requests.inApp;Object.assign(policy,{enabled:true,frequency:'instant',quietStart:null,quietEnd:null});update(policy,row.preferences);return patchNotificationPreferences(by,{expectedVersion:row.version,preferences:row.preferences});}

test('PostgreSQL task reminder enqueue, preferences, actual acceptance and current assignment policy',{timeout:180000},async t=>{
  assert.ok(database,'The reminder policy gate requires PostgreSQL; a skipped suite is not acceptance evidence.');
  const schema='task_reminders_'+randomUUID().replaceAll('-',''),control=new pg.Client({connectionString:database});await control.connect();await control.query('CREATE SCHEMA '+schema);
  const scoped=new URL(database);scoped.searchParams.set('options','-c search_path='+schema);
  const keys=['DATABASE_URL','NODE_ENV','DEMO_MODE','PRIVACY_LEDGER_DIR','SESSION_SECRET','MFA_ENCRYPTION_KEY','SITE_URL','NOTIFICATIONS_MODE'],old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{DATABASE_URL:scoped.toString(),NODE_ENV:'test',SESSION_SECRET:'isolated-reminder-policy-session-secret',MFA_ENCRYPTION_KEY:'c'.repeat(64),SITE_URL:'http://localhost:3000',NOTIFICATIONS_MODE:'off'});delete process.env.DEMO_MODE;delete process.env.PRIVACY_LEDGER_DIR;await closeDb();
  try{
    const migrate=new pg.Client({connectionString:scoped.toString()});await migrate.connect();try{for(const file of(await readdir(new URL('../db/migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')).sort())await migrate.query(await readFile(new URL('../db/migrations/'+file,import.meta.url),'utf8'));}finally{await migrate.end();}
    for(const by of[admin,assignee,other])await query("INSERT INTO users(id,name,email,password_hash,role,active,mfa_enabled,quality_scope,allowed_locales,crm_scope,crm_permissions) VALUES($1,$2,$3,'isolated non-login fixture',$4,true,true,true,$5::jsonb,'all',$6::jsonb)",[by.id,by.name,by.email,by.role,JSON.stringify(languages),JSON.stringify({assign:true,contact:true})]);
    await getWorkspace(admin);
    t.beforeEach(async()=>{await query("UPDATE users SET active=true,mfa_enabled=true,quality_scope=true,role='business',crm_scope='all' WHERE id=ANY($1::text[])",[[assignee.id,other.id]]);await preferences();await preferences(other);});
    t.afterEach(async()=>{await query("UPDATE crm_task_series SET active=false WHERE active");await query("UPDATE outbox SET state='cancelled',lock_token=NULL WHERE state IN ('pending','running','batched')");});
    await t.test('Two workers queue one durable copy; only accepted in-app delivery sets delivered and remindedAt',async()=>{
      const task=await makeTask(),results=await Promise.all([runCrmTaskReminders(),runCrmTaskReminders()]);assert.equal(results.reduce((n,row)=>n+row.queued,0),1);
      let row=await occurrence(task);assert.equal(row.reminder_state,'queued');assert.equal(row.reminded_at,null);assert.ok(row.reminder_outbox_id);
      assert.equal((await query('SELECT 1 FROM notifications WHERE dedupe_key=$1',['outbox:'+row.reminder_outbox_id])).rowCount,0);
      await deliver(row.reminder_outbox_id);row=await occurrence(task);assert.equal(row.reminder_state,'delivered');assert.ok(row.reminded_at);assert.equal((await outbox(row.reminder_outbox_id)).state,'delivered');
      assert.equal((await runCrmTaskReminders()).queued,0);assert.equal((await query('SELECT 1 FROM notifications WHERE dedupe_key=$1',['outbox:'+row.reminder_outbox_id])).rowCount,1);
    });
    await t.test('A current in-app requests opt-out cancels the copy without an accepted timestamp',async()=>{
      const task=await makeTask();await runCrmTaskReminders();const queued=await occurrence(task);await preferences(assignee,policy=>{policy.enabled=false;});await deliver(queued.reminder_outbox_id);
      const row=await occurrence(task);assert.equal(row.reminder_state,'cancelled');assert.equal(row.reminded_at,null);assert.equal((await outbox(queued.reminder_outbox_id)).state,'cancelled');assert.equal((await query('SELECT 1 FROM notifications WHERE dedupe_key=$1',['outbox:'+queued.reminder_outbox_id])).rowCount,0);
    });
    await t.test('Current IANA quiet hours defer delivery and preserve queued until the window is cleared',async()=>{
      const task=await makeTask();await runCrmTaskReminders();const queued=await occurrence(task),hour=new Date().getUTCHours(),clock=hour=>String((hour+24)%24).padStart(2,'0')+':00';
      await preferences(assignee,policy=>{policy.quietStart=clock(hour-1);policy.quietEnd=clock(hour+2);});await deliver(queued.reminder_outbox_id);
      let job=await outbox(queued.reminder_outbox_id);assert.equal(job.state,'pending');assert.equal(job.last_error,'QUIET_HOURS');assert.ok(job.available_at.getTime()>Date.now());assert.equal((await occurrence(task)).reminder_state,'queued');assert.equal((await occurrence(task)).reminded_at,null);
      await preferences();await deliver(job.id);assert.equal((await occurrence(task)).reminder_state,'delivered');
    });
    await t.test('Daily digest acceptance completes its source reminder only after the actual batch is accepted',async()=>{
      await preferences(assignee,policy=>{policy.frequency='daily';});const task=await makeTask();await runCrmTaskReminders();const queued=await occurrence(task);
      await query("UPDATE outbox SET created_at=now()-interval '3 days' WHERE id=$1",[queued.reminder_outbox_id]);await deliver(queued.reminder_outbox_id);assert.equal((await outbox(queued.reminder_outbox_id)).state,'batched');assert.equal((await occurrence(task)).reminder_state,'queued');assert.equal((await occurrence(task)).reminded_at,null);
      await flushNotificationDigests();const member=(await query('SELECT digest_outbox_id FROM notification_digest_items WHERE outbox_id=$1',[queued.reminder_outbox_id])).rows[0];assert.ok(member.digest_outbox_id);await deliver(member.digest_outbox_id);
      assert.equal((await occurrence(task)).reminder_state,'delivered');assert.ok((await occurrence(task)).reminded_at);assert.equal((await outbox(queued.reminder_outbox_id)).state,'delivered');
    });
    await t.test('Current quality, role, MFA and record access revocation suppress stale queued copies',async()=>{
      for(const mutation of["UPDATE users SET quality_scope=false WHERE id=$1","UPDATE users SET role='customer' WHERE id=$1","UPDATE users SET mfa_enabled=false WHERE id=$1","UPDATE users SET crm_scope='assigned' WHERE id=$1"]){
        const quality=mutation.includes('quality_scope');await query("UPDATE users SET quality_scope=true,role=$2,mfa_enabled=true,crm_scope='all' WHERE id=$1",[assignee.id,quality?'admin':'business']);const task=await makeTask({quality});await runCrmTaskReminders();const queued=await occurrence(task);
        if(mutation.includes("crm_scope='assigned'"))await query("UPDATE workspace_entities SET data=jsonb_set(data,'{ownerId}',to_jsonb($2::text)) WHERE bucket='records' AND id=$1",[task.definition.recordId,other.id]);
        await query(mutation,[assignee.id]);await deliver(queued.reminder_outbox_id);assert.equal((await occurrence(task)).reminder_state,'cancelled');assert.equal((await occurrence(task)).reminded_at,null);
      }
    });
    await t.test('Task completion or replan invalidates an already claimed copy before it can become a visible notification',async()=>{
      const task=await makeTask();await runCrmTaskReminders();const queued=await occurrence(task),claimed=await claim(queued.reminder_outbox_id);
      await setCrmTaskOccurrence(admin,queued.id,{status:'completed'},queued.version);await deliverOutbox(claimed);assert.equal((await outbox(claimed.id)).state,'cancelled');assert.equal((await occurrence(task)).reminder_state,'cancelled');assert.equal((await query('SELECT 1 FROM notifications WHERE dedupe_key=$1',['outbox:'+claimed.id])).rowCount,0);
      const replanned=await makeTask();await runCrmTaskReminders();const old=await occurrence(replanned);const next=await updateCrmTask(admin,replanned.id,{...replanned.definition,due:{kind:'instant',at:new Date(Date.now()+86400000).toISOString()}},replanned.version);await deliver(old.reminder_outbox_id);assert.equal((await outbox(old.reminder_outbox_id)).state,'cancelled');assert.equal(next.generation,2);assert.equal(next.occurrences[0].reminderStatus,'pending');
    });
    await t.test('Reassignment preserves the old outbox record but only the new current recipient receives a fresh copy',async()=>{
      const task=await makeTask();await runCrmTaskReminders();const previous=await occurrence(task),claimed=await claim(previous.reminder_outbox_id);
      const updated=await updateCrmTask(admin,task.id,{...task.definition,assigneeUserId:other.id},task.version);assert.equal(updated.occurrences[0].reminderStatus,'pending');await runCrmTaskReminders();const current=await occurrence(task);assert.notEqual(current.reminder_outbox_id,previous.reminder_outbox_id);
      await deliverOutbox(claimed);assert.equal((await outbox(previous.reminder_outbox_id)).state,'cancelled');assert.equal((await occurrence(task)).reminder_state,'queued');await deliver(current.reminder_outbox_id);
      const delivered=(await query('SELECT user_id FROM notifications WHERE dedupe_key=$1',['outbox:'+current.reminder_outbox_id])).rows;assert.deepEqual(delivered.map(row=>row.user_id),[other.id]);assert.equal((await query('SELECT 1 FROM notifications WHERE dedupe_key=$1',['outbox:'+previous.reminder_outbox_id])).rowCount,0);
    });
    await t.test('An in-app insert and its authorization retain the workspace lock until accepted, so a concurrent closure cannot slip between them',async()=>{
      const task=await makeTask();await runCrmTaskReminders();const queued=await occurrence(task),claimed=await claim(queued.reminder_outbox_id),blocker=new pg.Client({connectionString:scoped.toString()});await blocker.connect();await blocker.query('BEGIN');await blocker.query('LOCK TABLE notifications IN ACCESS EXCLUSIVE MODE');
      let delivering,closing;
      const waitFor=async lookup=>{const deadline=Date.now()+5000;while(Date.now()<deadline){const value=await lookup();if(value)return value;await new Promise(resolve=>setTimeout(resolve,15));}throw new Error('The controlled database lock interleaving did not reach its bounded checkpoint.');};
      try{
        delivering=deliverOutbox(claimed);
        const waiting=await waitFor(async()=>{const rows=(await control.query("SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'INSERT INTO notifications%' AND datname=current_database()")).rows;return rows[0];});
        closing=setCrmTaskOccurrence(admin,queued.id,{status:'completed'},queued.version);
        await waitFor(async()=>{const rows=(await control.query("SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE 'SELECT version FROM workspace_meta%' AND $1=ANY(pg_blocking_pids(pid))",[waiting.pid])).rows;return rows[0];});
      }finally{await blocker.query('COMMIT');await blocker.end();if(delivering)await delivering;if(closing)await closing;}
      const final=await occurrence(task);assert.equal(final.status,'completed');assert.equal(final.reminder_state,'delivered');assert.ok(final.reminded_at);assert.equal((await query('SELECT 1 FROM notifications WHERE dedupe_key=$1',['outbox:'+queued.reminder_outbox_id])).rowCount,1);
    });
    await t.test('A forged occurrence binding is denied and an audit failure atomically restores pending without an orphan outbox',async()=>{
      const task=await makeTask();await query("CREATE FUNCTION task_queue_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='crm.task.reminder.queued' THEN RAISE EXCEPTION 'controlled reminder audit failure'; END IF; RETURN NEW; END $$");await query('CREATE TRIGGER task_queue_audit_failure BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION task_queue_audit_failure()');
      try{await assert.rejects(runCrmTaskReminders(),/controlled reminder audit failure/);}finally{await query('DROP TRIGGER task_queue_audit_failure ON audit_events');}
      assert.equal((await occurrence(task)).reminder_state,'pending');assert.equal((await occurrence(task)).reminder_outbox_id,null);assert.equal((await query('SELECT 1 FROM outbox WHERE dedupe_key LIKE $1',['crm-task:'+task.occurrences[0].id+':%'])).rowCount,0);
      await runCrmTaskReminders();const queued=await occurrence(task),job=await outbox(queued.reminder_outbox_id),payload=JSON.parse(decrypt(job.payload.encrypted));assert.equal(await transaction(client=>canDeliverCrmTaskReminder(client,payload,job.id)),true);assert.equal(await transaction(client=>canDeliverCrmTaskReminder(client,{...payload,userId:other.id},job.id)),false);assert.equal(await transaction(client=>canDeliverCrmTaskReminder(client,payload,randomUUID())),false);
      const view=await getCrmTask(admin,task.id);assert.equal(view.occurrences[0].reminderStatus,'queued');assert.equal(view.occurrences[0].remindedAt,null);
    });
  }finally{await closeDb();for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];await control.query('DROP SCHEMA '+schema+' CASCADE');await control.end();}
});
