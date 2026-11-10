import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {query} from '../src/server/db.ts';
import {runCrmTaskReminders,getCrmTask} from '../src/server/crm-operations.ts';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,recordFixture,permissions} from './helpers/crm-recovery-environment.mjs';

test('036 populated upgrade preserves an actual pre-policy in-app receipt without inventing queue metadata or resending it',{timeout:120000},async()=>{
 const actor=fixtureActor('legacy-reminder-staff'),seriesId=randomUUID(),occurrenceId=randomUUID(),notificationId=randomUUID(),acceptedAt=new Date(Date.now()-2*86400000),dedupe='crm-task:'+occurrenceId;let original;
 await withCrmRecoveryDatabase('reminder_upgrade',async()=>{
  const row=(await query('SELECT * FROM crm_task_occurrences WHERE id=$1',[occurrenceId])).rows[0];assert.equal(row.reminder_state,'delivered');assert.equal(row.reminded_at.toISOString(),acceptedAt.toISOString());assert.equal(row.reminder_outbox_id,null);assert.equal(row.version,1);
  assert.deepEqual((await query('SELECT * FROM notifications WHERE id=$1',[notificationId])).rows[0],original);assert.equal((await query("SELECT 1 FROM outbox WHERE dedupe_key LIKE $1",[dedupe+'%'])).rowCount,0);
  const results=await Promise.all([runCrmTaskReminders(),runCrmTaskReminders()]);assert.equal(results.reduce((sum,row)=>sum+row.examined,0),0);assert.equal(results.reduce((sum,row)=>sum+row.queued,0),0);assert.equal((await query('SELECT 1 FROM notifications WHERE dedupe_key=$1',[dedupe])).rowCount,1);
  const dto=await getCrmTask(actor,seriesId);assert.equal(dto.occurrences[0].reminderStatus,'delivered');assert.equal((await query('SELECT reminded_at FROM crm_task_occurrences WHERE id=$1',[occurrenceId])).rows[0].reminded_at.toISOString(),acceptedAt.toISOString());
 },{beforeMigration:async(file,client)=>{if(file!=='036_crm_task_reminder_policy.sql')return;await insertActor(actor,{scope:'all',grants:permissions},client);const record=await recordFixture(actor,{},client),definition={recordId:record.id,assigneeUserId:actor.id,title:'Actual historical in-app notification',body:'This fixture represents a committed notification receipt.',due:{kind:'instant',at:acceptedAt.toISOString()},recurrence:null,reminderMinutes:0};await client.query('INSERT INTO crm_task_series(id,record_id,definition,assignee_user_id,created_by) VALUES($1,$2,$3::jsonb,$4,$4)',[seriesId,record.id,JSON.stringify(definition),actor.id]);await client.query("INSERT INTO crm_task_occurrences(id,series_id,generation,ordinal,due_at,reminder_at,reminder_state,reminded_at) VALUES($1,$2,1,0,$3,$3,'delivered',$3)",[occurrenceId,seriesId,acceptedAt]);await client.query("INSERT INTO notifications(id,user_id,title,body,href,dedupe_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)",[notificationId,actor.id,definition.title,definition.body,'/en/admin/crm/activities/?record='+record.id,dedupe,acceptedAt]);original=(await client.query('SELECT * FROM notifications WHERE id=$1',[notificationId])).rows[0];}});
});
