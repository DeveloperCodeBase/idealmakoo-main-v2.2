import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {dirname,resolve} from 'node:path';
import {createElement,Fragment,Suspense,useEffect,useMemo,useRef,useState} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url),locales=['fa','en','tr','ar','ru'],nothing=()=>null;
const styles=new Proxy({}, {get:(_target,key)=>String(key)}),Link=({children,...props})=>createElement('a',props,children);
const {accountText}=await loadTs('src/components/account/account-copy.ts');
const {translate,formatDate,localized}=await loadTs('src/lib/i18n.ts');
const {localizedPath}=await loadTs('src/lib/locale-routing.ts');
const {safeAccountReturn,withAccountReturn}=await loadTs('src/lib/account-return.ts');
const {canViewRequest}=await loadTs('src/components/account/portal-data.ts');
const {authorize,demoUsers}=await loadTs('src/lib/auth.ts');
const sourceFor=file=>ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function actual(file,name,context={},variables=[]){
 const source=sourceFor(file),fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(fn,`Execute the actual ${name}`);
 const declarations=source.statements.filter(ts.isVariableStatement).filter(node=>node.declarationList.declarations.some(value=>variables.includes(value.name.getText(source))));assert.equal(declarations.length,variables.length);
 const icons=source.statements.filter(ts.isImportDeclaration).filter(node=>node.moduleSpecifier.text==='lucide-react').flatMap(node=>node.importClause.namedBindings.elements.map(item=>item.name.text));
 const code=declarations.map(node=>node.getText(source)).join('\n')+'\nexport const probe='+fn.getText(source).replace(/^export\s+(?:default\s+)?/,'');
 const exports={};runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require,Fragment,Suspense,useEffect,useMemo,useRef,useState,Link,styles,drawerStyles:styles,demoMode:false,...Object.fromEntries(icons.map(name=>[name,nothing])),...context});return exports.probe;
}
const appFor=(locale,patch={})=>({locale,dir:['fa','ar'].includes(locale)?'rtl':'ltr',theme:'light',role:'customer',session:null,sessionReady:false,sessionError:'',requests:[],requestsReady:false,requestsError:'',saved:[],inquiries:[],catalog:[],userSettings:null,displayName:'',href:path=>localizedPath(locale,path||''),t:key=>translate(locale,key),signOut:nothing,reloadRequests:nothing,updateRequest:async()=>true,notify:nothing,...patch});
const featureNames=sourceFor('src/components/account/AccountPortal.tsx').statements.filter(ts.isVariableStatement).flatMap(node=>node.declarationList.declarations).filter(node=>node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText()==='dynamic').map(node=>node.name.getText());
const features=Object.fromEntries(featureNames.map(name=>[name,props=>createElement('section',{'data-account-feature':name,'data-section':props.section})]));
function components(app,{query='',overrides={}}={}){
 const shared={useApp:()=>app,useAccountText:()=>key=>accountText(app.locale,key,app.t),accountText,formatDate,localized,canViewRequest,safeAccountReturn,withAccountReturn,Modal:nothing,useSearchParams:()=>new URLSearchParams(query),useExistingProductDisplay:value=>value,existingProductHref:nothing,ExistingProductName:nothing,BookingReceipt:nothing,SharedQuotes:nothing,...overrides};
 const Loading=actual('src/components/account/AccountBodyState.tsx','AccountBodyLoading',shared),ErrorPanel=actual('src/components/account/AccountBodyState.tsx','AccountRequestError',shared);
 const EmptyState=actual('src/components/account/portal-ui.tsx','EmptyState',shared),Status=actual('src/components/account/portal-ui.tsx','Status',shared),requestKind=actual('src/components/account/portal-ui.tsx','requestKind',shared),UserAvatar=actual('src/components/account/UserAvatar.tsx','UserAvatar',shared);
 const RequestList=actual('src/components/account/portal-ui.tsx','RequestList',{...shared,Status,requestKind});
 const context={...shared,AccountBodyLoading:Loading,AccountRequestError:ErrorPanel,EmptyState,Status,requestKind,UserAvatar,RequestList};
 const Requests=actual('src/components/account/AccountRequests.tsx','RequestsPanel',context);
 return{Loading,ErrorPanel,Portal:actual('src/components/account/AccountPortal.tsx','AccountPortal',{...context,...features},['nav']),Requests,RequestsEntry:actual('src/components/account/AccountRequestsEntry.tsx','AccountRequestsEntry',{...context,RequestsPanel:Requests}),Overview:actual('src/components/account/AccountPanels.tsx','OverviewPanel',context)};
}
const render=(Component,props={})=>renderToStaticMarkup(createElement(Component,props));
const request=(id,message)=>({id,ownerId:'test-customer',name:'Test customer',organization:'Test organization',kind:'rfq',locale:'en',message,status:'received',productIds:[],createdAt:'2026-10-20T12:00:00.000Z',messages:[{id:'test-visible-message',body:'A public response',sender:'Test operator',visibility:'public',createdAt:'2026-10-20T12:05:00.000Z'},{id:'test-private-message',body:'Test internal-only note',sender:'Test operator',visibility:'internal',createdAt:'2026-10-20T12:06:00.000Z'}]});

