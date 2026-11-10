import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {acceptsMediaUpload,mediaAssetApiPath,originalMediaApiPath,workspaceMediaFromServer,readyMediaOutput,MAX_MEDIA_UPLOAD_BYTES}=await loadTs('src/lib/dam-client.ts');
const id='a151bf57-26c2-4d8f-9fc5-58e6a86a8b80',other='83fcda34-8fbd-49e1-bf18-2b559b01fc9a';

test('private media transport binds the exact returned asset identity and excludes other endpoints',()=>{
 assert.equal(mediaAssetApiPath(id,`/api/v1/media/${id}/content`),`/media/${id}/content`);
 assert.equal(mediaAssetApiPath(id,`/api/v1/attachments/${id}`),`/attachments/${id}`);
 for(const path of [`/api/v1/attachments/${other}`,`https://factory.example/api/v1/attachments/${id}`,`//other.example/api/v1/attachments/${id}`,`/api/v1/attachments/${id}?token=private`,`/api/v1/attachments/${id}/../me`,`/api/v1/privacy/requests/${id}/execute`,`/api/v1/media/${id}/rights`])assert.equal(mediaAssetApiPath(id,path),null,path);
 assert.equal(originalMediaApiPath(`/api/v1/attachments/${id}`),`/attachments/${id}`);
 assert.equal(originalMediaApiPath(`/api/v1/media/${id}/content`),null);
 assert.equal(originalMediaApiPath(`/api/v1/attachments/${id}#fragment`),null);
});
test('decoded image registration uses actual normalized server name, type and bytes',()=>{
 const result=workspaceMediaFromServer({id,url:`/api/v1/media/${id}/content`,filename:'decoded-original.webp',size:13753,mimeType:'image/webp'},true,'Reviewed image');
 assert.equal(result.filename,'decoded-original.webp');assert.equal(result.size,13753);assert.equal(result.type,'image');assert.equal(result.title,'Reviewed image');assert.equal(result.rights,true);
 const privatePdf=workspaceMediaFromServer({id,url:`/api/v1/attachments/${id}`,filename:'source.pdf',size:610,mimeType:'application/pdf'},false);
 assert.equal(privatePdf.type,'document');assert.equal(privatePdf.rights,false);
 assert.throws(()=>workspaceMediaFromServer({...privatePdf,mimeType:'application/pdf',size:0},false),/Invalid/);
 assert.throws(()=>workspaceMediaFromServer({...privatePdf,mimeType:'application/pdf',url:`/api/v1/attachments/${other}`},false),/Invalid/);
});
test('human uploads enforce the actual twenty MiB and supported-container boundary',()=>{
 assert.equal(acceptsMediaUpload({name:'clip.mp4',type:'video/mp4',size:MAX_MEDIA_UPLOAD_BYTES}),true);
 assert.equal(acceptsMediaUpload({name:'document.docx',type:'',size:1024}),true);
 for(const file of [{name:'clip.mp4',type:'video/mp4',size:MAX_MEDIA_UPLOAD_BYTES+1},{name:'clip.mp4',type:'video/mp4',size:0},{name:'clip.webm',type:'video/webm',size:500},{name:'image.avif',type:'image/avif',size:500},{name:'unsafe.html',type:'',size:10}])assert.equal(acceptsMediaUpload(file),false,file.name);
});
test('processing output remains unavailable until ready, scan-clean and currently authorized',()=>{
 const output={assetId:id,url:`/api/v1/attachments/${id}`,filename:'derived.mp4',bytes:50,mimeType:'video/mp4',sha256:'a'.repeat(64),scanStatus:'clean',visibility:'private',available:true};
 assert.deepEqual(readyMediaOutput({state:'ready',output}),output);
 for(const state of ['pending','running','scanning','failed','cancelled'])assert.equal(readyMediaOutput({state,output}),null,state);
 for(const scanStatus of ['pending','blocked','error'])assert.equal(readyMediaOutput({state:'ready',output:{...output,scanStatus}}),null,scanStatus);
 assert.equal(readyMediaOutput({state:'ready',output:{...output,available:false}}),null);
 assert.equal(readyMediaOutput({state:'ready',output:{...output,url:`/api/v1/attachments/${other}`}}),null);
});
