import {z} from 'zod';
import type {PoolClient} from 'pg';
import type {Actor} from './types';
import type {UploadPolicyLimits,ManagedStoragePolicy,PublicUploadPolicy} from '../lib/upload-policy';
import {HARD_MAX_UPLOAD_BYTES,MULTIPART_OVERHEAD_BYTES,UPLOAD_MIME_TYPES,effectiveFileLimit} from '../lib/upload-policy';
import {query,transaction,audit} from './db';
import {assert,HttpError} from './types';
import {loadCrmAccess} from './workspace-scopes';
import {canWorkspace} from '../lib/auth';
import {parse} from './http';

const amount=z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const fileAmount=amount.max(HARD_MAX_UPLOAD_BYTES);
export const storagePolicySchema=z.object({
  maxFileBytes:fileAmount,
  byType:z.object({image:fileAmount,document:fileAmount,video:fileAmount,audio:fileAmount}).strict(),
  totalBytes:amount,userBytes:amount,guestBytes:amount,
}).strict().superRefine((value,ctx)=>{
  for(const [kind,bytes] of Object.entries(value.byType))if(bytes>value.maxFileBytes)ctx.addIssue({code:'custom',message:'Type limit must not exceed the overall file limit.',path:['byType',kind]});
  if(value.userBytes>value.totalBytes)ctx.addIssue({code:'custom',message:'Account quota must not exceed the site quota.',path:['userBytes']});
  if(value.guestBytes>value.totalBytes)ctx.addIssue({code:'custom',message:'Guest quota must not exceed the site quota.',path:['guestBytes']});
});
function envBytes(key:string,fallback:number){
  const raw=process.env[key];if(raw===undefined||raw==='')return fallback;
  assert(/^[1-9]\d*$/.test(raw)&&Number.isSafeInteger(Number(raw)),503,'STORAGE_CONFIG','Upload and storage environment limits must be positive integer byte values.');
  return Number(raw);
}
export function defaultStoragePolicy():UploadPolicyLimits{
  const maxFileBytes=envBytes('UPLOAD_MAX_FILE_BYTES',20*1024*1024),totalBytes=envBytes('STORAGE_QUOTA_BYTES',10*1024**3);
  const value={maxFileBytes,byType:{image:envBytes('UPLOAD_MAX_IMAGE_BYTES',maxFileBytes),document:envBytes('UPLOAD_MAX_DOCUMENT_BYTES',maxFileBytes),video:envBytes('UPLOAD_MAX_VIDEO_BYTES',maxFileBytes),audio:envBytes('UPLOAD_MAX_AUDIO_BYTES',maxFileBytes)},totalBytes,userBytes:envBytes('STORAGE_USER_QUOTA_BYTES',Math.min(totalBytes,1024**3)),guestBytes:envBytes('STORAGE_GUEST_QUOTA_BYTES',Math.min(totalBytes,100*1024**2))};
  const parsed=storagePolicySchema.safeParse(value);
  assert(parsed.success,503,'STORAGE_CONFIG','Upload defaults are invalid. File/type limits must not exceed 80 MiB and account/guest quotas must fit the site quota.');
  return parsed.data;
}
type PolicyRow={version:number;limits:unknown;updated_at:Date};
export async function currentStoragePolicy(client?:PoolClient){
  const sql='SELECT version,limits,updated_at FROM storage_policy WHERE singleton=true';
  const row=(await (client?client.query<PolicyRow>(sql):query<PolicyRow>(sql))).rows[0];
  assert(row,503,'STORAGE_MIGRATION_REQUIRED','The storage policy migration must be installed before uploads.');
  const parsed=row.limits===null?null:storagePolicySchema.safeParse(row.limits);
  if(parsed&&!parsed.success)throw new HttpError(503,'STORAGE_POLICY_INVALID','The stored upload policy requires an administrator review.');
  return{version:Number(row.version),limits:parsed?.success?parsed.data:defaultStoragePolicy(),source:row.limits===null?'environment' as const:'database' as const,updatedAt:row.updated_at.toISOString()};
}
export async function initializeStoragePolicy(){
  return transaction(async client=>{
    await client.query('SELECT pg_advisory_xact_lock(917264834)');
    const current=await currentStoragePolicy(client);
    if(current.source==='environment')await client.query('UPDATE storage_policy SET limits=$1::jsonb,updated_at=now() WHERE singleton=true AND limits IS NULL',[JSON.stringify(current.limits)]);
    return currentStoragePolicy(client);
  });
}
export function assertFilePolicy(limits:UploadPolicyLimits,bytes:number,mime:string,ownerId:string|null){
  const max=Math.min(effectiveFileLimit(limits,mime),ownerId?limits.userBytes:limits.guestBytes);
  assert(bytes>0&&bytes<=max,413,'UPLOAD_SIZE','This file exceeds the current administrator-defined file/type limit. Refresh the upload policy before retrying.');
}
export async function publicUploadPolicy(actor:Actor|null,hasGuest:boolean):Promise<PublicUploadPolicy>{
  if(actor)actor=await loadCrmAccess(actor);
  const current=await currentStoragePolicy(),subjectLimit=actor?current.limits.userBytes:current.limits.guestBytes;
  const maxFileBytes=Math.min(current.limits.maxFileBytes,subjectLimit);
  return{version:current.version,maxFileBytes,byType:Object.fromEntries(Object.entries(current.limits.byType).map(([key,value])=>[key,Math.min(value,maxFileBytes)])) as PublicUploadPolicy['byType'],maxRequestBytes:maxFileBytes+MULTIPART_OVERHEAD_BYTES,allowedMimeTypes:UPLOAD_MIME_TYPES,canUploadLibrary:!!actor&&actor.mfaVerified&&canWorkspace(actor.role,'create','media'),canUploadAttachment:actor?actor.role==='customer'||actor.mfaVerified:hasGuest};
}
async function storageAdministrator(actor:Actor,client?:PoolClient){
  actor=await loadCrmAccess(actor,client);
  assert(actor.mfaVerified&&['superAdmin','admin'].includes(actor.role)&&canWorkspace(actor.role,'manage','settings'),403,'FORBIDDEN','Current administrative access and MFA are required to manage upload limits.');
  return actor;
}
async function usage(client?:PoolClient){
  const sql="SELECT (SELECT coalesce(sum(bytes),0)::text FROM assets WHERE storage_purged_at IS NULL) AS stored,(SELECT coalesce(sum(bytes),0)::text FROM storage_reservations WHERE state='reserved') AS reserved";
  return(await (client?client.query<{stored:string;reserved:string}>(sql):query<{stored:string;reserved:string}>(sql))).rows[0];
}
export async function getManagedStoragePolicy(actor:Actor):Promise<ManagedStoragePolicy>{
  await storageAdministrator(actor);
  const current=await currentStoragePolicy(),occupied=await usage();
  return{...current,usage:{storedBytes:occupied.stored,reservedBytes:occupied.reserved,quotaBytes:String(current.limits.totalBytes)},hardMaxFileBytes:HARD_MAX_UPLOAD_BYTES,canEdit:true};
}
export async function saveManagedStoragePolicy(actor:Actor,body:unknown):Promise<ManagedStoragePolicy>{
  await storageAdministrator(actor);
  const input=parse(z.object({expectedVersion:z.number().int().positive(),limits:storagePolicySchema}).strict(),body);
  return transaction(async client=>{
    await client.query('SELECT singleton FROM workspace_meta WHERE singleton=true FOR UPDATE');
    actor=await storageAdministrator(actor,client);
    await client.query('SELECT pg_advisory_xact_lock(917264834)');
    const current=await currentStoragePolicy(client);
    assert(current.version===input.expectedVersion,409,'STORAGE_POLICY_CONFLICT','Upload policy changed in another session. Refresh and review before saving.');
    const row=(await client.query<PolicyRow>('UPDATE storage_policy SET limits=$1::jsonb,version=version+1,updated_by=$2,updated_at=now() WHERE singleton=true AND version=$3 RETURNING version,limits,updated_at',[JSON.stringify(input.limits),actor.id,input.expectedVersion])).rows[0];
    assert(row,409,'STORAGE_POLICY_CONFLICT','Upload policy changed in another session.');
    await audit(actor.id,'storage.policy.updated','storage_policy','site',{previousVersion:current.version,version:row.version,previous:current.limits,limits:input.limits},client);
    const occupied=await usage(client);
    return{version:Number(row.version),limits:input.limits,source:'database',updatedAt:row.updated_at.toISOString(),usage:{storedBytes:occupied.stored,reservedBytes:occupied.reserved,quotaBytes:String(input.limits.totalBytes)},hardMaxFileBytes:HARD_MAX_UPLOAD_BYTES,canEdit:true};
  });
}
