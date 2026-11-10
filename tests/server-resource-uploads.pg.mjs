import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import {strToU8,zipSync} from 'fflate';
import {query} from '../src/server/db.ts';
import {hash} from '../src/server/crypto.ts';
import {handleRequest} from '../src/server/router.ts';
import {fixtureActor,insertActor,localized,permissions,recordFixture,withCrmRecoveryDatabase} from './helpers/crm-recovery-environment.mjs';

// Reconstructed after the temporary executor was replaced. These tests exercise
// real PostgreSQL and HTTP handlers; they never run a provider or scanner.
// The two checked-in audiovisual fixtures contain only a blue 16x16 frame and
// silence, generated with FFmpeg. Tests themselves do not require FFmpeg.
const origin='http://localhost:3000';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const imageInput={create:{width:64,height:48,channels:3,background:{r:22,g:132,b:155}}};

async function httpClient(actor=null){
  const raw=randomUUID()+randomUUID(),csrf=randomUUID()+randomUUID();
  if(actor)await query("INSERT INTO sessions(id,token_hash,user_id,csrf_token,mfa_verified,expires_at) VALUES($1,$2,$3,$4,true,now()+interval '1 hour')",[randomUUID(),hash(raw),actor.id,csrf]);
  return{async request(path,{method='GET',body,headers={}}={}){
    const url=new URL('/api/v1'+path,origin),multipart=body instanceof FormData;
    const request=new Request(url,{method,headers:{origin,'sec-fetch-site':'same-origin',...(actor?{cookie:'im_session='+raw,'x-csrf-token':csrf}:{}),...(body!==undefined&&!multipart?{'content-type':'application/json'}:{}),...(method==='POST'?{'idempotency-key':randomUUID()}:{}),...headers},...(body!==undefined?{body:multipart?body:JSON.stringify(body)}:{})});
    return handleRequest(request,url.pathname.slice('/api/v1/'.length).split('/'));
  }};
}
async function json(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}
async function expectError(response,status,code){const value=await json(response,status);if(code)assert.equal(value.error.code,code);return value;}
async function upload(client,file,path='/attachments'){
  const form=new FormData();form.set('file',new Blob([file.bytes],{type:file.mime}),file.name);form.set('visibility','private');form.set('rights','true');
  return client.request(path,{method:'POST',body:form});
}
async function resource(client,visibility='public'){
  return json(await client.request('/resources',{method:'POST',body:{slug:'resource-upload-'+randomUUID(),title:localized('Isolated controlled document'),summary:localized('Generated non-personal upload fixture.'),type:'other',visibility}}),201);
}
async function addVersion(client,row,assetId){return client.request(`/resources/${row.id}/versions`,{method:'POST',headers:{'If-Match':String(row.version)},body:{assetId,label:'Reviewed upload revision',locale:'en',rightsConfirmed:true}});}
async function unchanged(row){
  const stored=(await query('SELECT version FROM resources WHERE id=$1',[row.id])).rows[0];assert.equal(Number(stored.version),row.version);
  assert.equal(Number((await query('SELECT count(*) AS n FROM resource_versions WHERE resource_id=$1',[row.id])).rows[0].n),row.versions.length);
}
async function approvedPublicFile(owner,reviewer,visitor,row,asset){
  row=await json(await addVersion(owner,row,asset.id),201);const version=row.versions[0];
  await expectError(await owner.request(`/resources/${row.id}/versions/${version.id}/review`,{method:'POST',body:{decision:'approved',note:'An author cannot independently review this upload.'}}),403,'SELF_REVIEW');
  await expectError(await owner.request(`/resources/${row.id}/publish`,{method:'POST',headers:{'If-Match':String(row.version)},body:{versionId:version.id}}),409,'REVIEW_REQUIRED');
  row=await json(await reviewer.request(`/resources/${row.id}/versions/${version.id}/review`,{method:'POST',body:{decision:'approved',note:'Independent review of the generated isolated file.'}}));
  row=await json(await owner.request(`/resources/${row.id}/publish`,{method:'POST',headers:{'If-Match':String(row.version)},body:{versionId:version.id}}));
  const downloaded=await visitor.request(`/resources/${row.id}/versions/${version.id}/content?action=download`);
  assert.equal(downloaded.status,200);assert.match(downloaded.headers.get('content-security-policy'),/default-src 'none'; sandbox/);assert.match(downloaded.headers.get('content-disposition'),/^attachment;/);assert.match(downloaded.headers.get('cache-control'),/private, no-store/);
  const bytes=Buffer.from(await downloaded.arrayBuffer());assert.equal(digest(bytes),version.sha256);assert.equal(bytes.length,version.bytes);
  return{row,version,bytes};
}
async function pdfFixture(){
  return new Promise((resolve,reject)=>{const chunks=[],document=new PDFDocument({size:'A6',compress:false,info:{Title:'Isolated upload fixture',Author:'Automated test'}});document.on('data',chunk=>chunks.push(chunk));document.once('error',reject);document.once('end',()=>resolve(Buffer.concat(chunks)));document.fontSize(12).text('Generated test document. No real personal or company data.');document.end();});
}
function docxFixture(){
  return Buffer.from(zipSync({
    '[Content_Types].xml':strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels':strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml':strToU8('<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Generated non-personal test document.</w:t></w:r></w:p></w:body></w:document>')
  },{level:0}));
}
function wavFixture(){
  const pcm=Buffer.alloc(1600),header=Buffer.alloc(44);header.write('RIFF',0);header.writeUInt32LE(36+pcm.length,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);header.writeUInt16LE(1,20);header.writeUInt16LE(1,22);header.writeUInt32LE(8000,24);header.writeUInt32LE(16000,28);header.writeUInt16LE(2,32);header.writeUInt16LE(16,34);header.write('data',36);header.writeUInt32LE(pcm.length,40);return Buffer.concat([header,pcm]);
}

