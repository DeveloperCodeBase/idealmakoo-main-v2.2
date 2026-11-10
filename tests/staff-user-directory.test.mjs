import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url);
const {ApiError}=await loadTs('src/lib/api.ts');
const {roles}=await loadTs('src/lib/auth.ts');
const language=await loadTs('src/lib/i18n.ts');
const words=await loadTs('src/components/workspace/i18n.ts');
const {USER_PROFILE_LIMITS}=await loadTs('src/lib/user-settings.ts');
const {personalSettingsText}=await loadTs('src/components/account/personal-settings-copy.ts');
const sources=Object.fromEntries(['StaffManagement','StaffLifecycle'].map(name=>[name,ts.createSourceFile(name+'.tsx',readFileSync(new URL('../src/components/workspace/'+name+'.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)]));
const plain=value=>JSON.parse(JSON.stringify(value));
const noop=()=>{};

// Execute the component's own callback, as in page-lifecycle-ui.test.mjs.
// Only transport, hook storage and observable setters are controlled here.
function implementation(file,name,context){
 const source=sources[file];let expression;
 function visit(node){
  if(ts.isVariableDeclaration(node)&&node.name.getText(source)===name){expression=node.initializer;if(expression&&ts.isCallExpression(expression)&&expression.expression.getText(source)==='useCallback')expression=expression.arguments[0];}
  ts.forEachChild(node,visit);
 }
 visit(source);assert.ok(expression,`Execute the actual ${file}.${name}`);
 return runInNewContext(ts.transpileModule('('+expression.getText(source)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
}
const globals={AbortController,URLSearchParams,ApiError,encodeURIComponent,networkError:error=>error.message,USER_PROFILE_LIMITS,personalSettingsText};
for(const name of ['noPermissions','permissionKeys','profileKeys','blankProfile','directoryCopy','freshMfaRecovery','mfaRecoveryCopy'])globals[name]=implementation('StaffManagement',name,{...globals,...words});
const user=(id,patch={})=>({id,name:'User '+id,email:id+'@example.test',role:'support',active:true,allowedLocales:['en'],qualityScope:false,mfaEnabled:true,emailVerified:true,crmScope:'assigned',crmPermissions:{},createdAt:'2026-10-20T00:00:00.000Z',updatedAt:'2026-10-20T00:00:00.000Z',...patch});
const response=(items,patch={})=>({items,nextCursor:null,provisioningMode:'env',canCreate:false,canManageGrants:false,...patch});
const planFor=(person,patch={})=>({user:person,workspaceVersion:4,planHash:'current-plan',items:[],recipients:[],blockedCount:0,canOffboard:true,...patch});
function transport(){const requests=[];return{requests,apiClient:{request:(path,options={})=>new Promise((resolve,reject)=>requests.push({path,options,signal:options.signal,resolve,reject}))}};}
function directoryHarness(file='StaffManagement',extra={}){
 const io=transport(),pages=[],staff=file==='StaffLifecycle',emptyName=staff?'emptyStaff':'emptyDirectory';
 const c={...globals,...io,mounted:{current:true},keyRef:{current:''},staffKeyRef:{current:''},requestRef:{current:null},staffRequest:{current:null},pageRef:{current:null},staffPageRef:{current:null},targetRef:{current:''},pinnedRef:{current:null},eligible:row=>row.active&&row.role!=='customer',clearTarget:noop,setPinned:noop,setError:noop,setInitialDirectoryReady:noop,copy:{targetUnavailable:{en:'Unavailable'}},...extra};
 c[emptyName]=implementation(file,emptyName,c);
 c.setPage=c.setStaffPage=value=>pages.push(plain(value));
 c.remember=staff?undefined:implementation(file,'remember',c);
 c.rememberStaff=staff?implementation(file,'rememberStaff',c):undefined;
 function loadFor({search='',roleFilter='',identity='actor:admin:en',locale='en'}={}){
  const key=JSON.stringify([identity,search,roleFilter]);c.keyRef.current=key;c.staffKeyRef.current=key;
  if(!c.pageRef.current)c.pageRef.current=c.emptyDirectory?.(key);
  if(!c.staffPageRef.current)c.staffPageRef.current=c.emptyStaff?.(key);
  return implementation(file,staff?'loadStaff':'load',{...c,key,staffKey:key,search,roleFilter,locale});
 }
 return{c,pages,requests:io.requests,loadFor};
}

test('management sends literal search and exact role to the server; pagination deduplicates and rejects a double click',async()=>{
 const x=directoryHarness(),load=x.loadFor({search:'old %_\\ person',roleFilter:'customer'}),first=load();
 let url=new URL(x.requests[0].path,'https://example.test');assert.equal(url.searchParams.get('kind'),'all');assert.equal(url.searchParams.get('limit'),'50');assert.equal(url.searchParams.get('q'),'old %_\\ person');assert.equal(url.searchParams.get('role'),'customer');assert.equal(url.searchParams.has('cursor'),false);
 x.requests[0].resolve(response([user('one'),user('two')],{nextCursor:'cursor-one',canCreate:true,canManageGrants:true,provisioningMode:'panel'}));await first;
 const next=load(true);await load(true);assert.equal(x.requests.length,2,'One in-flight continuation owns the cursor.');url=new URL(x.requests[1].path,'https://example.test');assert.equal(url.searchParams.get('cursor'),'cursor-one');
 x.requests[1].resolve(response([user('two',{name:'Updated duplicate'}),user('three')],{nextCursor:'cursor-two'}));await next;
 assert.deepEqual(x.pages.at(-1).items.map(row=>row.id),['one','two','three']);assert.equal(x.pages.at(-1).items[1].name,'Updated duplicate');assert.equal(x.pages.at(-1).canManageGrants,false);
 const refresh=load(false,true);assert.equal(new URL(x.requests[2].path,'https://example.test').searchParams.has('cursor'),false);x.requests[2].resolve(response([user('fresh')]));await refresh;assert.deepEqual(x.pages.at(-1).items.map(row=>row.id),['fresh']);
});

test('a changed query, exact role, actor, role or locale cannot adopt an older directory response or policy',async()=>{
 for(const change of [{search:'new query'},{roleFilter:'customer'},{identity:'other:admin:en'},{identity:'actor:superAdmin:en'},{identity:'actor:admin:fa',locale:'fa'}]){
  const x=directoryHarness(),oldLoad=x.loadFor(),old=oldLoad(),nextLoad=x.loadFor(change),next=nextLoad();assert.equal(x.requests[0].signal.aborted,true);
  x.requests[1].resolve(response([user('current')]));await next;x.requests[0].resolve(response([user('stale')],{canCreate:true,canManageGrants:true,provisioningMode:'panel',nextCursor:'stale-cursor'}));await old;
  assert.deepEqual(x.pages.at(-1).items.map(row=>row.id),['current']);assert.equal(x.pages.at(-1).canCreate,false);assert.equal(x.pages.at(-1).canManageGrants,false);assert.equal(x.pages.at(-1).nextCursor,null);
 }
});

test('late errors and late reads after unmount cannot replace the current directory',async()=>{
 const x=directoryHarness(),old=x.loadFor()(),current=x.loadFor({search:'current'})();x.requests[1].resolve(response([user('current')]));await current;x.requests[0].reject(new Error('Stale transport failure'));await old;assert.equal(x.pages.at(-1).error,'');
 const pending=x.loadFor({search:'later'})(),before=x.pages.length;x.c.mounted.current=false;x.requests[2].resolve(response([user('unmounted')]));await pending;assert.equal(x.pages.length,before);
});

test('initial directory readiness waits for a current successful response and never resets for search or retry',async()=>{
 const readiness=[],x=directoryHarness('StaffManagement',{setInitialDirectoryReady:value=>readiness.push(value)});
 const first=x.loadFor()();assert.deepEqual(readiness,[]);
 x.requests[0].reject(new Error('Initial transport failure'));await first;assert.deepEqual(readiness,[]);
 const retry=x.loadFor()();x.requests[1].resolve(response([user('current')]));await retry;assert.deepEqual(readiness,[true]);
 const filtered=x.loadFor({search:'next',roleFilter:'customer'})();assert.deepEqual(readiness,[true]);
 x.requests[2].reject(new Error('Search transport failure'));await filtered;assert.deepEqual(readiness,[true]);
 const refreshed=x.loadFor({search:'next',roleFilter:'customer'})(false,true);
 x.requests[3].resolve(response([]));await refreshed;assert.deepEqual(readiness,[true,true]);
});

function managementMutation(patch={}){
 const io=transport(),events=[],selected={...user('target'),profile:globals.blankProfile(),profileRevision:7},c={...globals,...words,...io,mounted:{current:true},identity:'actor:admin:en',identityRef:{current:'actor:admin:en'},mutationRef:{current:null},selected,draft:{...selected,name:'Edited target',password:'',confirmPassword:'',profile:{...selected.profile}},policy:{canCreate:false,canManageGrants:false},canEdit:true,canChangeEmail:false,canChangeActive:true,canManageGrants:false,canResetPassword:false,senior:false,locale:'en',fresh:()=>({}),wt:key=>key,reload:{current:async()=>events.push('old reload')},store:{notify:value=>events.push(['notify',value])},setBusy:value=>events.push(['busy',value]),setError:value=>events.push(['error',value]),setDraft:value=>{c.draft=typeof value==='function'?value(c.draft):value;events.push(['draft',plain(c.draft)]);},setSelected:value=>{c.selected=typeof value==='function'?value(c.selected):value;events.push(['selected',plain(c.selected)]);},setOpen:value=>events.push(['open',value]),permitted:()=>true,workspaceLocales:['fa','en','tr','ar','ru'],...patch};
 Object.assign(c,{canResetMfa:false,mfaRecoveryOpen:false,mfaRecovery:globals.freshMfaRecovery(),focusAfterMfa:{current:false},modalOpener:{current:null},pageRef:{current:{items:[selected]}},
  setMfaRecovery:value=>{c.mfaRecovery=typeof value==='function'?value(c.mfaRecovery):value;events.push(['mfaDraft',plain(c.mfaRecovery)]);},
  setMfaRecoveryOpen:value=>{c.mfaRecoveryOpen=value;events.push(['mfaOpen',value]);},
  remember:value=>{c.pageRef.current=value;events.push(['directory',plain(value)]);},...patch});
 c.clearMfaRecovery=implementation('StaffManagement','clearMfaRecovery',c);
 return{c,events,requests:io.requests,save:implementation('StaffManagement','save',c),savePassword:implementation('StaffManagement','savePassword',c),start:implementation('StaffManagement','start',c),recoverMfa:implementation('StaffManagement','recoverMfa',c)};
}
function recoveryMutation(patch={}){
 const selected={...user('target'),profile:globals.blankProfile(),profileRevision:7,capabilities:{canEdit:true,canResetMfa:true}};
 return managementMutation({canResetMfa:true,mfaRecoveryOpen:true,selected,pageRef:{current:{items:[selected]}},
  draft:{...selected,profile:{...selected.profile,city:'Unsaved city'},password:'Unsubmitted-password-123',confirmPassword:'Unsubmitted-password-123'},
  mfaRecovery:{actorPassword:'Current-proof-example-123',actorCode:'123456',password:'New-proof-example-456',confirmPassword:'New-proof-example-456',confirmed:true},...patch});
}
test('MFA recovery submits only fresh proofs and both versions, prevents duplicate sends and advances the current editor',async()=>{
 const x=recoveryMutation(),pending=x.recoverMfa({preventDefault:noop});await x.recoverMfa({preventDefault:noop});assert.equal(x.requests.length,1);
 assert.equal(x.requests[0].path,'/users/target/mfa-reset');assert.equal(x.requests[0].options.method,'POST');
 assert.deepEqual(JSON.parse(x.requests[0].options.body),{actorPassword:'Current-proof-example-123',actorCode:'123456',password:'New-proof-example-456',expectedUpdatedAt:x.c.selected.updatedAt,profileRevision:7});
 x.requests[0].resolve({ok:true,userId:'target',sessionsRevoked:true,mfaEnrollmentRequired:true,updatedAt:'2026-10-22T10:00:00.000Z',profileRevision:8});await pending;
 assert.equal(x.c.selected.profileRevision,8);assert.equal(x.c.selected.updatedAt,'2026-10-22T10:00:00.000Z');assert.equal(x.c.selected.mfaEnabled,false);assert.equal(x.c.selected.capabilities.canResetMfa,false);
 assert.equal(x.c.pageRef.current.items[0].mfaEnabled,false);assert.equal(x.c.draft.profile.city,'Unsaved city');assert.equal(x.c.draft.password,'');assert.equal(x.c.draft.confirmPassword,'');
 assert.deepEqual(plain(x.c.mfaRecovery),plain(globals.freshMfaRecovery()));assert.equal(x.c.mfaRecoveryOpen,false);assert.equal(x.c.focusAfterMfa.current,true);assert.equal(x.c.mutationRef.current,null);
});
test('Rejected MFA recovery clears the used code without advancing versions and stale completion cannot affect another identity',async()=>{
 const x=recoveryMutation(),before=plain(x.c.selected),pending=x.recoverMfa({preventDefault:noop});x.requests[0].reject(new ApiError({status:422,code:'MFA_INVALID',title:'Fresh proof rejected'}));await pending;
 assert.deepEqual(plain(x.c.selected),before);assert.equal(x.c.mfaRecovery.actorCode,'');assert.equal(x.c.mfaRecovery.password,'New-proof-example-456');assert.equal(x.c.mfaRecoveryOpen,true);assert.equal(x.c.mutationRef.current,null);
 for(const change of ['identity','unmount']){
  const stale=recoveryMutation(),waiting=stale.recoverMfa({preventDefault:noop}),events=stale.events.length;
  if(change==='identity')stale.c.identityRef.current='another:superAdmin:fa';else stale.c.mounted.current=false;
  stale.requests[0].resolve({ok:true,updatedAt:'2026-10-22T10:00:00.000Z',profileRevision:8});await waiting;assert.equal(stale.events.length,events);assert.equal(stale.c.selected.profileRevision,7);
 }
});
test('MFA recovery requires capability, complete fresh proofs, a valid new-password pair and explicit confirmation before transport',async()=>{
 for(const change of [{canResetMfa:false},{selected:null},{actorPassword:''},{actorPassword:'x'.repeat(129)},{actorCode:'recovery-code'},{password:'short'},{confirmPassword:'not-the-same'},{confirmed:false}]){
  const x=recoveryMutation();if('canResetMfa'in change||'selected'in change)Object.assign(x.c,change);else Object.assign(x.c.mfaRecovery,change);
  await x.recoverMfa({preventDefault:noop});assert.equal(x.requests.length,0);
 }
 const x=recoveryMutation();x.c.clearMfaRecovery();assert.deepEqual(plain(x.c.mfaRecovery),plain(globals.freshMfaRecovery()));assert.equal(x.c.mfaRecoveryOpen,false);
});
test('a successful edit refreshes the currently selected filter, with its cursor reset',async()=>{
 const x=managementMutation(),saved=x.save({preventDefault:noop});await x.save({preventDefault:noop});assert.equal(x.requests.length,1);
 x.c.reload.current=async(...args)=>x.events.push(['current reload',...args]);x.requests[0].resolve({});await saved;
 assert.equal(x.requests[0].options.method,'PATCH');assert.deepEqual(JSON.parse(x.requests[0].options.body),{name:'Edited target',expectedUpdatedAt:x.c.selected.updatedAt});assert.ok(x.requests[0].signal);
 assert.ok(x.events.some(value=>Array.isArray(value)&&value[0]==='current reload'&&value[1]===false&&value[2]===true));assert.ok(!x.events.includes('old reload'));assert.deepEqual(x.events.at(-1),['busy',false]);
});
test('late mutation completion cannot refresh, close or notify a different actor, role or locale',async()=>{
 for(const identity of ['other:admin:en','actor:superAdmin:en','actor:admin:fa']){
  const x=managementMutation(),saved=x.save({preventDefault:noop}),before=x.events.length;x.c.identityRef.current=identity;x.requests[0].resolve({});await saved;assert.equal(x.events.length,before);
 }
 const denied=managementMutation({selected:null,policy:{canCreate:false,canManageGrants:false}});await denied.save({preventDefault:noop});assert.equal(denied.requests.length,0);
 const limited=managementMutation();limited.c.draft.role='superAdmin';limited.c.draft.qualityScope=true;const saved=limited.save({preventDefault:noop});assert.deepEqual(JSON.parse(limited.requests[0].options.body),{name:'Edited target',expectedUpdatedAt:limited.c.selected.updatedAt});limited.requests[0].resolve({});await saved;
});

test('opening an editor obtains one current authorized profile and ignores a response after account authority changes',async()=>{
 for(const stale of [false,true]){
  const x=managementMutation(),trigger={tagName:'BUTTON',disabled:false,isConnected:true,focus:noop},detail={...x.c.selected,profile:{...x.c.selected.profile,phone:'+982100000000'},capabilities:{canEdit:true,canResetPassword:true}},reading=x.start(x.c.selected,trigger);
  assert.equal(x.c.modalOpener.current,trigger,'Retain the actual opener before awaiting the profile.');assert.equal(x.requests.length,1);
  assert.equal(x.requests[0].path,'/users/target');assert.equal(x.requests[0].options.method,undefined);assert.equal(x.events.some(event=>event[0]==='open'),false);
  const before=x.events.length;if(stale)x.c.identityRef.current='new:customer:en';x.requests[0].resolve(detail);await reading;
  if(stale)assert.equal(x.events.length,before);else{assert.equal(x.c.draft.profile.phone,detail.profile.phone);assert.equal(x.c.draft.password,'');assert.equal(x.c.draft.confirmPassword,'');assert.ok(x.events.some(event=>event[0]==='open'&&event[1]===true));}
 }
});

test('profile edits use both current revisions and send only changed fields without password material',async()=>{
 const x=managementMutation({canChangeEmail:true,canManageGrants:true});x.c.draft.email='new-login@example.test';x.c.draft.profile.phone='+982100000001';x.c.draft.password='Never-place-in-profile-A9';x.c.draft.confirmPassword=x.c.draft.password;x.c.draft.crmScope='team';x.c.draft.crmPermissions={...globals.noPermissions(),contact:true};
 const pending=x.save({preventDefault:noop}),payload=JSON.parse(x.requests[0].options.body);
 assert.deepEqual(payload,{name:'Edited target',email:'new-login@example.test',profile:{phone:'+982100000001'},profileRevision:7,crmScope:'team',crmPermissions:{...globals.noPermissions(),contact:true},expectedUpdatedAt:x.c.selected.updatedAt});
 x.requests[0].resolve({});await pending;
});

test('password reset uses its own confirmed write-only endpoint, ends no own UI session and clears typed secrets on success',async()=>{
 const x=managementMutation({canResetPassword:true});x.c.draft.password='New-managed-password-2468';x.c.draft.confirmPassword=x.c.draft.password;
 const pending=x.savePassword({preventDefault:noop});await x.savePassword({preventDefault:noop});assert.equal(x.requests.length,1);assert.equal(x.requests[0].path,'/users/target/password');assert.equal(x.requests[0].options.method,'POST');assert.deepEqual(JSON.parse(x.requests[0].options.body),{password:'New-managed-password-2468',expectedUpdatedAt:x.c.selected.updatedAt});
 const updatedAt='2026-10-21T20:15:00.000Z';x.requests[0].resolve({ok:true,updatedAt});await pending;assert.equal(x.c.draft.password,'');assert.equal(x.c.draft.confirmPassword,'');assert.equal(x.c.selected.updatedAt,updatedAt);assert.equal(x.c.draft.name,'Edited target');assert.equal(x.c.selected.profileRevision,7);assert.equal(x.events.includes('old reload'),false);assert.ok(x.events.some(event=>event[0]==='notify'&&event[1].includes('Password changed')));
 const saved=x.save({preventDefault:noop});assert.deepEqual(JSON.parse(x.requests[1].options.body),{name:'Edited target',expectedUpdatedAt:updatedAt});x.requests[1].resolve({});await saved;
});

test('a concurrent account edit rejects password reset without blessing the stale editor snapshot or losing its draft',async()=>{
 const x=managementMutation({canResetPassword:true});Object.assign(x.c.draft,{password:'Unsaved-managed-password-2468',confirmPassword:'Unsaved-managed-password-2468'});
 const selected=plain(x.c.selected),draft=plain(x.c.draft),pending=x.savePassword({preventDefault:noop});
 assert.equal(JSON.parse(x.requests[0].options.body).expectedUpdatedAt,selected.updatedAt);
 x.requests[0].reject(new ApiError({status:409,code:'USER_CONFLICT',title:'Another administrator changed this account'}));await pending;
 assert.deepEqual(plain(x.c.selected),selected);assert.deepEqual(plain(x.c.draft),draft);assert.equal(x.events.some(event=>event[0]==='selected'||event[0]==='draft'||event[0]==='notify'),false);
 assert.ok(x.events.some(event=>event[0]==='error'&&event[1].includes('Another administrator')));assert.deepEqual(x.events.at(-1),['busy',false]);
 const saved=x.save({preventDefault:noop});assert.deepEqual(JSON.parse(x.requests[1].options.body),{name:'Edited target',expectedUpdatedAt:selected.updatedAt},'a later field save must still carry the stale version so the server can reject it');
 x.requests[1].reject(new ApiError({status:409,code:'USER_CONFLICT',title:'Reload the current account before saving'}));await saved;
 assert.deepEqual(plain(x.c.draft),draft);assert.deepEqual(plain(x.c.selected),selected);
});

test('password reset cannot submit without target authority, matching confirmation or sufficient length; stale completion is ignored',async()=>{
 for(const change of [{canResetPassword:false},{password:'short',confirmPassword:'short'},{password:'Long-enough-secret-987',confirmPassword:'different-value'}]){
  const x=managementMutation({canResetPassword:true,...'canResetPassword'in change?{canResetPassword:change.canResetPassword}:{}});Object.assign(x.c.draft,{password:'Allowed-only-with-permission-234',confirmPassword:'Allowed-only-with-permission-234'},change);await x.savePassword({preventDefault:noop});assert.equal(x.requests.length,0);
 }
 const x=managementMutation({canResetPassword:true});Object.assign(x.c.draft,{password:'Long-enough-password-248',confirmPassword:'Long-enough-password-248'});const pending=x.savePassword({preventDefault:noop}),before=x.events.length;x.c.identityRef.current='other:admin:fa';x.requests[0].resolve({});await pending;assert.equal(x.events.length,before);
});

test('self email reauthentication navigates directly to sign-in without issuing a now unauthorized directory reload',async()=>{
 const navigations=[],x=managementMutation({canChangeEmail:true,app:{href:route=>'/en/'+route+'/'},window:{location:{assign:path=>navigations.push(path)}}});x.c.draft.email='self-new@example.test';const pending=x.save({preventDefault:noop});x.requests[0].resolve({requiresReauthentication:true});await pending;assert.deepEqual(navigations,['/en/auth/login/']);assert.equal(x.events.includes('old reload'),false);assert.deepEqual(x.c.draft,{});
});

function lifecycleHarness(patch={}){
 const io=transport(),events=[],actions=[],states={target:'target',pinned:user('target'),plan:null,assignments:{},reason:'Valid offboarding reason',stale:false};
 const c={...globals,...io,identity:'actor:admin:en',identityRef:{current:'actor:admin:en'},mounted:{current:true},locale:'en',session:{id:'actor',role:'admin'},targetRef:{current:'target'},pinnedRef:{current:states.pinned},actionRequest:{current:null},baseRequest:{current:null},staff:[user('target'),user('second')],pinned:states.pinned,plan:planFor(user('target')),ready:true,assignments:{},reason:states.reason,draft:{email:'invited@example.test'},initial:()=>({}),tr:key=>key,app:{notify:value=>events.push(['notify',value])},reloadBase:{current:async()=>events.push('base reload')},reloadStaff:{current:async(...args)=>events.push(['staff reload',...args])},onChanged:async()=>events.push('changed'),window:{dispatchEvent:event=>events.push(['event',event.type])},Event,...patch};
 for(const key of ['Target','Pinned','Plan','Assignments','Reason','Stale','Error','Busy','Draft','Items','CanInvite','ProvisioningMode','Directory','Loaded']){const name=key[0].toLowerCase()+key.slice(1);c['set'+key]=value=>{states[name]=typeof value==='function'?value(states[name]):value;events.push([name,plain(states[name])]);};}
 c.eligible=implementation('StaffLifecycle','eligible',c);c.cancelTargetRequest=implementation('StaffLifecycle','cancelTargetRequest',c);c.clearTarget=implementation('StaffLifecycle','clearTarget',c);
 const run=implementation('StaffLifecycle','run',c);c.run=(...args)=>{const pending=run(...args);actions.push(pending);return pending;};
 return{c,events,states,actions,requests:io.requests,preview:implementation('StaffLifecycle','preview',c),finish:implementation('StaffLifecycle','finish',c),invite:implementation('StaffLifecycle','invite',c),chooseTarget:implementation('StaffLifecycle','chooseTarget',c),load:implementation('StaffLifecycle','load',c)};
}

test('staff reads use their own active staff query, preserve an absent pin, and continue through nonselectable rows',async()=>{
 const selected=user('selected'),pinned=[],x=directoryHarness('StaffLifecycle',{targetRef:{current:selected.id},pinnedRef:{current:selected},setPinned:value=>pinned.push(value)}),load=x.loadFor({search:'other people'}),first=load();
 const url=new URL(x.requests[0].path,'https://example.test');assert.equal(url.searchParams.get('kind'),'staff');assert.equal(url.searchParams.get('active'),'true');assert.equal(url.searchParams.get('q'),'other people');assert.equal(url.searchParams.get('limit'),'50');
 x.requests[0].resolve(response([user('actor',{role:'admin'}),user('senior',{role:'superAdmin'})],{nextCursor:'more-staff'}));await first;assert.equal(pinned.length,0);assert.equal(x.c.targetRef.current,'selected');
 const next=load(true);assert.equal(new URL(x.requests[1].path,'https://example.test').searchParams.get('cursor'),'more-staff');x.requests[1].resolve(response([user('older-staff')]));await next;assert.equal(x.pages.at(-1).items.at(-1).id,'older-staff');
 const filtered=x.loadFor({search:'new filter'})();assert.equal(new URL(x.requests[2].path,'https://example.test').searchParams.has('cursor'),false);x.requests[2].resolve(response([]));await filtered;assert.equal(x.c.targetRef.current,'selected');
});

test('a target selection updates ownership synchronously and suppresses a late preview',async()=>{
 const x=lifecycleHarness();x.preview();assert.equal(x.requests[0].path,'/staff/target/handover');x.chooseTarget('second');assert.equal(x.c.targetRef.current,'second');assert.equal(x.requests[0].signal.aborted,true);
 x.preview();const owner=x.c.actionRequest.current;x.requests[0].reject(new ApiError({status:404,code:'NOT_FOUND',title:'Old target disappeared'}));await x.actions[0];assert.equal(x.states.plan,null);assert.equal(x.states.target,'second');assert.equal(x.c.actionRequest.current,owner);assert.equal(x.states.busy,true);
 x.requests[1].resolve(planFor(user('second')));await x.actions[1];assert.equal(x.states.plan.user.id,'second');
});

test('a late staff page cannot invalidate the current pin after the search or authority changes',async()=>{
 for(const change of [{search:'new staff query'},{identity:'other:admin:en'},{identity:'actor:superAdmin:en'},{identity:'actor:admin:fa',locale:'fa'}]){
  const target=user('target'),cleared=[],x=directoryHarness('StaffLifecycle',{targetRef:{current:target.id},pinnedRef:{current:target},clearTarget:id=>cleared.push(id)}),old=x.loadFor()(),next=x.loadFor(change)();
  x.requests[1].resolve(response([]));await next;x.requests[0].resolve(response([user('target',{active:false})]));await old;assert.equal(cleared.length,0);assert.equal(x.c.targetRef.current,'target');assert.equal(x.pages.at(-1).items.length,0);
 }
});

test('target preview and offboard responses are ignored after actor, role, locale or target ownership changes',async()=>{
 for(const identity of ['other:admin:en','actor:superAdmin:en','actor:admin:fa'])for(const action of ['preview','finish']){
  const x=lifecycleHarness();x[action](...(action==='finish'?[{preventDefault:noop}]:[]));const before=x.events.length;x.c.identityRef.current=identity;x.requests[0].resolve(action==='preview'?planFor(user('target')):{});await x.actions[0];assert.equal(x.events.length,before);
 }
 const x=lifecycleHarness();x.finish({preventDefault:noop});x.chooseTarget('second');x.requests[0].resolve({});await x.actions[0];assert.equal(x.states.target,'second');assert.equal(x.events.includes('base reload'),false);assert.equal(x.events.some(row=>Array.isArray(row)&&row[0]==='notify'),false);
});

test('only exact preview target evidence invalidates the pin; workload restrictions preserve it',async()=>{
 for(const [status,code] of [[404,'NOT_FOUND'],[403,'ROLE_ESCALATION']]){const x=lifecycleHarness();x.preview();x.requests[0].reject(new ApiError({status,code,title:'Target unavailable'}));await x.actions[0];assert.equal(x.c.targetRef.current,'');assert.equal(x.states.pinned,null);}
 for(const patch of [{active:false},{id:'actor',role:'admin'},{role:'customer'},{role:'admin'}]){const x=lifecycleHarness();if(patch.id){x.c.targetRef.current=patch.id;x.c.pinnedRef.current=user(patch.id,patch);}x.preview();x.requests[0].resolve(planFor(user(x.c.targetRef.current,patch),{canOffboard:false}));await x.actions[0];assert.equal(x.c.targetRef.current,'');}
 for(const patch of [{canOffboard:false},{canOffboard:false,blockedCount:2}]){const x=lifecycleHarness();x.preview();x.requests[0].resolve(planFor(user('target'),patch));await x.actions[0];assert.equal(x.c.targetRef.current,'target');assert.equal(x.states.plan.canOffboard,false);}
 for(const failure of [new Error('Network failure'),new ApiError({status:403,code:'FORBIDDEN',title:'Actor no longer allowed'}),new ApiError({status:409,code:'CONFLICT',title:'Review again'}),new ApiError({status:404,code:'OTHER_RESOURCE',title:'Resource missing'})]){const x=lifecycleHarness();x.preview();x.requests[0].reject(failure);await x.actions[0];assert.equal(x.c.targetRef.current,'target');}
});

test('offboard retains the exact pin on generic 404, 409, changed handover and network failures',async()=>{
 for(const failure of [new Error('Network failure'),new ApiError({status:404,code:'NOT_FOUND',title:'Resource missing'}),new ApiError({status:409,code:'HANDOVER_CHANGED',title:'Workload changed'}),new ApiError({status:409,code:'LAST_ADMIN',title:'Senior administrator needed'}),new ApiError({status:409,code:'CONFLICT',title:'Conflict'})]){
  const x=lifecycleHarness();x.finish({preventDefault:noop});x.requests[0].reject(failure);await x.actions[0];assert.equal(x.c.targetRef.current,'target');assert.equal(x.states.pinned.id,'target');assert.equal(x.events.includes('changed'),false);
 }
 const inactive=lifecycleHarness();inactive.finish({preventDefault:noop});inactive.requests[0].reject(new ApiError({status:409,code:'STAFF_INACTIVE',title:'Already inactive'}));await inactive.actions[0];assert.equal(inactive.c.targetRef.current,'');assert.equal(inactive.states.pinned,null);
});

test('an exact inactive target read cancels its preview but cannot cancel an unrelated invitation',async()=>{
 for(const action of ['preview','invite']){
  const x=lifecycleHarness();if(action==='preview')x.preview();else x.invite({preventDefault:noop});
  const directory=directoryHarness('StaffLifecycle',{targetRef:x.c.targetRef,pinnedRef:x.c.pinnedRef,eligible:x.c.eligible,clearTarget:x.c.clearTarget,setPinned:x.c.setPinned,setError:x.c.setError}),load=directory.loadFor(),reading=load();
  directory.requests[0].resolve(response([user('target',{active:false})]));await reading;assert.equal(x.c.targetRef.current,'');assert.equal(x.requests[0].signal.aborted,action==='preview');
  x.requests[0].resolve(action==='preview'?planFor(user('target')):{});await x.actions[0];assert.equal(x.states.plan,null);
  assert.equal(x.events.some(row=>Array.isArray(row)&&row[0]==='notify'&&row[1]==='queued'),action==='invite');
 }
});

test('invitation and scope loading aborts an outstanding sibling before releasing its owner',async()=>{
 for(const failed of [0,1]){
  const x=lifecycleHarness(),pending=x.load();assert.deepEqual(x.requests.map(row=>row.path),['/staff/invitations','/crm/scopes']);assert.equal(x.requests[0].signal,x.requests[1].signal);
  x.requests[failed].reject(new Error('Base read failed'));await assert.rejects(pending,/Base read failed/);assert.equal(x.requests[1-failed].signal.aborted,true);assert.equal(x.c.baseRequest.current,null);
  const before=x.events.length;x.requests[1-failed].resolve({items:[],canInvite:true,provisioningMode:'panel',access:{}});await Promise.resolve();assert.equal(x.events.length,before);
 }
});

test('late base-load grants cannot replace the current environment policy',async()=>{
 const x=lifecycleHarness(),old=x.load(),current=x.load();assert.equal(x.requests[0].signal.aborted,true);
 x.requests[2].resolve({items:[],canInvite:false,provisioningMode:'env'});x.requests[3].resolve({access:{}});await current;
 x.requests[0].resolve({items:[],canInvite:true,provisioningMode:'panel'});x.requests[1].resolve({access:{}});await old;assert.equal(x.states.canInvite,false);assert.equal(x.states.provisioningMode,'env');
});

test('offboard success refreshes the current staff query and clears only the committed target',async()=>{
 const x=lifecycleHarness();x.finish({preventDefault:noop});x.c.reloadStaff.current=async(...args)=>x.events.push(['current staff query',...args]);x.requests[0].resolve({});await x.actions[0];
 assert.ok(x.events.some(row=>Array.isArray(row)&&row[0]==='current staff query'&&row[1]===false&&row[2]===true));assert.equal(x.events.includes('changed'),true);assert.equal(x.c.targetRef.current,'');assert.equal(x.states.pinned,null);assert.equal(x.states.plan,null);assert.ok(x.events.some(row=>Array.isArray(row)&&row[0]==='notify'&&row[1]==='complete'));
 let afterIdentityChange;const stale=lifecycleHarness({onChanged:async()=>{stale.c.identityRef.current='other:admin:en';afterIdentityChange=stale.events.length;}});stale.finish({preventDefault:noop});stale.requests[0].resolve({});await stale.actions[0];assert.equal(stale.events.length,afterIdentityChange);assert.equal(stale.events.some(row=>Array.isArray(row)&&row[0]==='event'),false);
});

test('confirmed offboarding clears the completed plan even if a following read or workspace callback fails',async()=>{
 for(const failed of ['reload','onChanged']){
  const x=lifecycleHarness(),observations=[];let controller;const observe=()=>observations.push({target:x.c.targetRef.current,plan:x.states.plan,pinned:x.states.pinned,aborted:controller.signal.aborted});
  x.c.reloadBase.current=async()=>{observe();if(failed==='reload')throw new Error('Follow-up read failed');};x.c.onChanged=async()=>{observe();if(failed==='onChanged')throw new Error('Workspace refresh failed');};
  x.finish({preventDefault:noop});controller=x.c.actionRequest.current.controller;x.requests[0].resolve({});await x.actions[0];
  assert.ok(observations.length>0);for(const observed of observations)assert.deepEqual(observed,{target:'',plan:null,pinned:null,aborted:false},'The committed selection is cleared before follow-up work without aborting that work.');
  assert.equal(x.states.error,'refreshAfterComplete');assert.equal(x.states.stale,false);assert.equal(x.states.busy,false);assert.ok(x.events.some(row=>Array.isArray(row)&&row[0]==='notify'&&row[1]==='complete'));
 }
});

test('unmount cleanup aborts every owned read and action controller',()=>{
 for(const file of ['StaffManagement','StaffLifecycle']){
  const source=sources[file];let expression;
  function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='useEffect'&&node.arguments[0]?.getText(source).includes('mounted.current=true'))expression=node.arguments[0];ts.forEachChild(node,visit);}
  visit(source);assert.ok(expression);const controllers=[new AbortController(),new AbortController(),new AbortController()],mounted={current:false};
  const context={mounted,requestRef:{current:{controller:controllers[0]}},mutationRef:{current:controllers[1]},staffRequest:{current:{controller:controllers[0]}},baseRequest:{current:controllers[1]},actionRequest:{current:{controller:controllers[2]}}};
  const effect=runInNewContext(ts.transpileModule('('+expression.getText(source)+')',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context),cleanup=effect();assert.equal(mounted.current,true);cleanup();assert.equal(mounted.current,false);assert.ok(controllers.slice(0,file==='StaffManagement'?2:3).every(controller=>controller.signal.aborted));
 }
});

function component(file,name,context){
 const source=sources[file],fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(fn);
 const declarations=source.statements.filter(ts.isVariableStatement).map(node=>node.getText(source));
 const icons=source.statements.filter(ts.isImportDeclaration).filter(node=>node.moduleSpecifier.text==='lucide-react').flatMap(node=>node.importClause.namedBindings.elements.map(value=>value.name.text));
 const exports={};runInNewContext(ts.transpileModule(declarations.join('\n')+'\nexports.probe='+fn.getText(source).replace(/^export\s+(?:default\s+)?/,''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require,...globals,roles,localeNames:language.localeNames,...Object.fromEntries(icons.map(name=>[name,()=>null])),...context});return exports.probe;
}
function renderBody(file,locale,overrides={}){
 const session={id:'actor',role:overrides.actorRole||'admin',allowedLocales:['fa','en','tr','ar','ru']},store={locale,role:session.role,notify:noop},app={locale,session,t:key=>key,href:route=>'/'+locale+'/'+route+'/',notify:noop};let state=0;
 const context={...words,localized:file==='StaffLifecycle'?language.localized:words.localized,useApp:()=>app,useState:initial=>{const index=state++;return[Object.hasOwn(overrides,index)?overrides[index]:typeof initial==='function'?initial():initial,noop];},useId:()=> 'isolated-mfa-recovery-form',useRef:value=>({current:value}),useCallback:fn=>fn,useEffect:noop,SearchInput:({value})=>createElement('input',{type:'search',value,readOnly:true}),Field:({label,children})=>createElement('label',null,label,children),Modal:({children})=>createElement('div',{role:'dialog'},children)};
 const Body=component(file,file+'Body',context);return renderToStaticMarkup(Body(file==='StaffLifecycle'?{session}:{store}));
}

test('initial reservation leaves search and retry mounted, ends on error or success, and stays off during later searches',()=>{
 const locale='en',identity=JSON.stringify(['actor','admin','admin',locale]),key=JSON.stringify([identity,'','']);
 const initial={...response([]),key,loaded:false,pending:true,error:''};
 const first=renderBody('StaffManagement',locale,{9:initial});
 assert.match(first,/data-directory-initial="true"/);assert.match(first,/<input type="search"/);assert.match(first,/role="status"/);assert.match(first,/class="ws-table"/);
 const failed=renderBody('StaffManagement',locale,{9:{...initial,pending:false,error:'Initial transport failure'}});
 assert.match(failed,/data-directory-initial="false"/);assert.match(failed,/role="alert">Initial transport failure/);assert.match(failed,/<button class="btn ws-small-btn">/);assert.match(failed,/<input type="search"/);
 const ready=renderBody('StaffManagement',locale,{9:{...initial,items:[user('ready')],loaded:true,pending:false}});
 assert.match(ready,/data-directory-initial="false"/);assert.match(ready,/data-user-id="ready"/);
 const searching=renderBody('StaffManagement',locale,{9:initial,10:true});
 assert.match(searching,/data-directory-initial="false"/);assert.match(searching,/<input type="search"/);assert.match(searching,/class="ws-table"/);assert.match(searching,/role="status"/);
});

test('all five locales render continuation even when the loaded staff page contains no selectable account',()=>{
 for(const locale of ['fa','en','tr','ar','ru']){
  const identity=JSON.stringify(['actor','admin',locale]),key=JSON.stringify([identity,'']);
  const page={key,items:[user('actor',{role:'admin'}),user('privileged',{role:'superAdmin'})],nextCursor:'next',loaded:true,pending:false,error:''};
  const html=renderBody('StaffLifecycle',locale,{4:true,15:page});assert.match(html,/data-staff-handover/);assert.match(html,/maxLength="100"/i);assert.match(html,/<button class="btn ws-small-btn">/);assert.doesNotMatch(html,/<option value="privileged"/);
  const translations={fa:'نمایش کارکنان بیشتر',en:'Load more staff',tr:'Daha fazla personel yükle',ar:'تحميل المزيد من الموظفين',ru:'Загрузить ещё сотрудников'};assert.ok(html.includes(translations[locale]));
 }
});

test('the selected staff member remains a visible option and label outside the current filtered page',()=>{
 const locale='en',identity=JSON.stringify(['actor','admin',locale]),key=JSON.stringify([identity,'other people']),selected=user('selected',{name:'Pinned older staff'}),html=renderBody('StaffLifecycle',locale,{4:true,8:selected.id,13:'other people',14:selected,15:{key,items:[],nextCursor:'more',loaded:true,pending:false,error:''}});
 assert.match(html,/data-selected-staff-id="selected"/);assert.match(html,/<option value="selected" selected="">/);assert.match(html,/data-pinned-staff-id="selected"/);assert.match(html,/Pinned older staff/);assert.match(html,/Load more staff/);
});

test('management renders server role filtering, paging and the original table while environment grants stay closed',()=>{
 for(const locale of ['fa','en','tr','ar','ru']){
  const identity=JSON.stringify(['actor','admin','admin',locale]),key=JSON.stringify([identity,'','']),selected=user('older'),page={...response([selected],{nextCursor:'more'}),key,loaded:true,pending:false,error:''},html=renderBody('StaffManagement',locale,{9:page});
  assert.match(html,/data-user-directory/);assert.match(html,/data-user-id="older"/);assert.match(html,/class="ws-card ws-table-wrap"/);assert.match(html,/class="ws-table"/);assert.match(html,/<select class="input" aria-label=/);assert.doesNotMatch(html,/btn-primary/);
  const modal=renderBody('StaffManagement',locale,{4:true,5:selected,6:{...selected,password:''},9:page});assert.match(modal,/role="dialog"/);assert.match(modal,/<select class="input" disabled="">/);
 }
});

test('hybrid user editors expose translated profile, CRM and separate password controls only with the returned target capabilities',()=>{
 for(const locale of ['fa','en','tr','ar','ru']){
  const identity=JSON.stringify(['actor','admin','admin',locale]),key=JSON.stringify([identity,'','']);
  const selected={...user('editable'),profile:globals.blankProfile(),profileRevision:2,capabilities:{canEdit:true,canChangeEmail:true,canManageGrants:true,canResetPassword:true,canDeactivate:true,canReactivate:true}};
  const page={...response([selected],{provisioningMode:'hybrid',canCreate:true,canManageGrants:true}),key,loaded:true,pending:false,error:''};
  const draft={...selected,password:'',confirmPassword:'',crmPermissions:globals.noPermissions()},html=renderBody('StaffManagement',locale,{4:true,5:selected,6:draft,9:page});
  assert.match(html,/data-user-profile-form/);assert.match(html,/data-user-password-form/);assert.ok(html.includes(words.localized(globals.directoryCopy.hybrid,locale)));assert.ok(html.includes(words.localized(globals.directoryCopy.newPassword,locale)));assert.ok(html.includes(personalSettingsText(locale,'phone')));assert.ok(html.includes(words.localized(globals.directoryCopy.scope,locale)));
  assert.doesNotMatch(html,/<input[^>]+type="email"[^>]+disabled/);
  const denied={...selected,capabilities:{...selected.capabilities,canChangeEmail:false,canManageGrants:false,canResetPassword:false}};
  const deniedHtml=renderBody('StaffManagement',locale,{4:true,5:denied,6:draft,9:page});assert.doesNotMatch(deniedHtml,/data-user-password-form/);assert.doesNotMatch(deniedHtml,new RegExp(words.localized(globals.directoryCopy.scope,locale)));assert.match(deniedHtml,/<select class="input" disabled="">/);
 }
});

test('MFA recovery controls render only for the actual senior and current target capability with accessible fresh-proof fields',()=>{
 for(const locale of ['fa','en','tr','ar','ru']){
  const selected={...user('recoverable'),profile:globals.blankProfile(),profileRevision:2,capabilities:{canEdit:true,canResetPassword:true,canResetMfa:true}};
  const render=(target=selected,mode='hybrid',actorRole='superAdmin')=>{
   const identity=JSON.stringify(['actor',actorRole,actorRole,locale]),key=JSON.stringify([identity,'','']);
   const page={...response([target],{provisioningMode:mode,canManageGrants:true}),key,loaded:true,pending:false,error:''};
   return renderBody('StaffManagement',locale,{actorRole,4:true,5:target,6:{...target,password:'',confirmPassword:'',crmPermissions:globals.noPermissions()},7:true,8:globals.freshMfaRecovery(),9:page});
  };
  const html=render();assert.match(html,/data-user-mfa-recovery-form/);assert.match(html,/aria-labelledby="isolated-mfa-recovery-form-title"/);assert.match(html,/aria-describedby="isolated-mfa-recovery-form-consequences"/);
  const inputs=[...html.matchAll(/<input\b([^>]*)>/gi)].map(match=>Object.fromEntries(
   [...match[1].matchAll(/([^\s=]+)="([^"]*)"/g)].map(([,attribute,value])=>[attribute.toLowerCase(),value])));
  for(const [name,autocomplete] of [['actorPassword','current-password'],['actorCode','one-time-code']]){
   const matching=inputs.filter(attributes=>attributes.name===name);
   assert.equal(matching.length,1,'One actual named MFA proof input must be present.');
   assert.equal(matching[0].autocomplete,autocomplete);
  }
  assert.ok(html.includes(words.localized(globals.mfaRecoveryCopy.actorPassword,locale)));assert.ok(html.includes(words.localized(globals.mfaRecoveryCopy.actorCode,locale)));assert.ok(html.includes(words.localized(globals.mfaRecoveryCopy.confirmation,locale)));
  for(const denied of [{...selected,id:'actor'},{...selected,active:false},{...selected,mfaEnabled:false},{...selected,role:'customer'},{...selected,capabilities:{...selected.capabilities,canResetMfa:false}}])assert.doesNotMatch(render(denied),/data-user-mfa-recovery-form/);
  assert.doesNotMatch(render(selected,'env'),/data-user-mfa-recovery-form/);assert.doesNotMatch(render(selected,'hybrid','admin'),/data-user-mfa-recovery-form/);
 }
});

test('component identity remounts for each actor, authority role and locale',()=>{
 for(const file of ['StaffManagement','StaffLifecycle']){
  const keys=[];
  for(const [id,role,locale] of [['first','admin','en'],['second','admin','en'],['second','superAdmin','en'],['second','superAdmin','fa']]){
   const session={id,role},app={session,locale},props=file==='StaffManagement'?{store:{role,locale}}:{session};
   const Wrapper=component(file,file,{...words,localized:file==='StaffLifecycle'?language.localized:words.localized,useApp:()=>app,[file+'Body']:()=>null});keys.push(Wrapper(props).key);
  }
  assert.equal(new Set(keys).size,4);
 }
});
