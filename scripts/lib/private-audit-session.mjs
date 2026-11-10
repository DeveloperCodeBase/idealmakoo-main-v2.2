import {auditRoles} from './private-audit-policy.mjs';

const status=value=>Number.isInteger(value)&&value>=100&&value<=599?value:null;
const httpCode=(prefix,value)=>prefix+'_'+(status(value)??'INVALID');

/** Decide from current real API responses; no session credentials leave memory. */
export function privateSessionPreflight({actor,sessionResponse,workspaceResponse,securityResponse,now=Date.now(),renewalMarginMs=420000}){
 const user=sessionResponse?.data?.user,staff=actor.role!=='customer';
 const sessionStatus=status(sessionResponse?.status),workspaceStatus=staff?status(workspaceResponse?.status):null,securityStatus=status(securityResponse?.status);
 const current=Array.isArray(securityResponse?.data?.sessions)?securityResponse.data.sessions.filter(item=>item?.current===true):[];
 const expires=current.length===1&&typeof current[0].expiresAt==='string'?Date.parse(current[0].expiresAt):NaN;
 const preflight={sessionRole:auditRoles.includes(user?.role)?user.role:null,httpStatus:sessionStatus,workspaceStatus,securityStatus,expiresAt:Number.isFinite(expires)?new Date(expires).toISOString():null,observedAt:Number.isFinite(now)?new Date(now).toISOString():null};
 const checks={preSessionRoleVerified:sessionStatus===200&&user?.id===actor.id&&user?.role===actor.role,preStaffMfaVerified:!staff||user?.mfaEnabled===true&&workspaceStatus===200&&securityResponse?.data?.mfaEnabled===true,preSessionFreshnessVerified:securityStatus===200&&Number.isFinite(expires)&&Number.isFinite(now)&&Number.isFinite(renewalMarginMs)&&renewalMarginMs>0&&expires>now+renewalMarginMs};
 const fail=errorCode=>({action:'fail',errorCode,preflight,checks});
 if(sessionStatus!==200)return fail(httpCode('AUDIT_PRE_SESSION_HTTP',sessionStatus));
 if(!checks.preSessionRoleVerified)return fail('AUDIT_PRE_SESSION_IDENTITY');
 if(staff&&workspaceStatus!==200)return fail(httpCode('AUDIT_PRE_STAFF_ACCESS',workspaceStatus));
 if(securityStatus!==200)return fail(httpCode('AUDIT_PRE_SECURITY_HTTP',securityStatus));
 if(!checks.preStaffMfaVerified)return fail('AUDIT_PRE_MFA_CHANGED');
 if(current.length!==1||!Number.isFinite(expires)||!Number.isFinite(now)||!Number.isFinite(renewalMarginMs)||renewalMarginMs<=0)return fail('AUDIT_PRE_SESSION_PROOF_INVALID');
 if(expires<=now)return fail('AUDIT_PRE_SESSION_EXPIRED');
 // Only a still-valid, correctly scoped session can receive a planned renewal.
 // An unexpected 401, 403, changed actor or expired session is never retried here.
 return{action:checks.preSessionFreshnessVerified?'measure':'renew',preflight,checks};
}
