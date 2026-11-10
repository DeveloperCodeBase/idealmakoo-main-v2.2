import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import {build} from 'esbuild';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const projectRoot=fileURLToPath(new URL('../',import.meta.url));
const {editablePublicTargets}=await loadTs('src/lib/site-targets.ts');
const compatibility=await loadTs('src/lib/site-content.ts');
const {createEmptyWorkspaceState,createWorkspaceSettings}=await loadTs('src/data/workspace-defaults.ts');
const {createWorkspaceSeed}=await loadTs('src/data/workspace-seed.ts');
const collections=['records','pages','media','audit','aiJobs','forms'];

function actualStoreInitializer(context){
 const file='src/components/workspace/store.ts';
 const source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const hook=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='useWorkspaceStore');
 assert.ok(hook?.body,'Exercise the actual workspace hook initializer.');
 const declarations=hook.body.statements.filter(ts.isVariableStatement).flatMap(node=>[...node.declarationList.declarations]);
 const factory=declarations.find(node=>ts.isIdentifier(node.name)&&node.name.text==='emptyState');
 const state=declarations.find(node=>ts.isArrayBindingPattern(node.name)&&node.name.elements[0]?.name?.getText(source)==='rawState');
 assert.ok(factory?.initializer&&state?.initializer);
 assert.equal(state.initializer.expression?.getText(source),'useState');
 assert.equal(state.initializer.arguments?.[0]?.getText(source),'emptyState','The tested factory must initialize the actual state.');
 const code=ts.transpileModule('exports.initialize='+factory.initializer.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const exports={};runInNewContext(code,{exports,...context},{timeout:1000});
 return exports.initialize;
}

test('the public registry retains its ordered editorial contract and CMS export identity',()=>{
 assert.strictEqual(compatibility.editablePublicTargets,editablePublicTargets);
 assert.deepEqual(editablePublicTargets.map(target=>target.slug),[
  'home','about','mission','goals','strategy','positioning','segmentation','development','pricing-policy','marketing-training','contact',
  'manufacturing','quality','sustainability','global','faq','glossary','knowledge','privacy','terms','for/dentist','for/lab','for/dealer','for/research',
 ]);
 assert.equal(editablePublicTargets[0].mode,'home');
 for(const target of editablePublicTargets){
  assert.deepEqual(Object.keys(target.title),['fa','en','tr','ar','ru']);
  for(const locale of ['fa','en','tr','ar','ru'])assert.ok(target.title[locale].trim(),target.slug+' '+locale);
  if(target.slug!=='home')assert.equal(target.mode,'replace');
 }
});

test('the real light entry graphs exclude draft factories and the runtime demo seed',async()=>{
 const registry=await build({absWorkingDir:projectRoot,entryPoints:['src/lib/site-targets.ts'],bundle:true,write:false,metafile:true,format:'esm',platform:'browser',logLevel:'silent'});
 const inputs=Object.keys(registry.metafile.inputs).map(file=>file.replaceAll('\\','/'));
 for(const suffix of ['src/lib/site-content.ts','src/lib/site-source-drafts.ts','src/lib/company-source-drafts.ts','src/data/company-page-copy.ts','src/data/policy-page-copy.ts','src/data/editorial-page-copy.ts','src/data/faq-content.ts','src/data/workspace-seed.ts'])assert.ok(!inputs.some(file=>file.endsWith(suffix)),`The public registry must not pull in ${suffix}`);
 assert.ok(inputs.some(file=>file.endsWith('src/data/catalog.ts')));
 const empty=await build({absWorkingDir:projectRoot,entryPoints:['src/data/workspace-defaults.ts'],bundle:true,write:false,metafile:true,format:'esm',platform:'browser',logLevel:'silent'});
 assert.deepEqual(Object.keys(empty.metafile.inputs).map(file=>file.replaceAll('\\','/')),['src/data/workspace-defaults.ts'],'The seed type reference must stay type-only.');
 const application=ts.createSourceFile('Application.tsx',readFileSync(new URL('../src/components/Application.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const importNode=application.statements.find(node=>ts.isImportDeclaration(node)&&node.importClause?.namedBindings&&ts.isNamedImports(node.importClause.namedBindings)&&node.importClause.namedBindings.elements.some(item=>item.name.text==='editablePublicTargets'));
 assert.equal(importNode?.moduleSpecifier?.text,'@/lib/site-targets','The actual Application must use the light entry.');
});

test('the production empty state preserves the previous seed projection and exact defaults',()=>{
 const oldProjection={...createWorkspaceSeed(),records:[],pages:[],media:[],forms:[],aiJobs:[],audit:[]};
 assert.deepEqual(createEmptyWorkspaceState(),oldProjection);
 assert.deepEqual(createWorkspaceSettings(),{name:'Ideal Makoo',apiUrl:'/api/v1',defaultLocale:'fa',compact:false,email:'info@idealmakoo.com'});
});

test('each production state and demo seed owns fresh collections and settings',()=>{
 const first=createEmptyWorkspaceState(),second=createEmptyWorkspaceState(),demo=createWorkspaceSeed();
 for(const collection of collections){
  assert.notStrictEqual(first[collection],second[collection]);
  assert.notStrictEqual(first[collection],demo[collection]);
  first[collection].push({id:'test_only_mutation'});
  assert.deepEqual(second[collection],[]);
 }
 assert.notStrictEqual(first.settings,second.settings);
 assert.notStrictEqual(first.settings,demo.settings);
 first.settings.compact=true;first.settings.name='test_only_mutation';
 assert.equal(second.settings.compact,false);assert.equal(demo.settings.name,'Ideal Makoo');
 const settings=createWorkspaceSettings();settings.apiUrl='/test-only';
 assert.equal(createWorkspaceSettings().apiUrl,'/api/v1');
});

test('the actual production hook initializer does not call the demo factory',()=>{
 let emptyCalls=0;
 const initialize=actualStoreInitializer({demoMode:false,createWorkspaceSeed:()=>{throw new Error('Production must not allocate the demo seed.');},createEmptyWorkspaceState:()=>{emptyCalls++;return createEmptyWorkspaceState();}});
 const first=initialize(),second=initialize();
 assert.deepEqual(first,createEmptyWorkspaceState());assert.deepEqual(second,first);assert.notStrictEqual(second,first);
 assert.equal(emptyCalls,2);
});

test('the actual demo hook initializer still returns the complete demo factory result',()=>{
 const expected=createWorkspaceSeed();let seedCalls=0;
 const initialize=actualStoreInitializer({demoMode:true,createWorkspaceSeed:()=>{seedCalls++;return expected;},createEmptyWorkspaceState:()=>{throw new Error('Demo must retain its full seed.');}});
 assert.strictEqual(initialize(),expected);assert.equal(seedCalls,1);
 assert.ok(expected.records.length&&expected.pages.length&&expected.media.length&&expected.forms.length);
});
