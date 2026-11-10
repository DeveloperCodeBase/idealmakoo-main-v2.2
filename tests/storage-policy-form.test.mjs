import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {storagePolicyForm,parseStoragePolicyForm}=await loadTs('src/lib/storage-policy-form.ts');
const {effectiveFileLimit,HARD_MAX_UPLOAD_BYTES}=await loadTs('src/lib/upload-policy.ts');
const {acceptsMediaUpload}=await loadTs('src/lib/dam-client.ts');
const MiB=1024**2;
const limits={maxFileBytes:40*MiB,byType:{image:3*MiB,document:8*MiB,video:40*MiB,audio:16*MiB},totalBytes:1024*MiB,userBytes:128*MiB,guestBytes:8*MiB};
test('administrator MiB values round-trip exact bytes including non-rounded quotas',()=>{
 const odd={...limits,guestBytes:2*MiB+1};assert.deepEqual(parseStoragePolicyForm(storagePolicyForm(odd),HARD_MAX_UPLOAD_BYTES),odd);
 assert.equal(parseStoragePolicyForm({...storagePolicyForm(limits),image:'.5'},HARD_MAX_UPLOAD_BYTES).byType.image,524288);
 for(const value of ['0','-1','Infinity','NaN','1e3','0.00000001','9007199254740992'])assert.equal(parseStoragePolicyForm({...storagePolicyForm(limits),image:value},HARD_MAX_UPLOAD_BYTES),null,value);
});
test('type/file hard ceilings and shared quota relationships are enforced before transport',()=>{
 for(const patch of [{maxFileBytes:'81'},{image:'41'},{userBytes:'1025'},{guestBytes:'1025'}])assert.equal(parseStoragePolicyForm({...storagePolicyForm(limits),...patch},HARD_MAX_UPLOAD_BYTES),null);
});
test('upload acceptance uses server MIME limits instead of the old fixed 20 MiB ceiling',()=>{
 const policy={version:3,maxFileBytes:limits.maxFileBytes,byType:limits.byType,maxRequestBytes:limits.maxFileBytes+65536,allowedMimeTypes:['image/png','video/mp4'],canUploadLibrary:true,canUploadAttachment:true};
 assert.equal(effectiveFileLimit(policy,'image/png'),3*MiB);
 assert.equal(acceptsMediaUpload({name:'image.png',type:'image/png',size:4*MiB},policy),false);
 assert.equal(acceptsMediaUpload({name:'clip.mp4',type:'video/mp4',size:30*MiB},policy),true);
 assert.equal(acceptsMediaUpload({name:'forged.png',type:'text/html',size:1024},policy),false);
 assert.equal(acceptsMediaUpload({name:'image.png',type:'image/png',size:0},policy),false);
});
