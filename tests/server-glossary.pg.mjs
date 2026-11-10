import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {readdir,readFile} from 'node:fs/promises';
import {query,closeDb} from '../src/server/db.ts';
import {HttpError} from '../src/server/types.ts';
import {createSourceGlossaryDrafts,glossaryImportProvenance} from '../src/data/glossary-import.ts';
import {validateGlossaryRecord,glossaryForPublication} from '../src/server/workspace-glossary.ts';
import {getWorkspace,getPublicSite,saveWorkspace,installSourceGlossaryDrafts,reviewWorkspaceContent,publishWorkspace,unpublishWorkspace,getWorkspaceRevisions,restoreWorkspaceRevision} from '../src/server/workspace.ts';
import {glossaryFromPublications,createGlossaryMatcher,splitGlossaryText} from '../src/lib/glossary.ts';

const database=process.env.TEST_ADMIN_DATABASE_URL||process.env.MIGRATION_DATABASE_URL||process.env.TEST_DATABASE_URL;
const languages=['fa','en','tr','ar','ru'];
const actor=(id,role='admin',allowedLocales=languages)=>({id,name:id,email:id+'@example.invalid',role,mfaVerified:true,qualityScope:true,allowedLocales});
const author=actor('glossary-author'),reviewer=actor('glossary-reviewer'),translator=actor('glossary-translator','translator',['en']);
const error=(status,code)=>value=>value instanceof HttpError&&value.status===status&&(!code||value.code===code);
const sourceId='GLOSSARY-PMMA';
async function mutate(id,change,by=author,locale='en'){const current=await getWorkspace(by),state=structuredClone(current.state),index=state.records.findIndex(row=>row.id===id);assert.ok(index>=0);state.records[index]=change(state.records[index]);return saveWorkspace(by,{state,locale,expectedVersion:current.version});}
async function review(id=sourceId,locale='en'){const current=await getWorkspace(reviewer);return reviewWorkspaceContent(reviewer,{bucket:'records',id,locale,expectedVersion:current.version});}
async function publish(id=sourceId,locale='en',extra={}){const current=await getWorkspace(author);return publishWorkspace(author,{publication:{id,kind:'glossary',locale,...extra},expectedVersion:current.version});}
async function live(id=sourceId,locale='en'){return(await getPublicSite()).publications.find(row=>row.id===id&&row.locale===locale);}

test('Imported glossary definitions remain verbatim sourced drafts and aliases use strict bounded literal matching',async()=>{
  const rows=createSourceGlossaryDrafts('2026-10-19T00:00:00Z');assert.equal(rows.length,12);assert.equal(new Set(rows.map(row=>row.id)).size,12);assert.ok(rows.every(row=>row.status==='draft'&&!row.approvedById&&row.publishedLocales.length===0&&row.details.glossaryImport.approvalStatus==='unreviewed'));
  const source=await readFile(new URL('../src/data/glossary-import.ts',import.meta.url),'utf8'),array='const terms='+source.slice(source.indexOf('const importedTerms=')+'const importedTerms='.length,source.indexOf('] as const;')+'] as const;'.length);
  assert.equal(glossaryImportProvenance.count,12);assert.match(glossaryImportProvenance.sourceSha256,/^[a-f0-9]{64}$/);assert.equal(createHash('sha256').update(array).digest('hex'),glossaryImportProvenance.arraySha256);
  const record=rows[0];validateGlossaryRecord(record);assert.deepEqual(glossaryForPublication(record,'en'),{schemaVersion:1,aliases:[]});
  for(const aliases of[{xx:['term']},{en:['a']},{en:['term','TERM']},{en:[' padded ']},{en:Array.from({length:13},(_,i)=>'term'+i)}])assert.throws(()=>validateGlossaryRecord({...record,details:{glossary:{schemaVersion:1,aliases}}}),error(422,'GLOSSARY_SCHEMA'));
  assert.throws(()=>validateGlossaryRecord({...record,collection:'leads'}),error(422,'GLOSSARY_SCHEMA'));
  assert.throws(()=>glossaryForPublication({...record,summary:{...record.summary,en:''}},'en'),error(422,'GLOSSARY_CONTENT'));
  const terms=glossaryFromPublications([{id:'literal',kind:'glossary',slug:'literal',locale:'en',title:'Literal',summary:'Reviewed example',publishedAt:'2026-10-19T00:00:00Z',version:1,glossary:{schemaVersion:1,aliases:['a.*b']}}],'en');
  const matched=splitGlossaryText('Use a.*b exactly, not axxb.',createGlossaryMatcher(terms,'en'));assert.equal(matched.filter(row=>row.type==='term').length,1);assert.equal(matched.find(row=>row.type==='term').text,'a.*b');
});

