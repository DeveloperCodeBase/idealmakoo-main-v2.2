import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const require=createRequire(import.meta.url);
const {isValidElement}=require('react');
const {getSortedRoutes}=require('next/dist/shared/lib/router/utils/sorted-routes');
const {getRouteRegex}=require('next/dist/shared/lib/router/utils/route-regex');
const {getRouteMatcher}=require('next/dist/shared/lib/router/utils/route-matcher');
const root=fileURLToPath(new URL('../',import.meta.url));
const appRoot=path.join(root,'src/app');
const {sitePaths}=await loadTs('src/lib/routes.ts');
const {locales}=await loadTs('src/lib/i18n.ts');

// Exercise the actual entry modules and Next's installed path matcher. Client
// components are opaque React element types here; full DOM, auth and database
// behavior remains the responsibility of the browser and integration suites.
function compile(source,resolveImport){
  const exports={};
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','exports',output)(resolveImport,exports);
  return exports;
}
const source=readFileSync(path.join(root,'src/server/public-page.tsx'),'utf8');
const sourceFile=ts.createSourceFile('public-page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const prefixNode=sourceFile.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='withPublicPrefix');
assert.ok(prefixNode,'The common path adapter must exist.');
const {withPublicPrefix}=compile(prefixNode.getText(sourceFile),()=>{throw new Error('The path adapter must not import another module.');});
const componentModules=new Map();
function componentImport(specifier){
  if(specifier==='server-only')return{};
  if(specifier==='react/jsx-runtime')return require(specifier);
  if(!specifier.startsWith('@/components/'))throw new Error('Unexpected route dependency: '+specifier);
  if(!componentModules.has(specifier))componentModules.set(specifier,new Proxy({__esModule:true},{get(target,key){
    if(key==='__esModule')return true;
    if(!(key in target)){
      const component=()=>null;
      component.routeComponentName=key==='default'?specifier.split('/').at(-1):key;
      target[key]=component;
    }
    return target[key];
  }}));
  return componentModules.get(specifier);
}
const PublicRoute=compile(readFileSync(path.join(root,'src/components/site/PublicRoute.tsx'),'utf8'),componentImport).default;
const workspaceSource=readFileSync(path.join(root,'src/server/workspace-route.tsx'),'utf8');
const workspaceRoute=compile(workspaceSource,componentImport);
assert.equal(typeof workspaceRoute.renderWorkspaceRoute,'function','Execute the actual server workspace adapter.');
const shared={
  withPublicPrefix,
  generatePublicMetadata:async({params})=>({received:await params}),
  renderPublicPage:async({params},render)=>{const received=await params;return{received,element:render(received.slug||[])};},
};
const entries=new Map();
const entrySources=new Map();
function collect(directory){
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const full=path.join(directory,entry.name);
    if(entry.isDirectory())collect(full);
    else if(entry.name==='page.tsx'){
      const pattern='/'+path.relative(appRoot,path.dirname(full)).split(path.sep).join('/');
      const entrySource=readFileSync(full,'utf8');entrySources.set(pattern,entrySource);
      entries.set(pattern,compile(entrySource,specifier=>specifier==='@/server/public-page'?shared:specifier==='@/server/workspace-route'?workspaceRoute:specifier==='@/components/site/PublicRoute'?{__esModule:true,default:PublicRoute}:componentImport(specifier)));
    }
  }
}
collect(path.join(appRoot,'[locale]'));
const sorted=getSortedRoutes([...entries.keys()]);
const matchers=sorted.map(pattern=>({pattern,match:getRouteMatcher(getRouteRegex(pattern))}));
function route(url){
  for(const {pattern,match}of matchers){const params=match(url);if(params)return{pattern,module:entries.get(pattern),params};}
  throw new Error('No route for '+url);
}
function normalize(element){
  if(element===null)return null;
  if(element.type===PublicRoute)return normalize(PublicRoute(element.props));
  assert.equal(typeof element.type.routeComponentName,'string');
  return{component:element.type.routeComponentName,props:Object.fromEntries(Object.entries(element.props).filter(([,value])=>value!==undefined).map(([key,value])=>[key,isValidElement(value)?normalize(value):value]).sort(([a],[b])=>a.localeCompare(b)))};
}
const extraPaths=['products/reviewed-product','research/reviewed-article','resources/restricted-manual','news/reviewed-story','page/reviewed-page','custom/nested-page','account/requests/test-owned-request','admin/overview','admin/pages/test-nested-route','admin/reports','admin/crm/reports'];
const measuredPaths=[...new Set([...sitePaths,...extraPaths])];
function expectedPrivate(segments){
  const section=segments.slice(1).join('/');
  if(segments[0]==='admin')return{component:'Workspace',props:{section,...(section===''?{body:{component:'WorkspaceOverviewEntry',props:{}}}:section==='pages'?{body:{component:'WorkspacePagesEntry',props:{}}}:{})}};
  if(segments[0]==='account')return{component:'AccountPortal',props:{section,...(segments[1]==='requests'?{body:{component:'AccountRequestsEntry',props:{section}}}:{})}};
  return undefined;
}
function imports(source){
  return ts.createSourceFile('entry.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX).statements.filter(ts.isImportDeclaration).filter(node=>!node.importClause?.isTypeOnly).map(node=>node.moduleSpecifier.text);
}

test('Next accepts separate homepage, fixed routes and the required custom-path fallback',()=>{
  assert.ok(entries.has('/[locale]'));
  assert.ok(entries.has('/[locale]/[...slug]'));
  assert.ok(!entries.has('/[locale]/[[...slug]]'));
  assert.ok(entries.has('/[locale]/admin'));
  assert.ok(entries.has('/[locale]/admin/[...slug]'));
  assert.ok(!entries.has('/[locale]/admin/[[...slug]]'));
  assert.ok(entries.has('/[locale]/admin/pages'));
  assert.ok(entries.has('/[locale]/account/requests/[[...slug]]'));
  assert.equal(sorted.length,entries.size);
  for(const locale of locales)for(const suffix of measuredPaths)assert.ok(route('/'+locale+(suffix?'/'+suffix:'')));
  for(const locale of locales)for(const [suffix,pattern]of [['admin','/[locale]/admin'],['admin/','/[locale]/admin'],['admin/pages','/[locale]/admin/pages'],['admin/pages/test-nested-route','/[locale]/admin/[...slug]'],['admin/overview','/[locale]/admin/[...slug]'],['account','/[locale]/account/[[...slug]]'],['account/security','/[locale]/account/[[...slug]]'],['account/requests','/[locale]/account/requests/[[...slug]]'],['account/requests/','/[locale]/account/requests/[[...slug]]'],['account/requests/test-owned-request','/[locale]/account/requests/[[...slug]]']])assert.equal(route('/'+locale+'/'+suffix).pattern,pattern,locale+'/'+suffix);
});

test('every public or private entry selects the same component and props as the established route contract',async()=>{
  for(const locale of locales)for(const suffix of measuredPaths){
    const segments=suffix?suffix.split('/'):[];
    const selected=route('/'+locale+(suffix?'/'+suffix:''));
    const actual=await selected.module.default({params:Promise.resolve(selected.params)});
    const expected=expectedPrivate(segments)??(segments[0]==='auth'?{component:'AuthPage',props:{mode:segments[1]||'login'}}:normalize(PublicRoute({segments})));
    assert.deepEqual(normalize(actual.element),expected,locale+'/'+suffix);
  }
});

test('private entries serialize only the selected code reference and the existing full section',async()=>{
  const expectedImports={
    '/[locale]/admin':['@/components/workspace/WorkspaceOverviewEntry'],
    '/[locale]/admin/pages':['@/components/workspace/WorkspacePagesEntry'],
    '/[locale]/admin/[...slug]':[],
    '/[locale]/account/requests/[[...slug]]':['@/components/account/AccountPortal','@/components/account/AccountRequestsEntry'],
  };
  assert.deepEqual(imports(workspaceSource).filter(value=>value.startsWith('@/')),['@/components/workspace/Workspace'],'The real server adapter imports code only, with no server identity or private-data dependency.');
  for(const [pattern,expected]of Object.entries(expectedImports))assert.deepEqual(imports(entrySources.get(pattern)).filter(value=>value.startsWith('@/components/')),expected,pattern);
  for(const locale of locales)for(const suffix of ['admin','admin/pages','admin/reports','admin/crm/reports','admin/overview','account/requests','account/requests/test-owned-request']){
    const selected=route('/'+locale+'/'+suffix);const actual=await selected.module.default({params:Promise.resolve(selected.params)});
    const normalized=normalize(actual.element);assert.deepEqual(normalized,expectedPrivate(suffix.split('/')));
    assert.deepEqual(Object.keys(actual.element.props).filter(key=>actual.element.props[key]!==undefined).sort(),normalized.props.body?['body','section']:['section']);
    if(actual.element.props.body){
      assert.ok(isValidElement(actual.element.props.body));
      assert.deepEqual(Object.keys(actual.element.props.body.props),suffix.startsWith('account/')?['section']:[],'Feature references contain no session, actor, CSRF, records or store props.');
    }
    if(suffix==='admin/reports'||suffix==='admin/crm/reports')assert.equal(actual.element.props.body,undefined,'Reports retain the existing dispatcher rather than selecting the overview.');
  }
});

test('non-admin and existing account routes retain their original selection without a private feature slot',async()=>{
  for(const [pattern,entrySource]of entrySources){
    if(!pattern.startsWith('/[locale]/admin'))assert.ok(!imports(entrySource).includes('@/server/workspace-route'),pattern);
  }
  for(const locale of locales)for(const suffix of measuredPaths.filter(value=>!value.startsWith('admin')&&!value.startsWith('account/requests'))){
    const segments=suffix?suffix.split('/'):[];const selected=route('/'+locale+(suffix?'/'+suffix:''));
    const actual=await selected.module.default({params:Promise.resolve(selected.params)});
    if(segments[0]==='account'){
      assert.deepEqual(normalize(actual.element),{component:'AccountPortal',props:{section:segments.slice(1).join('/')}});
      assert.equal(actual.element.props.body,undefined);
    }else if(segments[0]==='auth'){
      assert.deepEqual(normalize(actual.element),{component:'AuthPage',props:{mode:segments[1]||'login'}},locale+'/'+suffix);
      assert.deepEqual(Object.keys(actual.element.props),['mode'],'Auth content is a code reference with only the raw route mode, never form values, actor data or session credentials.');
    }else assert.deepEqual(normalize(actual.element),normalize(PublicRoute({segments})),locale+'/'+suffix);
  }
});

test('metadata and the access handler receive the identical complete path including capability and private routes',async()=>{
  const capabilities=['saved-share/'+ 'a'.repeat(64),'feedback/'+'b'.repeat(64),'communication-preferences/'+'c'.repeat(64),'communication-verification/'+'d'.repeat(64),'communication-verification/device'];
  for(const locale of locales)for(const suffix of [...measuredPaths,...capabilities]){
    const selected=route('/'+locale+(suffix?'/'+suffix:''));
    const expected={locale,slug:suffix?suffix.split('/'):[]};
    const props={params:Promise.resolve(selected.params)};
    const page=await selected.module.default(props);
    const metadata=await selected.module.generateMetadata(props);
    for(const received of [page.received,metadata.received])assert.deepEqual({...received,slug:received.slug||[]},expected,locale+'/'+suffix);
  }
});