test('Private document uploads preserve advertised formats, current roles, immutable review and confidential asset retention',{timeout:180000},async t=>{
  await withCrmRecoveryDatabase('resource_uploads',async()=>{
    const ownerActor=fixtureActor('upload-owner','admin'),reviewerActor=fixtureActor('upload-reviewer','scientificReviewer'),businessActor=fixtureActor('upload-business','business'),otherActor=fixtureActor('upload-other','admin');
    for(const actor of[ownerActor,reviewerActor,businessActor,otherActor]){await insertActor(actor,{scope:'all',grants:permissions});await query('INSERT INTO user_settings(user_id) VALUES($1)',[actor.id]);}
    const owner=await httpClient(ownerActor),reviewer=await httpClient(reviewerActor),business=await httpClient(businessActor),other=await httpClient(otherActor),visitor=await httpClient();
    const files=[
      {name:'fixture.png',mime:'image/png',image:true,bytes:await sharp(imageInput).png().toBuffer()},
      {name:'fixture.jpg',mime:'image/jpeg',image:true,bytes:await sharp(imageInput).jpeg().toBuffer()},
      {name:'fixture.webp',mime:'image/webp',image:true,bytes:await sharp(imageInput).webp().toBuffer()},
      {name:'fixture.pdf',mime:'application/pdf',bytes:await pdfFixture()},
      {name:'fixture.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:docxFixture()},
      {name:'fixture.mp4',mime:'video/mp4',bytes:await readFile(new URL('./fixtures/resource-upload/video.mp4',import.meta.url))},
      {name:'fixture.mp3',mime:'audio/mpeg',bytes:await readFile(new URL('./fixtures/resource-upload/audio.mp3',import.meta.url))},
      {name:'fixture.wav',mime:'audio/wav',bytes:wavFixture()}
    ];
    for(const file of files)await t.test(`${file.name}: private attachment, scan gate, independent review and exact controlled download`,async()=>{
      let row=await resource(owner);const asset=await json(await upload(owner,file),201);
      assert.equal(asset.visibility,'private');assert.equal(asset.mimeType,file.image?'image/webp':file.mime);assert.equal(asset.scanStatus,file.image?'clean':'pending');
      const stored=(await query('SELECT owner_id,request_id,metadata,sha256 FROM assets WHERE id=$1',[asset.id])).rows[0];assert.equal(stored.owner_id,ownerActor.id);assert.equal(stored.request_id,null);assert.equal(stored.metadata.damRole,undefined);
      assert.equal((await query('SELECT 1 FROM asset_image_sources WHERE asset_id=$1 OR original_asset_id=$1 UNION ALL SELECT 1 FROM asset_image_derivatives WHERE asset_id=$1',[asset.id])).rowCount,0);
      assert.ok((await json(await owner.request('/me/attachments'))).items.some(item=>item.id===asset.id));
      await expectError(await visitor.request('/attachments/'+asset.id),404);
      const path=`/resources/${row.id}/versions`;
      if(!file.image){
        await expectError(await addVersion(owner,row,asset.id),409,'QUARANTINED');await unchanged(row);
        assert.equal((await query("SELECT 1 FROM outbox WHERE kind='scan' AND dedupe_key=$1 AND payload->>'assetId'=$2",['scan:'+asset.id,asset.id])).rowCount,1);
        // Controlled scanner-state fixture: this suite does NOT claim a live
        // ClamAV result. Pending files above are demonstrably unusable.
        await query("UPDATE assets SET scan_status='clean' WHERE id=$1",[asset.id]);
      }
      const released=await approvedPublicFile(owner,reviewer,visitor,row,asset);row=released.row;
      if(file.image){const metadata=await sharp(released.bytes).metadata();assert.equal(metadata.format,'webp');assert.equal(metadata.width,64);assert.equal(metadata.height,48);assert.equal(metadata.exif,undefined);}
      else assert.deepEqual(released.bytes,file.bytes);
      assert.equal(digest(released.bytes),stored.sha256);
      row=await json(await owner.request('/resources/'+row.id,{method:'DELETE',headers:{'If-Match':String(row.version)}}));assert.equal(row.status,'archived');
      await expectError(await visitor.request(`${path}/${released.version.id}/content?action=download`),404);
      await expectError(await visitor.request('/attachments/'+asset.id),404);
    });
    await t.test('A current financial business manager can upload and bind without media-create; revocation blocks another version',async()=>{
      await expectError(await upload(business,files[0],'/media'),403,'FORBIDDEN');
      const asset=await json(await upload(business,files[0]),201);let row=await resource(business,'restricted');
      row=await json(await addVersion(business,row,asset.id),201);assert.equal(row.versions.length,1);assert.equal(row.versions[0].mimeType,'image/webp');
      assert.ok((await json(await business.request('/me/attachments'))).items.some(item=>item.id===asset.id));
      const next=await json(await upload(business,files[1]),201);
      await query("UPDATE users SET crm_permissions=jsonb_set(crm_permissions,'{financial}','false'::jsonb) WHERE id=$1",[businessActor.id]);
      await expectError(await addVersion(business,row,next.id),403,'FORBIDDEN');await unchanged(row);
      await query('UPDATE users SET crm_permissions=$2::jsonb WHERE id=$1',[businessActor.id,JSON.stringify(permissions)]);
    });
    await t.test('Actual DAM private originals, normalized sources and crops cannot be rebound to a controlled resource',async()=>{
      const source=await json(await upload(owner,files[0],'/media'),201),family=(await query('SELECT original_asset_id FROM asset_image_sources WHERE asset_id=$1',[source.id])).rows[0];assert.ok(family);
      const derivative=await json(await owner.request(`/media/${source.id}/derivatives`,{method:'POST',body:{name:'Isolated crop',rightsConfirmed:true,recipe:{crop:{left:0,top:0,width:32,height:24},outputWidth:16,outputHeight:12,fit:'inside',quality:85}}}),201);
      assert.equal((await query('SELECT 1 FROM asset_image_derivatives WHERE asset_id=$1 AND source_asset_id=$2',[derivative.id,source.id])).rowCount,1);
      const row=await resource(owner);
      for(const id of[family.original_asset_id,source.id,derivative.id]){await expectError(await addVersion(owner,row,id),409,'ASSET_IN_USE');await unchanged(row);}
      await expectError(await visitor.request('/attachments/'+family.original_asset_id),404);
      await expectError(await visitor.request('/media/'+family.original_asset_id+'/content'),404);
      const listed=await json(await owner.request('/me/attachments'));assert.equal(listed.items.some(item=>item.id===family.original_asset_id),false);
    });
    await t.test('Other-owner, request-bound, historical CRM and other-document files remain protected; quarantine blocks later approval',async()=>{
      const target=await resource(owner),foreign=await json(await upload(other,files[0]),201);
      await expectError(await addVersion(owner,target,foreign.id),404,'NOT_FOUND');await unchanged(target);
      const evidence=await json(await upload(owner,files[0]),201),record=await recordFixture(ownerActor);
      await query("INSERT INTO crm_domain_asset_refs(record_bucket,record_id,asset_id) VALUES('records',$1,$2)",[record.id,evidence.id]);
      await expectError(await addVersion(owner,target,evidence.id),409,'ASSET_IN_USE');await unchanged(target);
      const attached=await json(await upload(owner,files[0]),201),request=await json(await owner.request('/requests',{method:'POST',body:{kind:'contact',locale:'en',name:ownerActor.name,email:ownerActor.email,message:'Isolated request attachment binding.',productIds:[],attachmentIds:[attached.id],consent:{purpose:'request_processing',acceptedAt:new Date().toISOString()}}}),201);
      assert.equal((await query('SELECT request_id FROM assets WHERE id=$1',[attached.id])).rows[0].request_id,request.id);
      await expectError(await addVersion(owner,target,attached.id),404,'NOT_FOUND');await unchanged(target);
      const reused=await json(await upload(owner,files[0]),201);let first=await resource(owner);first=await json(await addVersion(owner,first,reused.id),201);
      await expectError(await addVersion(owner,target,reused.id),409,'ASSET_IN_USE');await unchanged(target);
      await query("UPDATE assets SET scan_status='blocked' WHERE id=$1",[reused.id]);const version=first.versions[0];
      await expectError(await reviewer.request(`/resources/${first.id}/versions/${version.id}/review`,{method:'POST',body:{decision:'approved',note:'The current scan must still be clean.'}}),409,'QUARANTINED');await unchanged(first);
      assert.equal((await query('SELECT 1 FROM resource_reviews WHERE version_id=$1',[version.id])).rowCount,0);
      assert.equal((await query('SELECT 1 FROM resource_publications WHERE resource_id=$1',[target.id])).rowCount,0);
    });
  });
});