test('all five account locales server-render the unchanged frame while the session is pending',()=>{
 for(const locale of locales){
  const pending=appFor(locale),{Portal}=components(pending),html=render(Portal,{section:'requests'});
  assert.match(html,/data-page-shell="account"/);assert.match(html,new RegExp(`dir="${pending.dir}"`));
  assert.ok(html.includes(renderToStaticMarkup(createElement('h1',null,accountText(locale,'portalTitle',pending.t)))));
  for(const className of ['portalHeading','mobileAccountMenu','portalLayout','portalSidebar desktopSidebar','portalContent','sectionBreadcrumb'])assert.ok(html.includes(`class="${className}"`),`${locale}: ${className} remains in the initial frame.`);
  assert.match(html,/data-account-body-state="loading" aria-busy="true"/);assert.doesNotMatch(html,/data-account-feature=/);assert.doesNotMatch(html,/class="localNotice"/);
  assert.equal((html.match(/aria-current="page"/g)||[]).length,1);assert.ok(html.includes(`href="/${locale}/account/security/"`));assert.ok(html.includes(`href="/${locale}/account/requests/"`));
  const ready=components({...pending,sessionReady:true}).Portal,readyHtml=render(ready,{section:'requests'});
  for(const className of ['portalHeading','mobileAccountMenu','portalLayout','portalSidebar desktopSidebar','portalContent','sectionBreadcrumb'])assert.ok(readyHtml.includes(`class="${className}"`));
  assert.match(readyHtml,/data-account-feature="RequestsPanel"/);
 }
});

test('request loading and fetch failures are distinct from a confirmed empty collection or absent selected request',()=>{
 for(const locale of locales){
  const base=appFor(locale,{sessionReady:true,session:{id:'test-customer',role:'customer',name:'Test customer'}}),rows=[request('test-owned-one','Owned request details')];
  const pending=components(base,{query:'id=test-owned-one'});let html=render(pending.Requests,{requests:rows,section:'requests'});assert.match(html,/data-account-body-state="loading"/);assert.doesNotMatch(html,/Owned request details/);
  const failed=components({...base,requestsError:'Test network failure'},{query:'id=test-owned-one'});html=render(failed.Requests,{requests:[],section:'requests'});assert.match(html,/data-account-body-state="error"/);assert.match(html,/role="alert">Test network failure/);assert.doesNotMatch(html,/class="emptyState"/);
  const ready=components({...base,requestsReady:true});html=render(ready.Requests,{requests:[],section:'requests'});assert.ok(html.includes(accountText(locale,'noRequests',base.t)));assert.doesNotMatch(html,/data-account-body-state=/);
  const absent=components({...base,requestsReady:true},{query:'id=test-not-returned'});html=render(absent.Requests,{requests:rows,section:'requests'});assert.ok(html.includes(accountText(locale,'noTracking',base.t)));assert.doesNotMatch(html,/Owned request details/);
 }
});

