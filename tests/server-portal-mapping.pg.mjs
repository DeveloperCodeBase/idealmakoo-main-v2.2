import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {query} from '../src/server/db.ts';
import {HttpError} from '../src/server/types.ts';
import {getWorkspace} from '../src/server/workspace.ts';
import {createOrganization,getOrganizations,updateOrganization,linkPortalOrganizationAccount,listPortalCrmAccountCandidates,getManagedPortalOrganization,getPortalOrganizationLinkHistory,sharedRequestPermission} from '../src/server/organizations.ts';
import {withCrmRecoveryDatabase,fixtureActor,insertActor,recordFixture,permissions,fixtureHttpSession} from './helpers/crm-recovery-environment.mjs';

const senior=fixtureActor('portal-senior','superAdmin'),staff=fixtureActor('portal-manager'),outsider=fixtureActor('portal-outsider'),customer=fixtureActor('portal-customer','customer'),member=fixtureActor('portal-member','customer');
const legacyId=randomUUID(),legacyRequest='portal-legacy-request';
const error=(status,code)=>value=>value instanceof HttpError&&value.status===status&&(!code||value.code===code);
async function account(owner,title){const row=await recordFixture(owner,{collection:'accounts',title,details:{crmDomain:{schemaVersion:1,kind:'account',revision:1}}});await query("INSERT INTO crm_account_profiles(record_id,display_name,legal_name,activity,lifecycle,registrations,addresses) VALUES($1,$2,$2,'other','active','[]'::jsonb,'[]'::jsonb)",[row.id,title]);return row;}
const mappingInput=(org,target)=>({accountId:target.id,expectedOrganizationVersion:org.version,expectedAccountVersion:target.version,expectedAccountRecordVersion:target.recordVersion,reason:'Explicit staff verification of this isolated portal account.'});

