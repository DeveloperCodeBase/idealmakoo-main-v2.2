import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {dirname,resolve} from 'node:path';
import {createElement,useEffect,useRef,useState} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import postcss from 'postcss';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url),locales=['fa','en','tr','ar','ru'];
const nothing=()=>null,Link=props=>createElement('a',props),styles=new Proxy({}, {get:(_target,key)=>String(key)});
const {accountText}=await loadTs('src/components/account/account-copy.ts');
const {translate}=await loadTs('src/lib/i18n.ts');
const {roleLandingRoute,authorize,canonicalWorkspaceSection}=await loadTs('src/lib/auth.ts');
const {pageLifecycleCopy}=await loadTs('src/components/workspace/page-lifecycle-copy.ts');
const {localized,wt}=await loadTs('src/components/workspace/i18n.ts');
function actual(file,name,context){
 const source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const fn=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name);assert.ok(fn);
 const iconNames=source.statements.filter(ts.isImportDeclaration).filter(node=>node.moduleSpecifier.text==='lucide-react').flatMap(node=>node.importClause.namedBindings.elements.map(item=>item.name.text));
 const exports={};runInNewContext(ts.transpileModule('export const probe='+fn.getText(source).replace(/^export\s+(?:default\s+)?/,''),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require,useEffect,useRef,useState,Link,styles,...Object.fromEntries(iconNames.map(name=>[name,nothing])),...context});return exports.probe;
}

test('the profile trigger’s accessible name contains the actual visible avatar initials in every UI locale',()=>{
 const Avatar=actual('src/components/account/UserAvatar.tsx','UserAvatar',{});
 for(const locale of locales)for(const name of ['Profile Example Administrator','علی رضایی','Ayşe Öz','Анна Иванова','']){
  const app={locale,session:{id:'test-user',role:'admin',name,email:'test-profile@example.test'},displayName:name,dir:['fa','ar'].includes(locale)?'rtl':'ltr',t:key=>translate(locale,key),href:path=>`/${locale}/${path}/`};
  const Menu=actual('src/components/site/UserMenu.tsx','UserMenu',{useApp:()=>app,accountText,roleLandingRoute,UserAvatar:Avatar,Modal:nothing});
  const html=renderToStaticMarkup(createElement(Menu,{workspace:true}));
  const label=html.match(/<button[^>]*aria-label="([^"]*)"/)?.[1],avatar=html.match(/class="avatar[^>]*>[\s\S]*?<span>([^<]+)<\/span>/)?.[1];
  assert.ok(label);assert.ok(avatar);assert.ok(label.includes(avatar),`${locale}: the visible narrow-layout label must be part of the button’s accessible name.`);
  assert.match(html,/aria-haspopup="dialog"/);assert.match(html,/aria-expanded="false"/);assert.match(html,/class="triggerName" dir="auto"/);
 }
 const Guest=actual('src/components/site/UserMenu.tsx','UserMenu',{useApp:()=>({locale:'en',session:null}),accountText,roleLandingRoute,UserAvatar:Avatar,Modal:nothing});assert.equal(renderToStaticMarkup(createElement(Guest)),'');
});

test('page lifecycle follows the workspace h1 with h2 while retaining its exact existing typography and controls',()=>{
 const Panel=actual('src/components/workspace/PageLifecycle.tsx','LifecyclePanel',{localized,wt,copy:pageLifecycleCopy,RetainedPages:nothing,Field:nothing,Modal:nothing});
 for(const locale of locales){
  const page={id:'test-page',locale,title:'Test page',version:1,updatedAt:'2026-10-20T12:00:00.000Z'},store={actorId:'test-admin',role:'admin',locale,loaded:false,pending:false};
  const html=renderToStaticMarkup(createElement(Panel,{store,page,dirty:false,onAdopt:nothing,onStatus:nothing}));
  assert.match(html,/<div class="ws-card-head"><h2 class="ws-page-lifecycle-heading">/);assert.doesNotMatch(html,/<h3/);assert.match(html,/data-page-lifecycle="true"/);assert.match(html,/data-page-state="checking"/);
  assert.ok(html.includes(localized(pageLifecycleCopy.title,locale)));assert.match(html,/<button type="button" class="btn"/);
 }
 const css=readFileSync(new URL('../src/components/workspace/workspace.css',import.meta.url),'utf8');
 const headingRules=[];
 postcss.parse(css).walkRules(rule=>{if(rule.selectors.includes('.ws-card-head .ws-page-lifecycle-heading'))headingRules.push(rule);});
 assert.equal(headingRules.length,1,'The lifecycle heading has one unambiguous typography rule.');
 assert.deepEqual([...headingRules[0].selectors].sort(),['.ws-card-head h3','.ws-card-head h2.ws-heading-as-h3','.ws-card-head .ws-page-lifecycle-heading'].sort());
 assert.deepEqual(headingRules[0].nodes.map(node=>({type:node.type,property:node.prop,value:node.value,important:!!node.important})),[
  {type:'decl',property:'font-size',value:'13px',important:false},
  {type:'decl',property:'font-weight',value:'620',important:false},
  {type:'decl',property:'line-height',value:'1.6',important:false},
 ]);
});

