import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {bindNavigationScroll}=await loadTs('src/lib/navigation-scroll.ts');
const {lockDocumentScroll}=await loadTs('src/components/ui/dialog-runtime.ts');

class Scope extends EventTarget {
 listeners=new Map();
 addEventListener(type,fn,options){super.addEventListener(type,fn,options);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(fn);}
 removeEventListener(type,fn,options){super.removeEventListener(type,fn,options);this.listeners.get(type)?.delete(fn);}
 get count(){return [...this.listeners.values()].reduce((sum,list)=>sum+list.size,0);}
}
function fixture(path='/fa/products/'){
 const doc=new Scope(),view=new Scope(),frames=new Map(),scrolls=[];
 let id=0;
 const bodyStyle={position:'',top:'',left:'',right:'',width:'',overflow:'',paddingRight:''};
 const htmlStyle={overflow:'',scrollBehavior:'smooth'};
 doc.body={style:bodyStyle};doc.documentElement={style:htmlStyle,clientWidth:390};doc.defaultView=view;
 view.location=new URL(path,'https://factory.test');view.scrollX=0;view.scrollY=3600;view.innerWidth=390;
 view.getComputedStyle=()=>({paddingRight:'0'});
 view.scrollTo=value=>{assert.equal(htmlStyle.scrollBehavior,'auto');scrolls.push(value);view.scrollX=value.left;view.scrollY=value.top;};
 view.requestAnimationFrame=fn=>{frames.set(++id,fn);return id;};view.cancelAnimationFrame=key=>frames.delete(key);
 const binding=bindNavigationScroll(doc);
 const frame=()=>{const current=[...frames.values()];frames.clear();current.forEach(fn=>fn());};
 const url=path=>{view.location=new URL(path,'https://factory.test');};
 const click=(href,values={})=>{
  const anchor={href,target:values.target||'',hasAttribute:name=>name==='download'&&!!values.download};
  const event=new Event('click',{cancelable:true,bubbles:true});
  for(const [key,value] of Object.entries({button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,...values,target:{closest:()=>anchor}}))Object.defineProperty(event,key,{value});
  doc.dispatchEvent(event);
 };
 return {doc,view,binding,bodyStyle,htmlStyle,scrolls,frames,frame,url,click,
  flush:()=>{frame();frame();},destroy:()=>{binding.destroy();assert.equal(frames.size,0);assert.equal(doc.count,0);assert.equal(view.count,0);},
 };
}

test('navigation from a scrolled modal to home never restores the previous page position',()=>{
 const f=fixture();const release=lockDocumentScroll(f.doc);
 assert.equal(f.bodyStyle.top,'-3600px');
 f.url('/fa/');f.binding.commit('/fa/');release();
 assert.deepEqual(f.scrolls,[],'unlock must not restore the source page on a new route');
 f.flush();assert.deepEqual(f.scrolls,[{left:0,top:0,behavior:'instant'}]);assert.equal(f.bodyStyle.position,'');f.destroy();
});

test('closing before route commit and same-page close both preserve the right final position',()=>{
 const f=fixture();const release=lockDocumentScroll(f.doc);release();
 assert.equal(f.scrolls.at(-1).top,3600,'ordinary close restores its exact page position');
 f.url('/fa/');f.binding.commit('/fa/');f.flush();assert.equal(f.scrolls.at(-1).top,0);f.destroy();
});

test('reselecting home while already on it scrolls to top after drawer cleanup in every locale',()=>{
 for(const path of ['/','/fa/','/ar/','/en/','/tr/','/ru/']){
  const f=fixture(path),release=lockDocumentScroll(f.doc);
  f.click(path);release();assert.equal(f.scrolls.at(-1).top,3600);
  f.frame();assert.equal(f.scrolls.at(-1).top,3600,'wait until the dialog cleanup has completed');
  f.frame();assert.equal(f.scrolls.at(-1).top,0);f.destroy();
 }
});

test('back and forward history keep native restoration, and fragment links keep their anchor',()=>{
 const f=fixture();f.url('/fa/research/');f.view.dispatchEvent(new Event('popstate'));f.binding.commit('/fa/research/');f.flush();assert.deepEqual(f.scrolls,[]);
 f.url('/fa/');f.view.dispatchEvent(new Event('popstate'));f.binding.commit('/fa/');f.flush();assert.deepEqual(f.scrolls,[]);
 f.url('/fa/resources/#catalogue');f.binding.commit('/fa/resources/');f.flush();assert.deepEqual(f.scrolls,[]);
 f.url('/fa/');f.click('/fa/#products');f.flush();assert.deepEqual(f.scrolls,[]);f.destroy();
});

test('nested dialogs cannot restore stale coordinates after navigation when the final lock closes',()=>{
 const f=fixture(),outer=lockDocumentScroll(f.doc),inner=lockDocumentScroll(f.doc);
 f.url('/en/');outer();assert.equal(f.bodyStyle.position,'fixed');assert.deepEqual(f.scrolls,[]);
 inner();inner();assert.equal(f.bodyStyle.position,'');assert.deepEqual(f.scrolls,[]);f.destroy();
});

test('rapid navigation, user scroll, fragment change and unmount cancel stale scheduled resets',()=>{
 const f=fixture();f.url('/fa/research/');f.binding.commit('/fa/research/');f.frame();
 f.url('/fa/');f.binding.commit('/fa/');f.flush();assert.deepEqual(f.scrolls,[{left:0,top:0,behavior:'instant'}]);
 f.click('/fa/');f.doc.dispatchEvent(new Event('wheel'));f.flush();assert.equal(f.scrolls.length,1);
 f.click('/fa/');f.doc.dispatchEvent(new Event('touchmove'));f.flush();assert.equal(f.scrolls.length,1);
 f.click('/fa/');f.url('/fa/#products');f.view.dispatchEvent(new Event('hashchange'));f.flush();assert.equal(f.scrolls.length,1);
 f.url('/fa/');f.click('/fa/');f.destroy();f.flush();assert.equal(f.scrolls.length,1);
});

test('modified clicks, downloads, new tabs and external links cannot reset the current page',()=>{
 const f=fixture('/fa/');
 for(const values of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{download:true},{target:'_blank'}])f.click('/fa/',values);
 f.click('https://elsewhere.test/fa/');f.click('/fa/products/');f.flush();assert.deepEqual(f.scrolls,[]);f.destroy();
});