test('Recovered portal CRM mapping: populated migration, explicit current-scope link, private fields and atomic history',{timeout:180000},async t=>{
 let legacy;
 await withCrmRecoveryDatabase('portal_recovery',async()=>{
  for(const actor of[senior,staff,outsider])await insertActor(actor,{scope:actor===outsider?'assigned':'all',grants:permissions});await getWorkspace(senior);
  await t.test('026 upgrades populated organizations into distinct pending prospects without changing shares, memberships or consent',async()=>{
   const row=(await query('SELECT * FROM customer_organizations WHERE id=$1',[legacyId])).rows[0];assert.equal(row.crm_account_id,'portal-account-'+legacyId);assert.equal(row.crm_link_state,'pending');assert.equal(row.version,7);assert.equal(row.crm_linked_by,null);assert.equal(row.name,legacy.name);assert.equal(row.owner_id,customer.id);
   const profile=(await query('SELECT * FROM crm_account_profiles WHERE record_id=$1',[row.crm_account_id])).rows[0];assert.equal(profile.lifecycle,'prospect');assert.equal(profile.display_name,legacy.name);assert.deepEqual(profile.registrations,[]);
   const record=(await query("SELECT data FROM workspace_entities WHERE bucket='records' AND id=$1",[row.crm_account_id])).rows[0].data;assert.equal(record.ownerId,undefined);assert.ok(record.tags.includes('unverified'));assert.equal(record.details.portalOrganizationImport.review,'unverified');
   assert.deepEqual((await query('SELECT organization_id,user_id,role,active FROM organization_memberships WHERE organization_id=$1 ORDER BY user_id',[legacyId])).rows,legacy.memberships);
   assert.deepEqual((await query('SELECT organization_id,request_id,permission,shared_by,revoked_at FROM request_shares WHERE organization_id=$1',[legacyId])).rows,legacy.shares);
   assert.deepEqual((await query('SELECT portal FROM user_settings WHERE user_id=$1',[customer.id])).rows[0].portal,legacy.portal);
   assert.equal((await query("SELECT count(*)::int AS n FROM organization_crm_link_events WHERE organization_id=$1 AND link_state='pending'",[legacyId])).rows[0].n,1);
   assert.equal((await query("SELECT count(*)::int AS n FROM audit_events WHERE action='organization.crm.imported' AND entity_id=$1",[legacyId])).rows[0].n,1);
   assert.equal(await sharedRequestPermission(member,legacyRequest),'view');
  });
  let org,target;
  await t.test('Customer creation yields only an opaque pending reference and never binds by a matching account name',async()=>{
   target=await account(staff,'An identical organization name');org=(await createOrganization(customer,{name:'An identical organization name',city:'Fixture city',country:'Fixture country'})).items.find(item=>item.id!==legacyId);assert.ok(org);assert.deepEqual(org.crmLink,{reference:org.id,state:'pending'});assert.equal(JSON.stringify(org).includes(target.id),false);
   const internal=await getManagedPortalOrganization(staff,org.id);assert.notEqual(internal.account.id,target.id);assert.equal(internal.linkState,'pending');assert.equal(internal.sharedRequestCount,0);
  });
  await t.test('Only an eligible actual account with current triple versions can be linked; identical concurrent commands commit once',async()=>{
   const current=await getManagedPortalOrganization(staff,org.id),destination=(await listPortalCrmAccountCandidates(staff,org.id,{search:target.id})).items.find(item=>item.id===target.id);assert.ok(destination);
   const input=mappingInput(current,destination),result=await Promise.allSettled([linkPortalOrganizationAccount(staff,org.id,input),linkPortalOrganizationAccount(staff,org.id,input)]);assert.equal(result.filter(row=>row.status==='fulfilled').length,1);assert.equal(result.filter(row=>row.status==='rejected'&&error(409,'CONFLICT')(row.reason)).length,1);
   const linked=await getManagedPortalOrganization(staff,org.id);assert.equal(linked.account.id,target.id);assert.equal(linked.linkState,'linked');assert.equal(linked.sharedRequestCount,0);const history=(await getPortalOrganizationLinkHistory(staff,org.id)).items;assert.equal(history.length,2);assert.ok(history.some(item=>item.state==='linked'&&item.accountId===target.id&&item.previousAccountId!==target.id));
   await assert.rejects(query('DELETE FROM organization_crm_link_events WHERE organization_id=$1',[org.id]));
  });
  await t.test('Private portal edits preserve staff-maintained CRM identity and public customer projection hides staff history',async()=>{
   const own=(await getOrganizations(customer)).items.find(item=>item.id===org.id);await updateOrganization(customer,org.id,{name:'Customer-only editable name',city:'Private customer city'},own.version);assert.equal((await query('SELECT display_name FROM crm_account_profiles WHERE record_id=$1',[target.id])).rows[0].display_name,'An identical organization name');
   const response=await(await fixtureHttpSession(customer)).request(`/crm/portal-organizations/${org.id}`);assert.equal(response.status,403);assert.equal((await getOrganizations(customer)).items.find(item=>item.id===org.id).crmLink.state,'linked');
  });
  await t.test('Current contact or record scope revocation denies selection, mapping and history even with a stale actor object',async()=>{
   await assert.rejects(getManagedPortalOrganization(outsider,org.id),error(404));await query("UPDATE users SET crm_permissions='{}'::jsonb WHERE id=$1",[staff.id]);await assert.rejects(getManagedPortalOrganization(staff,org.id),error(403,'CRM_ACCOUNT_MAPPING'));await assert.rejects(getPortalOrganizationLinkHistory(staff,org.id),error(403));await query('UPDATE users SET crm_permissions=$2::jsonb WHERE id=$1',[staff.id,JSON.stringify(permissions)]);
   const alternate=await account(staff,'Versioned destination'),current=await getManagedPortalOrganization(staff,org.id),candidate=(await listPortalCrmAccountCandidates(staff,org.id,{search:alternate.id})).items[0];await query('UPDATE crm_account_profiles SET version=version+1 WHERE record_id=$1',[alternate.id]);await assert.rejects(linkPortalOrganizationAccount(staff,org.id,mappingInput(current,candidate)),error(409,'CONFLICT'));
   await query("UPDATE users SET crm_scope='assigned' WHERE id=$1",[staff.id]);await query("UPDATE workspace_entities SET data=jsonb_set(data,'{ownerId}',to_jsonb($2::text)) WHERE bucket='records' AND id=$1",[target.id,outsider.id]);await assert.rejects(getPortalOrganizationLinkHistory(staff,org.id),error(404));await query("UPDATE users SET crm_scope='all' WHERE id=$1",[staff.id]);
  });
  await t.test('A failed audit rolls back link, immutable event and organization/workspace versions together',async()=>{
   const alternate=await account(staff,'Rollback target'),current=await getManagedPortalOrganization(staff,org.id),candidate=(await listPortalCrmAccountCandidates(staff,org.id,{search:alternate.id})).items[0],before=(await query('SELECT version FROM workspace_meta WHERE singleton=true')).rows[0].version,count=(await query('SELECT count(*)::int AS n FROM organization_crm_link_events WHERE organization_id=$1',[org.id])).rows[0].n;
   await query("CREATE FUNCTION portal_mapping_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='organization.crm.linked' THEN RAISE EXCEPTION 'Controlled portal audit failure'; END IF; RETURN NEW; END $$");await query('CREATE TRIGGER portal_mapping_audit_fail BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION portal_mapping_audit_fail()');
   try{await assert.rejects(linkPortalOrganizationAccount(staff,org.id,mappingInput(current,candidate)));}finally{await query('DROP TRIGGER portal_mapping_audit_fail ON audit_events');}
   const after=await getManagedPortalOrganization(staff,org.id);assert.equal(after.version,current.version);assert.equal(after.account.id,current.account.id);assert.equal((await query('SELECT version FROM workspace_meta WHERE singleton=true')).rows[0].version,before);assert.equal((await query('SELECT count(*)::int AS n FROM organization_crm_link_events WHERE organization_id=$1',[org.id])).rows[0].n,count);
  });
 },{beforeMigration:async(file,client)=>{if(file!=='026_portal_crm_accounts.sql')return;for(const actor of[customer,member])await insertActor(actor,{},client);await client.query('INSERT INTO customer_organizations(id,name,city,country,owner_id,version) VALUES($1,$2,$3,$4,$5,7)',[legacyId,'Legacy private organization','Existing city','Existing country',customer.id]);await client.query("INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'owner'),($1,$3,'viewer')",[legacyId,customer.id,member.id]);await client.query("INSERT INTO requests(id,owner_id,kind,locale,data) VALUES($1,$2,'rfq','en',$3::jsonb)",[legacyRequest,customer.id,JSON.stringify({id:legacyRequest,ownerId:customer.id,status:'received',name:customer.name,email:customer.email,kind:'rfq'})]);await client.query("INSERT INTO request_shares(organization_id,request_id,permission,shared_by) VALUES($1,$2,'reply',$3)",[legacyId,legacyRequest,customer.id]);const portal={notificationPreferences:{email:false,inApp:false},explicitFixture:'preserve'};await client.query('INSERT INTO user_settings(user_id,portal) VALUES($1,$2::jsonb)',[customer.id,JSON.stringify(portal)]);legacy={name:'Legacy private organization',portal,memberships:(await client.query('SELECT organization_id,user_id,role,active FROM organization_memberships WHERE organization_id=$1 ORDER BY user_id',[legacyId])).rows,shares:(await client.query('SELECT organization_id,request_id,permission,shared_by,revoked_at FROM request_shares WHERE organization_id=$1',[legacyId])).rows};}});
});