test('query and path request selection render immediately without a list flash or an effect',()=>{
 const rows=[request('test-owned-one','First requested details'),request('test-owned-two','Second requested details')];
 for(const locale of locales)for(const [section,query,wanted,unwanted] of [['requests','id=test-owned-two','Second requested details','First requested details'],['requests/test-owned-one','','First requested details','Second requested details'],['requests/test-owned-one','id=test-owned-two','Second requested details','First requested details']]){
  const app=appFor(locale,{sessionReady:true,requestsReady:true,session:{id:'test-customer',role:'customer',name:'Test customer'}}),{Requests}=components(app,{query});
  const html=render(Requests,{requests:rows,section});assert.ok(html.includes(wanted));assert.ok(!html.includes(unwanted));assert.match(html,/class="requestMeta"/);assert.doesNotMatch(html,/class="requestList"/);assert.ok(html.includes('A public response'));assert.ok(!html.includes('Test internal-only note'));
 }
});

test('the account overview does not present zero statistics until its request response is confirmed',()=>{
 const base=appFor('en',{sessionReady:true}),pending=components(base);assert.match(render(pending.Overview,{requests:[],name:'Test customer'}),/data-account-body-state="loading"/);
 const failed=components({...base,requestsError:'Test request read failed'});assert.match(render(failed.Overview,{requests:[],name:'Test customer'}),/data-account-body-state="error"/);
 const ready=components({...base,requestsReady:true}),html=render(ready.Overview,{requests:[],name:'Test customer'});assert.match(html,/class="stats"/);assert.ok(html.includes(accountText('en','noRequests',base.t)));assert.doesNotMatch(html,/data-account-body-state=/);
});

test('security and MFA enrollment remain reachable even while request data is pending or failed',()=>{
 for(const locale of locales)for(const requestsError of ['', 'Test request service failure']){
  const app=appFor(locale,{role:'admin',sessionReady:true,requestsReady:false,requestsError,session:{id:'test-staff',role:'admin',name:'Test staff',email:'test-staff@example.test',mfaEnrollmentRequired:true}}),{Portal}=components(app);
  const html=render(Portal,{section:'security'});assert.match(html,/data-account-feature="ProductionSecurity"/);assert.doesNotMatch(html,/data-account-body-state=/);assert.ok(!html.includes(requestsError||'an impossible marker'));
  const guest=components({...app,session:null}).Portal;assert.doesNotMatch(render(guest,{section:'security'}),/data-account-feature="ProductionSecurity"/);
 }
});

test('Application keeps the server account slot in main during session resolution and retains the separate admin MFA gate',()=>{
 const accountContent=createElement('section',{'data-account-probe':'stable'},createElement('h1',null,'Existing account frame'));
 for(const locale of locales){
  const app=appFor(locale),Application=actual('src/components/Application.tsx','Application',{useApp:()=>app,authorize,demoUsers,loading:()=>createElement('div',{'data-whole-page-loading':true}),Navigation:()=>createElement('nav',{'data-nav':true}),Footer:()=>createElement('footer',{'data-footer':true}),Assistant:nothing,Brand:nothing,ThemeLanguage:nothing,PublicView:nothing,GlossaryProvider:nothing,Workspace:nothing,AuthPage:nothing});
  let html=render(Application,{segments:['account','requests'],accountContent});assert.match(html,/<main id="main-content"><section data-account-probe="stable">/);assert.doesNotMatch(html,/data-whole-page-loading/);assert.match(html,/<footer data-footer="true">/);
  Object.assign(app,{sessionReady:true,role:'admin',session:{id:'test-staff',role:'admin',mfaEnrollmentRequired:true}});html=render(Application,{segments:['account','security'],accountContent});assert.match(html,/data-account-probe="stable"/);
  html=render(Application,{segments:['admin'],accountContent});assert.match(html,/class="glass access-panel"/);assert.ok(html.includes(`href="/${locale}/account/security/"`));assert.doesNotMatch(html,/data-account-probe=/);
 }
});