test('the initial workspace bundle keeps selected features behind actual dynamic import boundaries',async()=>{
 const result=await build({entryPoints:['src/components/workspace/Workspace.tsx'],bundle:true,write:false,metafile:true,splitting:true,format:'esm',platform:'browser',outdir:'/tmp/idealmakoo-workspace-import-probe',logLevel:'silent',loader:{'.css':'empty'},external:['next','next/*','react','react/*','react-dom','react-dom/*']});
 const outputs=result.metafile.outputs,entry=Object.keys(outputs).find(key=>outputs[key].entryPoint==='src/components/workspace/Workspace.tsx');assert.ok(entry);
 const initial=new Set(),seen=new Set();
 function visit(name){if(seen.has(name))return;seen.add(name);const output=outputs[name];assert.ok(output,`Known output ${name}`);for(const input of Object.keys(output.inputs))initial.add(input);for(const edge of output.imports){if(edge.external||edge.kind!=='import-statement')continue;visit(outputs[edge.path]?edge.path:resolve(dirname(name),edge.path));}}
 visit(entry);
 for(const feature of ['CMS','Studio','ProductEditor','ProductWorkspace','Overview','SiteSettings','CrmOperations','StaffManagement','PrivacyCenter','ProductionOrganizations','TenderManager','ResourceManagement','LiveMonitoring','Records','Pipeline','Editorial','Administration'])assert.ok(![...initial].some(path=>path.endsWith('/'+feature+'.tsx')),`${feature} must not execute as an initial shell dependency.`);
 assert.ok(Object.values(outputs).some(output=>output.entryPoint==='src/components/workspace/CMS.tsx'));
 assert.ok(Object.values(outputs).some(output=>output.entryPoint==='src/components/workspace/StaffManagement.tsx'));
});

test('the real workspace branch function retains loading and role gates before selecting a feature',()=>{
 const file='src/components/workspace/Workspace.tsx',source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let declaration;function walk(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='renderSection')declaration=node;ts.forEachChild(node,walk);}walk(source);assert.ok(declaration);
 const names=source.statements.filter(ts.isVariableStatement).flatMap(node=>node.declarationList.declarations).filter(node=>node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(source)==='dynamic').map(node=>node.name.getText(source));
 function render(section,{role='superAdmin',loaded=true,permit=true,contact=true}={}){
  const exports={},store={loaded,locale:'en',permit:()=>permit,refresh:async()=>{},state:{}},app={session:{id:'test-admin',crmAccess:{permissions:{contact}}}},active=canonicalWorkspaceSection(section)||'overview';
  const components=Object.fromEntries(names.map(name=>[name,props=>createElement('section',{'data-feature':name,'data-section':props.section,'data-collection':props.collection,'data-mode':props.mode,'data-manage':props.manage})]));
  const code=ts.transpileModule('exports.probe='+declaration.initializer.getText(source),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  runInNewContext(code,{exports,require,store,app,section,active,role,locale:'en',body:undefined,demoMode:false,routeAllowed:authorize(role,section),liveText:()=>'',wt,localized,deskCopy:{accessNote:'Access requires a permitted role.'},Link,roleLandingRoute,LockKeyhole:nothing,ArrowUpRight:nothing,dataCollection:'leads',setDataCollection:nothing,...components});return renderToStaticMarkup(exports.probe());
 }
 for(const [section,feature] of [['','Overview'],['pages','PageBuilder'],['ai','ContentStudio'],['media','MediaLibrary'],['products','ProductWorkspace'],['monitoring/recovery','LiveMonitoring'],['staff','StaffManagement'],['settings','SiteSettings'],['crm/activities','CrmActivityDesk'],['crm/reports','CrmReports'],['profile','PersonalSettings']]){
  assert.ok(render(section).includes(`data-feature="${feature}"`),section);
  assert.doesNotMatch(render(section,{loaded:false}),/data-feature=/,'No feature mounts before the current workspace has loaded.');
 }
 for(const section of ['pages','products','staff','settings','roles','monitoring/recovery'])assert.doesNotMatch(render(section,{role:'customer'}),/data-feature=/,'A denied route never mounts a deferred feature.');
 assert.match(render('crm/accounts'),/data-feature="ProductionOrganizations"/);assert.doesNotMatch(render('crm/accounts',{contact:false}),/data-feature="ProductionOrganizations"/);assert.doesNotMatch(render('crm/accounts',{permit:false}),/data-feature="ProductionOrganizations"/);
 assert.match(render('menus'),/data-mode="menus"/);assert.match(render('settings'),/data-mode="settings"/);assert.match(render('monitoring/recovery'),/data-section="recovery"/);
});
