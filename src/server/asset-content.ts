import {constants} from 'node:fs';
import {open, type FileHandle} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {assert,HttpError} from './types';

type StoredMediaFile={storage_key:string;name:string;mime_type:string;bytes:string;sha256:string;visibility:'public'|'private';scan_status:string};
const chunkBytes=64*1024;
const maximumOpenDownloads=64;
const maximumVerifiedFiles=256;
const verificationLifetimeMs=60_000;
let openDownloads=0;
const verifiedFiles=new Map<string,{identity:string;expiresAt:number}>();

/** Immutable asset bytes are verified without loading the complete file into
 * memory. Reuse is bounded and tied to the open inode, size, nanosecond mtime,
 * nanosecond ctime AND the database digest. Current authorization is always
 * checked by the caller before this helper, including conditional requests. */
async function verify(file:FileHandle,path:string,row:StoredMediaFile){
  const before=await file.stat({bigint:true});
  assert(before.isFile()&&before.size>0n&&before.size<=BigInt(Number.MAX_SAFE_INTEGER),500,'FILE_INTEGRITY','The stored file is not a valid regular asset.');
  assert(/^[0-9]+$/.test(row.bytes)&&before.size===BigInt(row.bytes)&&/^[a-f0-9]{64}$/.test(row.sha256),500,'FILE_INTEGRITY','The stored file size or checksum metadata does not match.');
  const identity=[before.dev,before.ino,before.size,before.mtimeNs,before.ctimeNs].join(':'),key=path+'\0'+row.sha256;
  const cached=verifiedFiles.get(key);
  if(cached?.identity===identity&&cached.expiresAt>Date.now()){
    verifiedFiles.delete(key);verifiedFiles.set(key,cached);
    return{size:Number(before.size),modifiedAt:Number(before.mtimeMs)};
  }
  verifiedFiles.delete(key);
  const buffer=Buffer.allocUnsafe(chunkBytes),digest=createHash('sha256');
  let position=0;
  while(position<Number(before.size)){
    const {bytesRead}=await file.read(buffer,0,Math.min(buffer.length,Number(before.size)-position),position);
    assert(bytesRead>0,500,'FILE_INTEGRITY','The stored file changed during verification.');
    digest.update(buffer.subarray(0,bytesRead));position+=bytesRead;
  }
  const after=await file.stat({bigint:true});
  assert(identity===[after.dev,after.ino,after.size,after.mtimeNs,after.ctimeNs].join(':')&&digest.digest('hex')===row.sha256,500,'FILE_INTEGRITY','The stored file checksum does not match.');
  verifiedFiles.set(key,{identity,expiresAt:Date.now()+verificationLifetimeMs});
  while(verifiedFiles.size>maximumVerifiedFiles)verifiedFiles.delete(verifiedFiles.keys().next().value!);
  return{size:Number(before.size),modifiedAt:Number(before.mtimeMs)};
}

function byteRange(value:string,size:number):{start:number;end:number}|null{
  if(value.length>200)return null;
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!match||!match[1]&&!match[2])return null;
  const first=match[1]?Number(match[1]):null,last=match[2]?Number(match[2]):null;
  if(first!==null&&!Number.isSafeInteger(first)||last!==null&&!Number.isSafeInteger(last))return null;
  if(first===null){if(!last)return null;return{start:Math.max(0,size-last),end:size-1};}
  if(first>=size||last!==null&&last<first)return null;
  return{start:first,end:last===null?size-1:Math.min(last,size-1)};
}
function matchesEtag(value:string|null,etag:string){return value!==null&&value.split(',').some(part=>part.trim()==='*'||part.trim().replace(/^W\//,'')===etag);}

/** Stream only after integrity and caller authorization have succeeded. No
 * private response is made cacheable; every public 304 still rechecks rights. */
export async function storedMediaResponse(row:StoredMediaFile,request:Request,storageDirectory:string,attachment=false):Promise<Response>{
  assert(row.scan_status==='clean',409,'QUARANTINED','This file is unavailable until its security scan succeeds.');
  assert(/^(public|private)\/[a-f0-9-]+\.[a-z0-9]+$/.test(row.storage_key),500,'STORAGE_KEY','The stored file path is invalid.');
  assert(openDownloads<maximumOpenDownloads,503,'MEDIA_BUSY','File delivery is busy. Please retry shortly.');
  openDownloads++;
  let file:FileHandle|undefined,handedOff=false,released=false;
  const release=()=>{if(!released){released=true;openDownloads--;}};
  try{
    const path=join(storageDirectory,row.storage_key);
    // A symbolic link must never turn a database asset into an arbitrary file.
    try{file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}
    catch(error){
      if(['ENOENT','ENOTDIR','ELOOP'].includes((error as NodeJS.ErrnoException).code||''))throw new HttpError(404,'FILE_MISSING','The stored file is unavailable.');
      throw new HttpError(503,'FILE_UNAVAILABLE','The stored file could not be opened. Please retry shortly.');
    }
    const {size,modifiedAt}=await verify(file,path,row),etag='"sha256-'+row.sha256+'"';
    const disposition=attachment||row.visibility==='private'||!/^(image|video|audio)\//.test(row.mime_type)?'attachment':'inline';
    const name=row.name.toWellFormed().replace(/[\x00-\x1f\x7f"\\/]/g,'_').slice(0,180)||'download';
    const headers=new Headers({'Content-Type':row.mime_type,'X-Content-Type-Options':'nosniff',
      'Content-Disposition':`${disposition}; filename="${name.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control':row.visibility==='public'?'public, max-age=0, must-revalidate':'private, no-store',
      'Content-Security-Policy':"default-src 'none'; sandbox",'Accept-Ranges':'bytes','ETag':etag,'Last-Modified':new Date(modifiedAt).toUTCString()});
    if(row.visibility==='public'&&matchesEtag(request.headers.get('if-none-match'),etag))return new Response(null,{status:304,headers});
    // Range is defined for GET only. A mismatched/weak If-Range asks for the
    // complete current representation, so an interrupted transfer cannot splice
    // together bytes from two revisions. Date validators are conservatively
    // treated as insufficient for immutable content; clients can use the ETag.
    const range=request.method==='GET'?request.headers.get('range'):null,ifRange=request.headers.get('if-range');
    const selected=range&&(!ifRange||ifRange===etag)?byteRange(range,size):undefined;
    if(selected===null){headers.set('Content-Range',`bytes */${size}`);return new Response(null,{status:416,headers});}
    const start=selected?.start||0,end=selected?.end??size-1,status=selected?206:200;
    headers.set('Content-Length',String(end-start+1));
    if(selected)headers.set('Content-Range',`bytes ${start}-${end}/${size}`);
    if(request.method==='HEAD')return new Response(null,{status,headers});
    assert(!request.signal.aborted,499,'REQUEST_ABORTED','The download request was cancelled.');
    const stream=file.createReadStream({start,end,highWaterMark:chunkBytes,autoClose:true});
    const body=Readable.toWeb(stream,{strategy:{highWaterMark:chunkBytes,size:chunk=>(chunk as Uint8Array).byteLength}}) as ReadableStream<Uint8Array>;
    const abort=()=>stream.destroy(new Error('Download request cancelled.'));
    request.signal.addEventListener('abort',abort,{once:true});
    stream.once('close',()=>{request.signal.removeEventListener('abort',abort);release();});
    handedOff=true;
    return new Response(body,{status,headers});
  }finally{
    if(!handedOff){try{await file?.close();}finally{release();}}
  }
}