test('PostgreSQL sourced glossary drafts, current locale grants, immutable review/release and rollback',{timeout:180000},async t=>{
  assert.ok(database,'The glossary integration gate requires PostgreSQL.');const schema='glossary_'+randomUUID().replaceAll('-',''),control=new pg.Client({connectionString:database});await control.connect();await control.query('CREATE SCHEMA '+schema);
  const scoped=new URL(database);scoped.searchParams.set('options','-c search_path='+schema);const keys=['DATABASE_URL','NODE_ENV','DEMO_MODE','PRIVACY_LEDGER_DIR'],old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));Object.assign(process.env,{DATABASE_URL:scoped.toString(),NODE_ENV:'test'});delete process.env.DEMO_MODE;delete process.env.PRIVACY_LEDGER_DIR;await closeDb();
  try{
    const migrate=new pg.Client({connectionString:scoped.toString()});await migrate.connect();try{for(const file of(await readdir(new URL('../db/migrations/',import.meta.url))).filter(file=>file.endsWith('.sql')).sort())await migrate.query(await readFile(new URL('../db/migrations/'+file,import.meta.url),'utf8'));}finally{await migrate.end();}
    for(const by of[author,reviewer,translator])await query("INSERT INTO users(id,name,email,password_hash,role,active,mfa_enabled,quality_scope,allowed_locales) VALUES($1,$2,$3,'isolated non-login fixture',$4,true,true,true,$5::jsonb)",[by.id,by.name,by.email,by.role,JSON.stringify(by.allowedLocales)]);
    await t.test('First production initialization imports twelve disclosed drafts and publishes none',async()=>{
      const current=await getWorkspace(author),terms=current.state.records.filter(row=>row.details?.glossaryImport);assert.equal(terms.length,12);assert.ok(terms.every(row=>row.status==='draft'&&row.authorId==='system-source-import'));assert.deepEqual(glossaryFromPublications((await getPublicSite()).publications,'en'),[]);assert.deepEqual(await installSourceGlossaryDrafts(),{inserted:0});
    });
    await t.test('Idempotent upgrade intake never overwrites an edited term or resurrects a retained deletion',async()=>{
      await mutate(sourceId,row=>({...row,summary:{...row.summary,en:'Edited factual wording awaits independent review.'}}));const deletedId='GLOSSARY-MOULD';const before=await getWorkspace(author);await saveWorkspace(author,{state:{...before.state,records:before.state.records.filter(row=>row.id!==deletedId)},expectedVersion:before.version});
      const missingId='GLOSSARY-SDS';await query("DELETE FROM workspace_entities WHERE bucket='records' AND id=$1",[missingId]);assert.deepEqual(await installSourceGlossaryDrafts(),{inserted:1});assert.deepEqual(await installSourceGlossaryDrafts(),{inserted:0});
      const next=await getWorkspace(author);assert.equal(next.state.records.find(row=>row.id===sourceId).summary.en,'Edited factual wording awaits independent review.');assert.equal(next.state.records.some(row=>row.id===deletedId),false);assert.equal(next.state.records.find(row=>row.id===missingId).status,'draft');
    });
    await t.test('The real translator can edit only its target-locale aliases and cannot change foreign terms or source provenance',async()=>{
      await mutate(sourceId,row=>({...row,details:{...row.details,glossary:{schemaVersion:1,aliases:{en:['Polymethyl methacrylate'],fa:['پلیمر نمونه']}}}}));
      await mutate(sourceId,row=>({...row,details:{...row.details,glossary:{...row.details.glossary,aliases:{...row.details.glossary.aliases,en:['PMMA term']}}}}),translator);
      await assert.rejects(mutate(sourceId,row=>({...row,details:{...row.details,glossary:{...row.details.glossary,aliases:{...row.details.glossary.aliases,fa:['جایگزین نامجاز']}}}}),translator),error(403));
      await assert.rejects(mutate(sourceId,row=>({...row,details:{...row.details,glossaryImport:{...row.details.glossaryImport,approvalStatus:'approved'}}}),translator),error(403));
      await query("UPDATE users SET allowed_locales='[\"fa\"]'::jsonb WHERE id=$1",[translator.id]);await assert.rejects(mutate(sourceId,row=>({...row,summary:{...row.summary,en:'Revoked grant cannot write.'}}),translator),error(403));await query("UPDATE users SET allowed_locales='[\"en\"]'::jsonb WHERE id=$1",[translator.id]);
    });
    await t.test('Only an independently reviewed exact locale revision becomes public; private provenance and other aliases are absent',async()=>{
      const submitted=await mutate(sourceId,row=>({...row,status:'review'}));await assert.rejects(reviewWorkspaceContent(author,{bucket:'records',id:sourceId,locale:'en',expectedVersion:submitted.version}),error(403));await review();
      await assert.rejects(publish(sourceId,'en',{glossary:{schemaVersion:1,aliases:['Forged preview']}}),error(409,'revision_conflict'));await publish();const released=await live();assert.deepEqual(released.glossary,{schemaVersion:1,aliases:['PMMA term']});assert.equal(released.summary,'Edited factual wording awaits independent review.');assert.equal(JSON.stringify(released).includes('glossaryImport'),false);assert.equal(JSON.stringify(released).includes('پلیمر نمونه'),false);assert.equal(await live(sourceId,'fa'),undefined);
      const immutable=(await getWorkspaceRevisions(author,{bucket:'records',id:sourceId,locale:'en'})).revisions[0];await assert.rejects(query("UPDATE content_revisions SET checksum=$2 WHERE id=$1",[immutable.id,'0'.repeat(64)]));
    });
    await t.test('An alias draft edit keeps the old live definition but invalidates approval for another publication',async()=>{
      const before=await live();await mutate(sourceId,row=>({...row,status:'draft',approvedBy:undefined,approvedById:undefined,details:{...row.details,glossary:{...row.details.glossary,aliases:{...row.details.glossary.aliases,en:['Revised PMMA term']}}}}));assert.deepEqual((await live()).glossary,before.glossary);await assert.rejects(publish(),error(409));await mutate(sourceId,row=>({...row,status:'review'}));await review();await publish();assert.deepEqual((await live()).glossary,{schemaVersion:1,aliases:['Revised PMMA term']});
    });
    await t.test('Withdrawal is isolated to its locale; restoring immutable history stays a draft until reviewed again',async()=>{
      await review(sourceId,'fa');await publish(sourceId,'fa');const before=await getWorkspace(author);await unpublishWorkspace(author,{slug:(await live()).slug,kind:'glossary',locale:'en',expectedVersion:before.version});assert.equal(await live(),undefined);assert.ok(await live(sourceId,'fa'));
      const history=await getWorkspaceRevisions(author,{bucket:'records',id:sourceId,locale:'en'}),oldest=history.revisions.at(-1);const selectedWorkspace=await getWorkspace(author),selectedSource=selectedWorkspace.state.records.find(row=>row.id===sourceId);assert.ok(selectedSource?.updatedAt);const expectedUpdatedAt=selectedSource.updatedAt;await restoreWorkspaceRevision(author,{revisionId:oldest.id,expectedVersion:selectedWorkspace.version,expectedUpdatedAt});assert.equal(await live(),undefined);assert.ok(await live(sourceId,'fa'));const restored=await getWorkspace(author);assert.equal(restored.state.records.find(row=>row.id===sourceId).status,'draft');await assert.rejects(publish(),error(409));
    });
  }finally{await closeDb();for(const key of keys)if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];await control.query('DROP SCHEMA '+schema+' CASCADE');await control.end();}
});
