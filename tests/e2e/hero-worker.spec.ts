import {test,expect} from '@playwright/test';

test('the real rendering worker presents frames and handles keyboard input while the page controls remain usable',async({page})=>{
 test.setTimeout(90000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const browser=window as typeof window&{__heroMessages:string[];__heroReadyPixels:number[][]};browser.__heroMessages=[];browser.__heroReadyPixels=[];
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   constructor(url:string|URL,options?:WorkerOptions){
    super(url,options);
    if(options?.name==='idealmakoo-hero')this.addEventListener('message',event=>{if(typeof event.data?.type==='string')browser.__heroMessages.push(event.data.type);});
   }
  };
  const seen=new WeakSet<HTMLCanvasElement>();
  new MutationObserver(()=>{
   const canvas=document.querySelector<HTMLCanvasElement>('[data-variant="hero"][data-scene-state="ready"] canvas');
   if(!canvas||seen.has(canvas))return;seen.add(canvas);
   const sample=document.createElement('canvas');sample.width=sample.height=1;
   try{const context=sample.getContext('2d')!;context.drawImage(canvas,0,0,1,1);browser.__heroReadyPixels.push([...context.getImageData(0,0,1,1).data]);}
   catch{browser.__heroReadyPixels.push([]);}
  }).observe(document,{subtree:true,attributes:true,attributeFilter:['data-scene-state']});
 });
 await page.goto('/fa/');
 const scene=page.locator('[data-variant="hero"]'),canvas=scene.locator('canvas');
 await expect(scene).toHaveAttribute('data-scene-state','ready',{timeout:60000});
 expect(await page.evaluate(()=>(window as typeof window&{__heroReadyPixels:number[][]}).__heroReadyPixels[0]?.[3])).toBe(255);
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{__heroMessages:string[]}).__heroMessages.filter(type=>type==='presentation').length),{timeout:15000}).toBeGreaterThan(0);
 await canvas.focus();await page.keyboard.press('ArrowUp');
 await expect.poll(()=>page.evaluate(()=>(window as typeof window&{__heroMessages:string[]}).__heroMessages.filter(type=>type==='input-ack').length),{timeout:15000}).toBeGreaterThan(0);
 const toggle=page.locator('.theme-language > button').first(),before=await page.locator('html').getAttribute('data-theme');
 await toggle.click();await expect(page.locator('html')).not.toHaveAttribute('data-theme',before||'dark');
 await toggle.click();await expect(page.locator('html')).toHaveAttribute('data-theme',before||'dark');
 await expect(scene).toHaveAttribute('data-scene-state','ready');await expect(canvas).toHaveAttribute('tabindex','0');
 expect(errors).toEqual([]);
});

test('failure after canvas transfer remounts a fresh accessible React canvas and restores the same scene on the main thread',async({page})=>{
 test.setTimeout(90000);
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{
  const browser=window as typeof window&{__heroFaults:number;__consumedCanvas?:HTMLCanvasElement};browser.__heroFaults=0;
  const originalTransfer=HTMLCanvasElement.prototype.transferControlToOffscreen;
  HTMLCanvasElement.prototype.transferControlToOffscreen=function(){browser.__consumedCanvas=this;return originalTransfer.call(this);};
  const NativeWorker=window.Worker;
  window.Worker=class extends NativeWorker{
   private failAfterTransfer:boolean;
   constructor(url:string|URL,options?:WorkerOptions){super(url,options);this.failAfterTransfer=options?.name==='idealmakoo-hero';}
   postMessage(message:unknown,options?:Transferable[]|StructuredSerializeOptions){
    if(Array.isArray(options))super.postMessage(message,options);else super.postMessage(message,options);
    if(this.failAfterTransfer&&(message as {type?:string})?.type==='init'){
     this.failAfterTransfer=false;browser.__heroFaults++;
     queueMicrotask(()=>this.dispatchEvent(new ErrorEvent('error',{message:'Intentional worker lifecycle test',cancelable:true})));
    }
   }
  };
 });
 await page.goto('/fa/');
 const scene=page.locator('[data-variant="hero"]'),canvas=scene.locator('canvas');
 await expect(scene).toHaveAttribute('data-scene-state','ready',{timeout:60000});
 expect(await page.evaluate(()=>{
  const browser=window as typeof window&{__heroFaults:number;__consumedCanvas?:HTMLCanvasElement};
  return {failures:browser.__heroFaults,replaced:!!browser.__consumedCanvas&&document.querySelector('[data-variant="hero"] canvas')!==browser.__consumedCanvas,oldDetached:!browser.__consumedCanvas?.isConnected};
 })).toEqual({failures:1,replaced:true,oldDetached:true});
 await expect(canvas).toHaveAttribute('tabindex','0');await expect(canvas).toHaveAttribute('aria-hidden','false');await expect(canvas).toHaveAttribute('role','img');
 await canvas.focus();expect(await canvas.evaluate(element=>document.activeElement===element)).toBe(true);
 await page.keyboard.press('ArrowUp');await expect(scene).toHaveAttribute('data-scene-state','ready');
 expect(errors).toEqual([]);
});
