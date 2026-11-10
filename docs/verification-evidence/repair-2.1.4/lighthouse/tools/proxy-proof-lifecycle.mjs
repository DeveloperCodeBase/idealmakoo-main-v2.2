import http from 'node:http';

export class ProofError extends Error{
 constructor(code){super(code);this.code=code;}
}

export function proofCancellation(record,source=process){
 const controller=new AbortController();
 record.receivedSignals=[];record.interrupted=false;
 const handlers=new Map(['SIGTERM','SIGINT'].map(name=>[name,()=>{
  record.receivedSignals.push(name);record.interrupted=true;
  if(!controller.signal.aborted)controller.abort(new ProofError('PROOF_INTERRUPTED'));
 }]));
 for(const [name,handler] of handlers)source.on(name,handler);
 return{signal:controller.signal,check(){if(controller.signal.aborted)throw controller.signal.reason;},
  close(){for(const [name,handler] of handlers)source.off(name,handler);}};
}

/** One absolute deadline covers connection, headers and every response byte. */
export function boundedHttpRequest(url,options,payload,{signal,timeoutMs=30000,maxBytes=8*1024*1024}={}){
 if(signal?.aborted)return Promise.reject(signal.reason);
 return new Promise((resolve,reject)=>{
  let request,response,timer,settled=false;
  const finish=(error,result)=>{
   if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
   if(error){response?.destroy();request?.destroy();reject(error);}else resolve(result);
  };
  const abort=()=>finish(signal.reason instanceof ProofError?signal.reason:new ProofError('PROOF_INTERRUPTED'));
  timer=setTimeout(()=>finish(new ProofError('PROOF_REQUEST_DEADLINE_EXCEEDED')),timeoutMs);
  signal?.addEventListener('abort',abort,{once:true});
  try{
   request=http.request(url,options,res=>{
    response=res;const chunks=[];let bytes=0;
    res.on('data',chunk=>{if(settled)return;bytes+=chunk.length;if(bytes>maxBytes){finish(new ProofError('PROOF_RESPONSE_BOUND_EXCEEDED'));return;}chunks.push(chunk);});
    res.on('end',()=>finish(null,{status:res.statusCode,headers:res.headers,httpVersion:res.httpVersion,raw:Buffer.concat(chunks)}));
    res.on('error',()=>finish(new ProofError('PROOF_RESPONSE_IO_FAILED')));
    res.on('aborted',()=>finish(new ProofError('PROOF_RESPONSE_ABORTED')));
   });
   request.on('error',()=>finish(new ProofError('PROOF_REQUEST_IO_FAILED')));
   if(signal?.aborted){abort();return;}
   request.end(payload);
  }catch{finish(new ProofError('PROOF_REQUEST_IO_FAILED'));}
 });
}
