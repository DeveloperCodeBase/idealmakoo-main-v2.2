import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';

// This test-only delegate can be preloaded before a historical application
// module captures scrypt/promisify(scrypt). It always calls the native function
// and only holds delivery of selected completed callbacks. No verifier result,
// hash, password or production configuration is replaced.
const nativeScrypt=crypto.scrypt;
let barrier=null;
crypto.scrypt=function(...args){
 const callback=args.at(-1),forwarded=args.slice(0,-1),password=forwarded[0],options=forwarded[3]||{};
 return nativeScrypt.call(this,...forwarded,(error,key)=>{
  const current=barrier;
  if(current&&password===current.target&&current.held.length<current.count&&(current.p===undefined||options.p===current.p)){
   let released=false;current.held.push(()=>{if(!released){released=true;callback(error,key);}});
   if(current.held.length===current.count)current.reached();
  }else callback(error,key);
 });
};
syncBuiltinESMExports();

export function holdDerivations(target,{count=1,p}={}){
 assert.equal(barrier,null,'Native password barriers may not overlap.');
 let reached;const ready=new Promise(resolve=>{reached=resolve;});
 const current={target,count,p,held:[],reached};barrier=current;
 return{
  async wait(){let timer;try{await Promise.race([ready,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('The real native password derivation did not reach its barrier.')),20000);})]);}finally{clearTimeout(timer);}},
  release(index=0){assert.ok(current.held[index],'A completed native password derivation must exist.');current.held[index]();},
  restore(){if(barrier===current)barrier=null;for(const release of current.held)release();},
 };
}
