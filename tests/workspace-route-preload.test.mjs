import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {dirname,resolve} from 'node:path';
import {createElement,Fragment} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url),locales=['fa','en','tr','ar','ru'];
const file='src/components/workspace/Workspace.tsx';
const sourceFor=file=>ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const source=sourceFor(file);
const compilerOptions={module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX};
const {authorize,canonicalWorkspaceSection,roleLandingRoute}=await loadTs('src/lib/auth.ts');
const {localized,wt}=await loadTs('src/components/workspace/i18n.ts');
const Link=({children,...props})=>createElement('a',props,children),nothing=()=>null;

function executeModule(file,imports={}){
 const exports={};
 runInNewContext(ts.transpileModule(readFileSync(new URL('../'+file,import.meta.url),'utf8'),{compilerOptions}).outputText,{exports,require:name=>Object.hasOwn(imports,name)?imports[name]:require(name)});
 return exports;
}
const context=executeModule('src/components/workspace/WorkspaceRouteContext.tsx');
const {WorkspaceRouteStoreProvider,useWorkspaceRouteStore}=context;
let branch;
function find(node){if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='renderSection')branch=node.initializer;ts.forEachChild(node,find);}find(source);assert.ok(branch);
const featureNames=source.statements.filter(ts.isVariableStatement).flatMap(node=>node.declarationList.declarations).filter(node=>node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText(source)==='dynamic').map(node=>node.name.getText(source));
const features=Object.fromEntries(featureNames.map(name=>[name,()=>createElement('section',{'data-fallback-feature':name})]));
function select({section='pages',role='superAdmin',locale='en',actorId='test-admin',loaded=true,body,store:provided}={}){
 const store=provided||{actorId,locale,role,loaded,state:{},refresh:async()=>{},permit:()=>true};
 const exports={},app={session:{id:actorId,crmAccess:{permissions:{contact:true}}}};
 runInNewContext(ts.transpileModule('exports.select='+branch.getText(source),{compilerOptions}).outputText,{exports,require,Fragment,WorkspaceRouteStoreProvider,body,store,app,section,active:canonicalWorkspaceSection(section)||'overview',role,locale,demoMode:false,routeAllowed:authorize(role,section),liveText:()=>'',wt,localized,deskCopy:{accessNote:'A permitted role is required.'},Link,roleLandingRoute,LockKeyhole:nothing,ArrowUpRight:nothing,dataCollection:'leads',setDataCollection:nothing,...features});
 return {element:exports.select(),store};
}

test('a selected code-only workspace slot cannot mount before loading or on a denied route',()=>{
 let mounts=0;
 function Body(){mounts++;return createElement('p',null,'Selected authorized feature');}
 const body=createElement(Body);
 for(const locale of locales)for(const section of ['','pages','settings','staff']){
  const pending=select({section,locale,loaded:false,body});const html=renderToStaticMarkup(pending.element);
  assert.match(html,/role="status"/);assert.doesNotMatch(html,/Selected authorized feature/);
  const denied=select({section,locale,role:'customer',body});const deniedHtml=renderToStaticMarkup(denied.element);
  assert.match(deniedHtml,/ws-access-card/);assert.doesNotMatch(deniedHtml,/Selected authorized feature/);
 }
 assert.equal(mounts,0);
 const loaded=select({body});assert.match(renderToStaticMarkup(loaded.element),/Selected authorized feature/);assert.equal(mounts,1);
});

test('slot context exposes the exact current projected store and changes its feature key across identity, locale and route',()=>{
 let observed;
 function Body(){observed=useWorkspaceRouteStore();return createElement('p',null,observed.state.marker);}
 const bodies=[];
 for(const [actorId,role,locale,section] of [['test-first','superAdmin','en','pages'],['test-second','superAdmin','en','pages'],['test-second','admin','en','pages'],['test-second','admin','fa','pages'],['test-second','admin','fa','']]){
  const store={actorId,role,locale,loaded:true,state:{marker:`Current ${bodies.length}`}};
  const selected=select({actorId,role,locale,section,store,body:createElement(Body)});
  const html=renderToStaticMarkup(selected.element);assert.equal(observed,store);assert.ok(html.includes(store.state.marker));
  assert.equal(selected.element.type,WorkspaceRouteStoreProvider);assert.equal(selected.element.props.store,store);
  bodies.push(selected.element.props.children.key);
 }
 assert.equal(new Set(bodies).size,bodies.length,'A prior feature instance cannot survive a different actor, role, locale or full section.');
 assert.throws(()=>renderToStaticMarkup(createElement(Body)),/current authorized workspace store/,'A feature cannot silently create or reuse a store outside the authorized provider.');
});

test('absent or null slots preserve the real existing dispatcher and its section-specific behavior',()=>{
 for(const body of [undefined,null])for(const [section,expected] of [['','Overview'],['pages','PageBuilder'],['products','ProductWorkspace'],['media','MediaLibrary'],['crm/activities','CrmActivityDesk'],['monitoring/recovery','LiveMonitoring'],['staff','StaffManagement'],['settings','SiteSettings']]){
  const {element}=select({section,body});assert.match(renderToStaticMarkup(element),new RegExp(`data-fallback-feature="${expected}"`));
 }
});