test('server-selected account code cannot mount before session resolution or bypass a section login requirement',()=>{
 let mounts=0;
 function Body(){mounts++;return createElement('p',{'data-selected-body':true},'Selected account code');}
 const body=createElement(Body);
 for(const locale of locales){
  const app=appFor(locale),{Portal}=components(app);
  for(const section of ['requests','security','profile']){
   const html=render(Portal,{section,body});assert.match(html,/data-account-body-state="loading"/);assert.doesNotMatch(html,/data-selected-body/);
  }
  app.sessionReady=true;
  for(const section of ['security','profile','organizations']){
   const html=render(Portal,{section,body});assert.match(html,/class="emptyState"/);assert.doesNotMatch(html,/data-selected-body/);
  }
  const before=mounts;
  assert.match(render(Portal,{section:'requests',body}),/data-selected-body="true"/);assert.equal(mounts,before+1,'Guest request tracking stays reachable after session resolution.');
  Object.assign(app,{session:{id:'test-customer',role:'customer',name:'Current customer'}});
  assert.match(render(Portal,{section:'requests',body}),/data-selected-body="true"/);assert.equal(mounts,before+2);
 }
 assert.equal(mounts,locales.length*2);
});

test('an account code slot is remounted for a different actor, role, locale or complete request route',()=>{
 const body=createElement('p',{'data-route-slot':true}),keys=[];
 const overrides={useEffect:nothing,useMemo:fn=>fn(),useState:value=>[typeof value==='function'?value():value,nothing]};
 function find(node){
  if(!node||typeof node!=='object')return undefined;
  if(node.type===Fragment&&node.props.children===body)return node;
  for(const child of [node.props?.children].flat(Infinity)){const found=find(child);if(found)return found;}
 }
 for(const [id,role,locale,section] of [['test-first','customer','en','requests'],['test-second','customer','en','requests'],['test-second','support','en','requests'],['test-second','support','fa','requests'],['test-second','support','fa','requests/test-owned-one']]){
  const app=appFor(locale,{role,sessionReady:true,session:{id,role,name:'Current account'}}),{Portal}=components(app,{overrides}),slot=find(Portal({section,body}));
  assert.ok(slot);assert.equal(slot.key,JSON.stringify([id,role,locale,section]));keys.push(slot.key);
 }
 assert.equal(new Set(keys).size,keys.length);
});

test('the preloaded request entry reads only the current provider response and preserves pending and error states',()=>{
 const app=appFor('en',{sessionReady:true,session:{id:'test-customer',role:'customer',name:'Current customer'}}),{RequestsEntry}=components(app,{query:'id=test-owned-one'});
 const props={section:'requests',requests:[request('test-owned-one','A stale supplied record must be ignored')]};
 let html=render(RequestsEntry,props);assert.match(html,/data-account-body-state="loading"/);assert.doesNotMatch(html,/stale supplied/);
 app.requestsError='Current request read failed';html=render(RequestsEntry,props);assert.match(html,/data-account-body-state="error"/);assert.doesNotMatch(html,/stale supplied/);
 Object.assign(app,{requestsReady:true,requestsError:'',requests:[request('test-owned-one','Current provider record')]});
 html=render(RequestsEntry,props);assert.match(html,/Current provider record/);assert.doesNotMatch(html,/stale supplied/);
 Object.assign(app,{requestsReady:false,requests:[],session:{id:'test-replacement',role:'customer',name:'Replacement customer'}});
 html=render(RequestsEntry,props);assert.match(html,/data-account-body-state="loading"/);assert.doesNotMatch(html,/Current provider record|stale supplied/);
});

