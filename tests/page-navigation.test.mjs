import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const {guardedPageDestination}=await loadTs('src/components/workspace/page-navigation.ts');
const {L,localized}=await loadTs('src/components/workspace/i18n.ts');
const currentHref='https://factory.test/en/admin/pages/?id=PAGE-first#editor';
const click={href:'/en/admin/products/',currentHref,button:0};

test('ordinary internal links and another document query are guarded',()=>{
 assert.equal(guardedPageDestination(click),'https://factory.test/en/admin/products/');
 assert.equal(guardedPageDestination({...click,href:'?id=PAGE-second#content'}),'https://factory.test/en/admin/pages/?id=PAGE-second#content');
 assert.equal(guardedPageDestination({...click,target:'_self'}),'https://factory.test/en/admin/products/');
});

test('same-document navigation does not interrupt the editor',()=>{
 for(const href of ['#content','',currentHref,'/en/admin/pages/?id=PAGE-first','/en/admin/pages/?id=PAGE-first#other'])assert.equal(guardedPageDestination({...click,href}),null,href);
});

test('downloads, separate browsing contexts and modifier clicks retain their native behavior',()=>{
 for(const override of [{download:true},{target:'_blank'},{target:'documents'},{target:'_parent'},{target:'_top'},{button:1},{button:2},{altKey:true},{ctrlKey:true},{metaKey:true},{shiftKey:true},{defaultPrevented:true}])assert.equal(guardedPageDestination({...click,...override}),null,JSON.stringify(override));
});

test('only checked same-origin web destinations reach the router, including unusual pathnames',()=>{
 for(const href of ['https://elsewhere.test/','//elsewhere.test/path','mailto:help@factory.test','javascript:alert(1)','data:text/html,hello','blob:https://factory.test/example','https://user:secret@factory.test/','http://factory.test/en/admin/products/'])assert.equal(guardedPageDestination({...click,href}),null,href);
 const unusual=guardedPageDestination({...click,href:'https://factory.test//elsewhere.test/path'});
 assert.equal(unusual,'https://factory.test//elsewhere.test/path');
 assert.equal(new URL(unusual,currentHref).origin,new URL(currentHref).origin,'A double-slash pathname must not become a different host after validation.');
});

// Execute the actual mounted guard with a tiny DOM/hook boundary. The routing,
// event handler and dialog button handlers are application source, not replicas.
function mountGuard(){
 const file='src/components/workspace/PageNavigationGuard.tsx',source=ts.createSourceFile(file,readFileSync(new URL('../'+file,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const declarations=source.statements.filter(node=>ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>value.name.getText(source)==='copy'));
 const component=source.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='PageNavigationGuard');assert.ok(component);
 const code=declarations.map(node=>node.getText(source)).join('\n')+'\nexport const guard='+component.getText(source).replace(/^export default\s+/,'');
 let destination=null,ref,handler,cleanup,mounted=false,pending=false,props={dirty:false,busy:false,locale:'en'};const navigations=[];
 class Node {parentElement=null;}
 class Element extends Node {closest(){return this.anchor??null;}}
 const anchor={href:click.href,getAttribute:()=>null,hasAttribute:()=>false};
 const document={addEventListener:(name,listener,capture)=>{assert.equal(name,'click');assert.equal(capture,true);handler=listener;},removeEventListener:(name,listener,capture)=>{assert.equal(name,'click');assert.equal(listener,handler);assert.equal(capture,true);handler=null;}};
 const exports={};runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:createRequire(import.meta.url),L,localized,guardedPageDestination,Element,Node,document,window:{location:{href:currentHref}},useRouter:()=>({push:href=>navigations.push(href)}),useState:()=>[destination,value=>{destination=value;}],useRef:value=>ref??(ref={current:value}),useEffect:effect=>{if(!mounted){mounted=true;cleanup=effect();}},Modal:()=>null});
 return {
  render(changes={}){props={...props,...changes};return exports.guard({...props,isPending:()=>pending});},
  pending(value){pending=value;},navigations,
  click(){const target=new Element();target.anchor=anchor;const event={target,button:0,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;}};handler(event);return event;},
  unmount(){cleanup();assert.equal(handler,null);},
 };
}
function buttons(tree){return tree.props.children.props.children[1].props.children;}

test('cancelling a dirty link stays in the editor and acknowledged clean navigation proceeds',()=>{
 const guard=mountGuard();assert.equal(guard.render(),null);assert.equal(guard.click().defaultPrevented,false);
 guard.render({dirty:true});const event=guard.click();assert.equal(event.defaultPrevented,true);assert.equal(event.stopped,true);
 let dialog=guard.render();assert.equal(dialog.props.title,'Leave the page editor');assert.equal(buttons(dialog)[0].props.children,'Stay on page');
 buttons(dialog)[0].props.onClick();assert.equal(guard.render(),null);assert.deepEqual(guard.navigations,[]);
 assert.equal(guard.click().defaultPrevented,true,'Cancel did not clear the caller’s dirty state.');
 dialog=guard.render({dirty:false});assert.equal(buttons(dialog)[1].props.children,'Continue to selected page');buttons(dialog)[1].props.onClick();
 assert.deepEqual(guard.navigations,['https://factory.test/en/admin/products/']);assert.equal(guard.render(),null);assert.equal(guard.click().defaultPrevented,false);guard.unmount();
});

test('an operation awaiting acknowledgement blocks leave even before a busy render',()=>{
 const guard=mountGuard();guard.render({dirty:true});guard.pending(true);
 assert.equal(guard.click().defaultPrevented,true);let dialog=guard.render();assert.equal(buttons(dialog)[1].props.disabled,true);
 buttons(dialog)[1].props.onClick();assert.deepEqual(guard.navigations,[]);
 guard.pending(false);dialog=guard.render({busy:true});buttons(dialog)[1].props.onClick();assert.deepEqual(guard.navigations,[]);
 dialog=guard.render({busy:false});assert.equal(buttons(dialog)[1].props.disabled,false);assert.equal(buttons(dialog)[1].props.children,'Discard changes and leave');buttons(dialog)[1].props.onClick();
 assert.deepEqual(guard.navigations,['https://factory.test/en/admin/products/']);guard.unmount();
});
