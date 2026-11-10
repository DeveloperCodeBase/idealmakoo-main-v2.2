import test from 'node:test';
import assert from 'node:assert/strict';
import {query} from '../src/server/db.ts';
import {storeAsset} from '../src/server/storage.ts';
import {handleRequest} from '../src/server/router.ts';
import {fixtureActor,insertActor,fixtureHttpSession,withCrmRecoveryDatabase} from './helpers/crm-recovery-environment.mjs';

test('Media HTTP validators and HEAD never bypass current private ownership, MFA, quarantine or publication rights',{timeout:180000},async t=>withCrmRecoveryDatabase('media_delivery',async()=>{
  const owner=fixtureActor('delivery-owner','contentEditor'),stranger=fixtureActor('delivery-stranger','admin');
  await insertActor(owner);await insertActor(stranger);
  const ownerHttp=await fixtureHttpSession(owner),strangerHttp=await fixtureHttpSession(stranger),unenrolledHttp=await fixtureHttpSession(owner,{mfa:false});
  const publicBytes=Buffer.from('Published immutable media bytes.'),privateBytes=Buffer.from('Private immutable media bytes.');
  const publicFile=await storeAsset({ownerId:owner.id,name:'public.mp4',bytes:publicBytes,extension:'mp4',mimeType:'video/mp4',visibility:'public',scanStatus:'clean',metadata:{rights:true}});
  const privateFile=await storeAsset({ownerId:owner.id,name:'private.pdf',bytes:privateBytes,extension:'pdf',mimeType:'application/pdf',visibility:'private',scanStatus:'clean',metadata:{}});
  const publicPath='/media/'+publicFile.id+'/content',privatePath='/attachments/'+privateFile.id;
  const publicRequest=(path,headers={},method='GET')=>handleRequest(new Request('http://localhost:3000/api/v1'+path,{method,headers}),path.slice(1).split('/'));
  let publicEtag,privateEtag;
  await t.test('Anonymous public readers can revalidate and request suffix bytes; HEAD has no response body',async()=>{
    const response=await publicRequest(publicPath);assert.equal(response.status,200);publicEtag=response.headers.get('etag');assert.deepEqual(Buffer.from(await response.arrayBuffer()),publicBytes);
    assert.equal((await publicRequest(publicPath,{'If-None-Match':publicEtag})).status,304);
    const partial=await publicRequest(publicPath,{Range:'bytes=-6'});assert.equal(partial.status,206);assert.equal(await partial.text(),'bytes.');
    const head=await publicRequest(publicPath,{},'HEAD');assert.equal(head.status,200);assert.equal(head.body,null);assert.equal(head.headers.get('content-length'),String(publicBytes.length));
  });
  await t.test('Private cached metadata cannot grant access to another administrator, guest, unverified MFA session or inactive owner',async()=>{
    const allowed=await ownerHttp.request(privatePath);assert.equal(allowed.status,200);privateEtag=allowed.headers.get('etag');assert.deepEqual(Buffer.from(await allowed.arrayBuffer()),privateBytes);
    const headers={'If-None-Match':privateEtag,Range:'bytes=0-2'};
    assert.equal((await strangerHttp.request(privatePath,{headers})).status,404);
    assert.equal((await strangerHttp.request(privatePath,{method:'HEAD',headers})).status,404);
    assert.equal((await publicRequest(privatePath,headers)).status,404);
    assert.equal((await unenrolledHttp.request(privatePath,{headers})).status,403);
    const head=await ownerHttp.request(privatePath,{method:'HEAD',headers});assert.equal(head.status,200);assert.equal(head.body,null);assert.equal(head.headers.get('cache-control'),'private, no-store');
    await query('UPDATE users SET active=false WHERE id=$1',[owner.id]);
    assert.equal((await ownerHttp.request(privatePath,{headers})).status,404);
    await query('UPDATE users SET active=true WHERE id=$1',[owner.id]);
  });
  await t.test('Revoked distribution rights and failed scans are checked before any public 304',async()=>{
    await query("UPDATE assets SET metadata=jsonb_set(metadata,'{rights}','false'::jsonb) WHERE id=$1",[publicFile.id]);
    assert.equal((await publicRequest(publicPath,{'If-None-Match':publicEtag})).status,410);
    await query("UPDATE assets SET metadata=jsonb_set(metadata,'{rights}','true'::jsonb),scan_status='blocked' WHERE id=$1",[publicFile.id]);
    assert.equal((await publicRequest(publicPath,{'If-None-Match':publicEtag})).status,409);
  });
}));
