import test from 'node:test';
import assert from 'node:assert/strict';
import {privateSessionPreflight} from '../scripts/lib/private-audit-session.mjs';

const now=Date.parse('2026-10-20T14:00:00.000Z');
const at=minutes=>new Date(now+minutes*60000).toISOString();
function fixture(role='superAdmin'){
 const actor={id:'test_owned_fixture_identity',role};
 return{actor,now,renewalMarginMs:420000,
  sessionResponse:{status:200,data:{user:{id:actor.id,role,mfaEnabled:role!=='customer',email:'test-private-audit@example.test'}}},
  workspaceResponse:role==='customer'?null:{status:200,data:{privateContent:'PRIVATE_WORKSPACE_TEXT'}},
  securityResponse:{status:200,data:{mfaEnabled:role!=='customer',sessions:[{id:'PRIVATE_SESSION_ID',userAgent:'PRIVATE_USER_AGENT',current:true,expiresAt:at(90)}]}}
 };
}

test('a current staff identity, live MFA gate and absolute expiry prove a bounded audit without exporting private details',()=>{
 const result=privateSessionPreflight(fixture());
 assert.equal(result.action,'measure');
 assert.deepEqual(result.checks,{preSessionRoleVerified:true,preStaffMfaVerified:true,preSessionFreshnessVerified:true});
 assert.deepEqual(result.preflight,{sessionRole:'superAdmin',httpStatus:200,workspaceStatus:200,securityStatus:200,expiresAt:at(90),observedAt:at(0)});
 assert.doesNotMatch(JSON.stringify(result),/PRIVATE_|test_owned_fixture_identity|test-private-audit/);
});

test('only a still-valid proven session near its known absolute expiry receives a planned renewal',()=>{
 const input=fixture();input.securityResponse.data.sessions[0].expiresAt=at(5);
 const result=privateSessionPreflight(input);
 assert.equal(result.action,'renew');
 assert.equal(result.checks.preSessionRoleVerified,true);
 assert.equal(result.checks.preStaffMfaVerified,true);
 assert.equal(result.checks.preSessionFreshnessVerified,false);
 for(const expiresAt of [at(0),at(-1)]){
  input.securityResponse.data.sessions[0].expiresAt=expiresAt;
  assert.equal(privateSessionPreflight(input).errorCode,'AUDIT_PRE_SESSION_EXPIRED');
  assert.equal(privateSessionPreflight(input).action,'fail');
 }
});

test('a changed, revoked or missing actor and unexpected authentication HTTP failures are retained rather than renewed',()=>{
 for(const mutate of [
  x=>x.sessionResponse.data.user=null,
  x=>x.sessionResponse.data.user.id='different_test_fixture',
  x=>x.sessionResponse.data.user.role='admin',
  x=>x.sessionResponse.status=401,
  x=>x.sessionResponse.status=403,
 ]){
  const input=fixture();input.securityResponse.data.sessions[0].expiresAt=at(1);mutate(input);
  const result=privateSessionPreflight(input);
  assert.equal(result.action,'fail');assert.equal(result.checks.preSessionRoleVerified,false);
 }
});

test('current staff access and MFA state are required even when a prior session was enrolled',()=>{
 for(const mutate of [
  x=>x.workspaceResponse.status=401,
  x=>x.workspaceResponse.status=403,
  x=>x.sessionResponse.data.user.mfaEnabled=false,
  x=>x.securityResponse.data.mfaEnabled=false,
 ]){
  const input=fixture();mutate(input);
  const result=privateSessionPreflight(input);
  assert.equal(result.action,'fail');assert.equal(result.checks.preStaffMfaVerified,false);
 }
});

test('absolute expiry must be proven by exactly one current security session and a successful security response',()=>{
 for(const mutate of [
  x=>x.securityResponse.status=403,
  x=>x.securityResponse.data.sessions=[],
  x=>x.securityResponse.data.sessions.push({...x.securityResponse.data.sessions[0]}),
  x=>x.securityResponse.data.sessions[0].current=false,
  x=>x.securityResponse.data.sessions[0].expiresAt='not-a-date',
  x=>x.securityResponse=null,
  x=>x.now=NaN,
  x=>x.renewalMarginMs=0,
 ]){
  const input=fixture();mutate(input);
  const result=privateSessionPreflight(input);
  assert.equal(result.action,'fail');assert.equal(result.checks.preSessionFreshnessVerified,false);
 }
});

test('customer MFA and workspace checks are not applicable but current ownership and session expiry remain mandatory',()=>{
 const input=fixture('customer');
 const result=privateSessionPreflight(input);
 assert.equal(result.action,'measure');assert.equal(result.checks.preStaffMfaVerified,true);
 assert.equal(result.preflight.workspaceStatus,null);assert.equal(result.preflight.sessionRole,'customer');
 input.sessionResponse.data.user.id='another_test_customer';
 assert.equal(privateSessionPreflight(input).action,'fail');
 input.sessionResponse.data.user.id=input.actor.id;input.securityResponse.data.sessions[0].expiresAt=at(2);
 assert.equal(privateSessionPreflight(input).action,'renew');
 input.securityResponse.data.sessions[0].expiresAt=at(-1);
 assert.equal(privateSessionPreflight(input).action,'fail');
});