test('Application never mounts selected workspace code before authentication, MFA enrollment and route authorization',()=>{
 let mounts=0;
 function Body(){mounts++;return createElement('p',{'data-workspace-slot':true},'Authorized selected workspace');}
 for(const locale of locales){
  const app=appFor(locale),Application=actual('src/components/Application.tsx','Application',{useApp:()=>app,authorize,demoUsers,loading:()=>createElement('div',{'data-whole-page-loading':true}),Navigation:nothing,Footer:nothing,Assistant:nothing,Brand:nothing,ThemeLanguage:nothing,PublicView:nothing,GlossaryProvider:nothing,Workspace:()=>createElement('p',{'data-fallback-workspace':true}),AuthPage:nothing});
  const props={segments:['admin','pages'],workspaceContent:createElement(Body)};
  let html=render(Application,props);assert.match(html,/data-whole-page-loading/);assert.doesNotMatch(html,/data-workspace-slot/);
  app.sessionReady=true;html=render(Application,props);assert.match(html,/access-panel/);assert.doesNotMatch(html,/data-workspace-slot/);
  app.session={id:'test-customer',role:'customer',name:'Customer'};html=render(Application,props);assert.match(html,/access-panel/);assert.doesNotMatch(html,/data-workspace-slot/);
  Object.assign(app,{role:'superAdmin',session:{id:'test-owner',role:'superAdmin',mfaEnrollmentRequired:true}});html=render(Application,props);assert.ok(html.includes(`href="/${locale}/account/security/"`));assert.doesNotMatch(html,/data-workspace-slot/);
  app.session.mfaEnrollmentRequired=false;html=render(Application,props);assert.match(html,/data-workspace-slot="true"/);assert.doesNotMatch(html,/data-fallback-workspace/);
  const shellKey=segments=>Application({...props,segments}).props.children.find(element=>element?.type===Suspense).props.children.key;
  const originalKey=shellKey(['admin','pages']);assert.equal(shellKey(['admin','products']),originalKey,'Changing the selected feature preserves the existing authorized workspace store and shell.');
  app.session={...app.session,id:'test-replacement-owner'};assert.notEqual(shellKey(['admin','pages']),originalKey,'A replacement actor cannot reuse the previous workspace instance.');
  html=render(Application,{segments:['admin','pages']});assert.doesNotMatch(html,/data-workspace-slot|data-fallback-workspace/,'Without a server-selected slot no workspace feature is implicitly mounted.');
 }
 assert.equal(mounts,locales.length);
});

test('the account entry graph defers requests and production feature modules behind genuine dynamic imports',async()=>{
 const result=await build({entryPoints:['src/components/account/AccountPortal.tsx'],bundle:true,write:false,metafile:true,splitting:true,format:'esm',platform:'browser',outdir:'/tmp/idealmakoo-account-import-probe',logLevel:'silent',loader:{'.css':'empty'},external:['next','next/*','react','react/*','react-dom','react-dom/*']});
 const outputs=result.metafile.outputs,entry=Object.keys(outputs).find(name=>outputs[name].entryPoint==='src/components/account/AccountPortal.tsx');assert.ok(entry);const initial=new Set(),seen=new Set();
 function visit(name){if(seen.has(name))return;seen.add(name);const output=outputs[name];assert.ok(output);for(const input of Object.keys(output.inputs))initial.add(input);for(const edge of output.imports)if(!edge.external&&edge.kind==='import-statement')visit(outputs[edge.path]?edge.path:resolve(dirname(name),edge.path));}visit(entry);
 for(const feature of ['AccountRequests','AccountPanels','PersonalSettings','ProductionOrganizations','ProductionNotifications','ProductionSecurity','NotificationPreferences','CommunicationChannels','Bookings','AccountDataRooms','TenderCenter','WishlistCenter'])assert.ok(![...initial].some(path=>path.endsWith('/'+feature+'.tsx')),`${feature} must not execute before its selected body needs it.`);
 assert.ok([...initial].some(path=>path.endsWith('/AccountBodyState.tsx')));assert.ok(Object.values(outputs).some(output=>output.entryPoint==='src/components/account/AccountRequests.tsx'));assert.ok(Object.values(outputs).some(output=>output.entryPoint==='src/components/account/ProductionSecurity.tsx'));
});