test('the thin feature adapters consume current context without serializing data or creating a second store',()=>{
 const seen=[];
 const Overview=props=>{seen.push(['overview',props]);return createElement('p',null,'Overview body');};
 const PageBuilder=props=>{seen.push(['pages',props]);return createElement('p',null,'Page body');};
 const overview=executeModule('src/components/workspace/WorkspaceOverviewEntry.tsx',{'./Overview':{Overview},'./WorkspaceRouteContext':context}).default;
 const pages=executeModule('src/components/workspace/WorkspacePagesEntry.tsx',{'./CMS':{PageBuilder},'./WorkspaceRouteContext':context}).default;
 for(const locale of locales)for(const [kind,Component] of [['overview',overview],['pages',pages]]){
  const store={actorId:'test-current',role:'admin',locale,loaded:true,state:{}};
  const html=renderToStaticMarkup(createElement(WorkspaceRouteStoreProvider,{store},createElement(Component)));
  assert.match(html,kind==='pages'?/Page body/:/Overview body/);const observed=seen.at(-1);assert.equal(observed[0],kind);assert.deepEqual(Object.keys(observed[1]),['store']);assert.equal(observed[1].store,store);
 }
});

test('the combined products entry preserves the original fragment, editor key and records identity and props',()=>{
 const ProductEditor=()=>createElement('section',{'data-product-editor':true});
 const RecordsDesk=()=>createElement('div',{'data-product-records':true});
 const ProductWorkspace=executeModule('src/components/workspace/ProductWorkspace.tsx',{'./ProductEditor':{default:ProductEditor},'./Records':{RecordsDesk}}).default;
 for(const locale of locales)for(const loaded of [false,true]){
  const store={actorId:'test-current',role:'superAdmin',locale,loaded,state:{marker:'Current projected workspace'}};
  const element=ProductWorkspace({store});assert.equal(element.type,Fragment,'The entry adds no layout wrapper.');
  const [editor,records]=element.props.children;
  assert.equal(editor.type,ProductEditor);assert.equal(editor.key,`${locale}-${loaded}`);assert.deepEqual(Object.keys(editor.props),['store']);assert.equal(editor.props.store,store);
  assert.equal(records.type,RecordsDesk);assert.equal(records.key,null,'Records do not acquire a locale/loading key that resets their local state.');
  assert.deepEqual(Object.keys(records.props),['collection','store']);assert.equal(records.props.collection,'products');assert.equal(records.props.store,store);
  const html=renderToStaticMarkup(element);assert.match(html,/^<section data-product-editor="true"><\/section><div data-product-records="true"><\/div>$/);
 }
});

test('selected entry graphs keep unrelated features and the unopened record dialog out of their initial JavaScript',async()=>{
 const entries=['src/components/workspace/WorkspaceOverviewEntry.tsx','src/components/workspace/WorkspacePagesEntry.tsx'];
 const result=await build({entryPoints:entries,bundle:true,write:false,metafile:true,splitting:true,format:'esm',platform:'browser',outdir:'/tmp/idealmakoo-workspace-route-import-probe',logLevel:'silent',loader:{'.css':'empty'},external:['next','next/*','react','react/*','react-dom','react-dom/*']});
 const outputs=result.metafile.outputs;
 function initial(entryPoint){
  const entry=Object.keys(outputs).find(key=>outputs[key].entryPoint===entryPoint);assert.ok(entry);
  const files=new Set(),seen=new Set();
  function walk(name){if(seen.has(name))return;seen.add(name);const output=outputs[name];assert.ok(output);for(const input of Object.keys(output.inputs))files.add(input);for(const edge of output.imports){if(edge.external||edge.kind!=='import-statement')continue;walk(outputs[edge.path]?edge.path:resolve(dirname(name),edge.path));}}
  walk(entry);return files;
 }
 const overview=initial(entries[0]),pages=initial(entries[1]);
 assert.ok(overview.has('src/components/workspace/Overview.tsx'));assert.ok(!overview.has('src/components/workspace/Records.tsx'));assert.ok(!overview.has('src/components/workspace/CMS.tsx'));
 assert.ok(pages.has('src/components/workspace/CMS.tsx'));assert.ok(!pages.has('src/components/workspace/Overview.tsx'));
 for(const set of [overview,pages])for(const feature of ['Workspace','StaffManagement','SiteSettings','LiveMonitoring','ProductEditor','ProductWorkspace','AutomationRules'])assert.ok(!set.has(`src/components/workspace/${feature}.tsx`),`${feature} is not part of an unrelated feature entry.`);
 assert.ok(Object.values(outputs).some(output=>output.entryPoint==='src/components/workspace/Records.tsx'),'The real record dialog remains reachable as its dynamic feature.');
});
