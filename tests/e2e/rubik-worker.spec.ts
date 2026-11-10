import {test,expect} from '@playwright/test';

test('the real cube worker presents the preserved scene and accepts native keyboard input while page controls stay usable',async({page})=>{
 test.setTimeout(90000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const browser=window as typeof window&{__rubikMessages:string[]};browser.__rubikMessages=[];
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   constructor(url:string|URL,options?:WorkerOptions){
    super(url,options);
    if(options?.name==='idealmakoo-rubik')this.addEventListener('message',event=>{if(typeof event.data?.type==='string')browser.__rubikMessages.push(event.data.type);});
   }
  };
 });
 await page.goto('/fa/manufacturing/');
 const scene=page.locator('[data-variant="rubik"]'),canvas=scene.locator('canvas');
 await scene.scrollIntoViewIfNeeded();await expect(scene).toHaveAttribute('data-scene-state','ready',{timeout:60000});
 await expect.poll(()=>page.evaluate(()=>{
  const source=document.querySelector<HTMLCanvasElement>('[data-variant="rubik"] canvas');if(!source)return false;
  const sample=document.createElement('canvas');sample.width=sample.height=8;
  const context=sample.getContext('2d');if(!context)return false;
  context.drawImage(source,0,0,8,8);
  return [...context.getImageData(0,0,8,8).data].some((value,index)=>index%4===3&&value>0);
 }),{timeout:15000}).toBe(true);
 expect(await page.evaluate(()=>(window as typeof window&{__rubikMessages:string[]}).__rubikMessages.filter(type=>type==='ready').length)).toBe(1);
 await expect(canvas).toHaveAttribute('tabindex','0');await expect(canvas).toHaveAttribute('aria-hidden','false');
 await canvas.focus();expect(await canvas.evaluate(element=>document.activeElement===element)).toBe(true);await page.keyboard.press('ArrowRight');
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{__rubikMessages:string[]}).__rubikMessages.filter(type=>type==='input-ack').length),{timeout:15000}).toBeGreaterThan(0);
 const toggle=page.locator('.theme-language > button').first(),before=await page.locator('html').getAttribute('data-theme');
 await toggle.click();await expect(page.locator('html')).not.toHaveAttribute('data-theme',before||'dark');
 await toggle.click();await expect(page.locator('html')).toHaveAttribute('data-theme',before||'dark');
 await expect(scene).toHaveAttribute('data-scene-state','ready');expect(errors).toEqual([]);
});

test('cube worker failure after transfer remounts a fresh accessible canvas and preserves the main-thread fallback',async({page})=>{
 test.setTimeout(90000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const browser=window as typeof window&{__rubikFaults:number;__rubikConsumed?:HTMLCanvasElement};browser.__rubikFaults=0;
  const nativeTransfer=HTMLCanvasElement.prototype.transferControlToOffscreen;
  HTMLCanvasElement.prototype.transferControlToOffscreen=function(){
   if(this.closest('[data-variant="rubik"]'))browser.__rubikConsumed=this;
   return nativeTransfer.call(this);
  };
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   private failAfterTransfer:boolean;
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.failAfterTransfer=options?.name==='idealmakoo-rubik';}
   postMessage(message:unknown,options?:Transferable[]|StructuredSerializeOptions){
    if(Array.isArray(options))super.postMessage(message,options);else super.postMessage(message,options);
    if(this.failAfterTransfer&&(message as {type?:string})?.type==='init'){
     this.failAfterTransfer=false;browser.__rubikFaults++;
     queueMicrotask(()=>this.dispatchEvent(new ErrorEvent('error',{message:'Intentional cube worker lifecycle test',cancelable:true})));
    }
   }
  };
 });
 await page.goto('/fa/manufacturing/');
 const scene=page.locator('[data-variant="rubik"]'),canvas=scene.locator('canvas');
 await scene.scrollIntoViewIfNeeded();await expect(scene).toHaveAttribute('data-scene-state','ready',{timeout:60000});
 expect(await page.evaluate(()=>{
  const browser=window as typeof window&{__rubikFaults:number;__rubikConsumed?:HTMLCanvasElement};
  return {failures:browser.__rubikFaults,replaced:!!browser.__rubikConsumed&&document.querySelector('[data-variant="rubik"] canvas')!==browser.__rubikConsumed,oldDetached:!browser.__rubikConsumed?.isConnected};
 })).toEqual({failures:1,replaced:true,oldDetached:true});
 await expect(canvas).toHaveAttribute('tabindex','0');await expect(canvas).toHaveAttribute('aria-hidden','false');await expect(canvas).toHaveAttribute('role','img');
 await canvas.focus();expect(await canvas.evaluate(element=>document.activeElement===element)).toBe(true);
 await page.keyboard.press('ArrowRight');await expect(scene).toHaveAttribute('data-scene-state','ready');
 expect(errors).toEqual([]);
});
