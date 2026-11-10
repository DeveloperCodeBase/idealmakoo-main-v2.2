export interface SourceArchive{bytes:number;sha256:string;parts:{url:string;bytes:number}[];}
/** Serve one byte-identical ZIP while keeping every deployable asset below 25 MB. */
export async function handleSourceArchive(request:Request,assets:{fetch:(request:Request)=>Promise<Response>}|undefined,archive:SourceArchive):Promise<Response|null>{
 const url=new URL(request.url);if(url.pathname!=='/downloads/idealmakoo-source.zip')return null;
 if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
 if(!assets)return new Response('Download unavailable',{status:503});
 let start=0,end=archive.bytes-1;const range=request.headers.get('range');
 if(range){const match=range.match(/^bytes=(\d*)-(\d*)$/);if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${archive.bytes}`}});
  if(!match[1]){const suffix=Number(match[2]);start=Math.max(0,archive.bytes-suffix);}else{start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2]));}
  if(start>end||start<0||!Number.isSafeInteger(start)||!Number.isSafeInteger(end))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${archive.bytes}`}});
 }
 const selected:Array<{url:string;start:number;end:number}>=[];let offset=0;
 for(const part of archive.parts){if(offset<=end&&offset+part.bytes>start)selected.push({url:part.url,start:Math.max(0,start-offset),end:Math.min(part.bytes-1,end-offset)});offset+=part.bytes;}
 let index=0;const stream=request.method==='HEAD'?null:new ReadableStream<Uint8Array>({async pull(controller){if(index>=selected.length){controller.close();return;}try{const part=selected[index++];const response=await assets.fetch(new Request(new URL(part.url,url.origin),{signal:request.signal}));if(!response.ok)throw new Error('Archive part unavailable');const data=new Uint8Array(await response.arrayBuffer());if(data.length<=part.end)throw new Error('Incomplete archive part');controller.enqueue(data.subarray(part.start,part.end+1));}catch(error){controller.error(error);}}});
 return new Response(stream,{status:range?206:200,headers:{'Content-Type':'application/zip','Content-Length':String(end-start+1),'Content-Disposition':'attachment; filename="idealmakoo-source.zip"','Accept-Ranges':'bytes','ETag':`"${archive.sha256}"`,'Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff',...(range?{'Content-Range':`bytes ${start}-${end}/${archive.bytes}`}:{})}});
}
