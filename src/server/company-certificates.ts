import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import type {Locale} from '../lib/i18n';
import type {WorkspaceAction} from '../lib/auth';
import {canWorkspace} from '../lib/auth';
import type {CertificateDefinition,CertificateCapabilities,CertificateRevision,CertificateSource,CertificateStatus,ManagedCompanyCertificate,PublicCompanyCertificate} from '../types/company-certificates';
import type {Actor} from './types';
import {assert,HttpError,locales} from './types';
import {parse} from './http';
import {transaction,audit} from './db';
import {loadCrmAccess} from './workspace-scopes';
import {lockWorkspace} from './workspace';
import {checksum} from './workspace-policy';
import {certificateResourceSources} from './resources';
import {enqueueAccountNotification} from './notification-policy';

const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const realDate=(value:string)=>datePattern.test(value)&&value>='1900-01-01'&&value<='2200-12-31'&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const optionalDate=z.string().refine(value=>value===''||realDate(value),'Use a real YYYY-MM-DD calendar date.');
const text=(max:number)=>z.string().trim().max(max).refine(value=>!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),'Control characters are not accepted.');
const issuerUrl=text(2000).refine(value=>{if(!value)return true;try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password;}catch{return false;}},'Use an HTTPS issuer URL without embedded credentials.');
export const companyCertificateDefinitionSchema=z.object({title:text(240),summary:text(5000),issuer:text(240),certificateNumber:text(200),standard:text(240),validFrom:optionalDate,validUntil:optionalDate,issuerUrl,resourceId:z.string().uuid().nullable(),resourceVersionId:z.string().uuid().nullable()}).strict().refine(value=>(value.resourceId===null)===(value.resourceVersionId===null),'Select a resource and its exact version together.').refine(value=>!value.validFrom||!value.validUntil||value.validUntil>=value.validFrom,'The expiry cannot precede the start of validity.');
const localeSchema=z.enum(locales);
const reasonSchema=text(2000).min(10);
const command=z.object({locale:localeSchema,expectedVersion:z.number().int().positive()}).strict();
interface CertificateRow {id:string;slug:string;version:number;archived:boolean;revoked_at:Date|null;revoked_by:string|null;revocation_reason:string|null;created_by:string;updated_by:string;created_at:Date;updated_at:Date}
interface RevisionRow {id:string;certificate_id:string;locale:Locale;number:number;definition:CertificateDefinition;checksum:string;resource_id:string|null;resource_version_id:string|null;valid_from:Date|null;valid_until:Date|null;created_by:string;created_at:Date}
interface ReviewRow {id:string;revision_id:string;decision:'approved'|'rejected';reviewer_id:string;reviewer_role:string;reason:string;created_at:Date;reviewer_name:string}
interface ReleaseRow {certificate_id:string;locale:Locale;revision_id:string;review_id:string;published_by:string;published_at:Date;withdrawn_at:Date|null;withdrawn_reason:string|null}
interface AlertRow {id:string;revision_id:string;user_id:string;state:'expiring'|'expired';result:'queued'|'suppressed';outbox_id:string|null}
const reviewSelect='SELECT a.*,u.name AS reviewer_name FROM company_certificate_reviews a JOIN users u ON u.id=a.reviewer_id';
const allowed=(actor:Actor,action:WorkspaceAction,locale:Locale)=>actor.role!=='customer'&&actor.mfaVerified&&actor.allowedLocales.includes(locale)&&canWorkspace(actor.role,action,'resources');
function validId(id:string){assert(z.string().uuid().safeParse(id).success,404,'NOT_FOUND','Certificate not found.');}
async function currentActor(client:PoolClient,actor:Actor,locale:Locale,action:WorkspaceAction='view'){
  actor=await loadCrmAccess(actor,client);
  assert(allowed(actor,action,locale),403,'CERTIFICATE_PERMISSION','Current staff MFA, resource permission and the selected content language are required.');
  return actor;
}
async function certificate(client:PoolClient,id:string){validId(id);const row=(await client.query<CertificateRow>('SELECT * FROM company_certificates WHERE id=$1 FOR UPDATE',[id])).rows[0];assert(row,404,'NOT_FOUND','Certificate not found.');return row;}
function expected(row:CertificateRow,value:number){assert(row.version===value,409,'CONFLICT','The certificate changed. Compare the current server revision before saving.');}
async function nextVersion(client:PoolClient,actor:Actor,id:string){return(await client.query<CertificateRow>('UPDATE company_certificates SET version=version+1,updated_by=$2,updated_at=now() WHERE id=$1 RETURNING *',[id,actor.id])).rows[0];}
function definitionOf(row:RevisionRow):CertificateDefinition{
  const value=companyCertificateDefinitionSchema.safeParse(row.definition);
  assert(value.success&&checksum(row.definition)===row.checksum,500,'CERTIFICATE_INTEGRITY','The stored certificate revision is inconsistent.');
  assert(value.data.resourceId===row.resource_id&&value.data.resourceVersionId===row.resource_version_id,500,'CERTIFICATE_INTEGRITY','The retained certificate evidence differs from its revision.');
  return value.data;
}
async function revision(client:PoolClient,id:string,certificateId?:string){const row=(await client.query<RevisionRow>('SELECT * FROM company_certificate_revisions WHERE id=$1'+(certificateId?' AND certificate_id=$2':''),certificateId?[id,certificateId]:[id])).rows[0];assert(row,404,'NOT_FOUND','Certificate revision not found.');definitionOf(row);return row;}
async function draftRevision(client:PoolClient,id:string,locale:Locale){const selected=(await client.query<{revision_id:string}>('SELECT revision_id FROM company_certificate_drafts WHERE certificate_id=$1 AND locale=$2',[id,locale])).rows[0];return selected?revision(client,selected.revision_id,id):null;}
async function latestReview(client:PoolClient,revisionId:string){return(await client.query<ReviewRow>(reviewSelect+' WHERE a.revision_id=$1 ORDER BY a.id DESC LIMIT 1',[revisionId])).rows[0]||null;}
async function activeRelease(client:PoolClient,id:string,locale:Locale){return(await client.query<ReleaseRow>('SELECT * FROM company_certificate_releases WHERE certificate_id=$1 AND locale=$2 AND withdrawn_at IS NULL',[id,locale])).rows[0]||null;}
async function allSavedLocales(client:PoolClient,row:CertificateRow,actor:Actor){const rows=(await client.query<{locale:Locale}>('SELECT locale FROM company_certificate_drafts WHERE certificate_id=$1 UNION SELECT locale FROM company_certificate_releases WHERE certificate_id=$1',[row.id])).rows;return rows.every(value=>actor.allowedLocales.includes(value.locale));}
async function source(client:PoolClient,row:RevisionRow):Promise<CertificateSource|null>{
  const value=definitionOf(row);if(!value.resourceId||!value.resourceVersionId)return null;
  const item=(await certificateResourceSources(client,row.locale,{resourceId:value.resourceId,versionId:value.resourceVersionId}))[0];
  if(!item)return null;
  const {title:_title,...publicSource}=item;return publicSource;
}
export function companyCertificateStatus(value:Pick<CertificateDefinition,'validFrom'|'validUntil'>,revoked:boolean,sourceAvailable:boolean,at=new Date()):CertificateStatus{
  const today=at.toISOString().slice(0,10);
  if(revoked)return'revoked';
  if(value.validUntil<today)return'expired';
  if(value.validFrom>today)return'not-yet-valid';
  if(!sourceAvailable)return'source-unavailable';
  return Date.parse(value.validUntil+'T00:00:00Z')-Date.parse(today+'T00:00:00Z')<=30*86400000?'expiring':'current';
}
async function publicDto(client:PoolClient,row:CertificateRow,release:ReleaseRow):Promise<PublicCompanyCertificate>{
  const saved=await revision(client,release.revision_id,row.id),value=definitionOf(saved),evidence=await source(client,saved);
  return{id:row.id,slug:row.slug,locale:saved.locale,revisionId:saved.id,title:value.title,summary:value.summary,issuer:value.issuer,certificateNumber:value.certificateNumber,standard:value.standard,validFrom:value.validFrom,validUntil:value.validUntil,issuerUrl:value.issuerUrl,status:companyCertificateStatus(value,!!row.revoked_at,!!evidence),source:evidence,publishedAt:release.published_at.toISOString()};
}
async function revisionDto(client:PoolClient,row:RevisionRow):Promise<CertificateRevision>{const review=await latestReview(client,row.id);return{id:row.id,number:row.number,locale:row.locale,definition:definitionOf(row),createdAt:row.created_at.toISOString(),review:review?{decision:review.decision,reviewerName:review.reviewer_name,reviewedAt:review.created_at.toISOString()}:null};}
async function capabilities(client:PoolClient,actor:Actor,row:CertificateRow,locale:Locale,draft:RevisionRow|null):Promise<CertificateCapabilities>{
  const editable=!row.archived&&!row.revoked_at,all=await allSavedLocales(client,row,actor);
  return{edit:editable&&allowed(actor,'edit',locale),review:editable&&!!draft&&draft.created_by!==actor.id&&actor.qualityScope&&allowed(actor,'review',locale),publish:editable&&!!draft&&allowed(actor,'publish',locale),revoke:!row.revoked_at&&all&&actor.qualityScope&&allowed(actor,'publish',locale),archive:all&&allowed(actor,'archive',locale)};
}
async function managedDto(client:PoolClient,actor:Actor,row:CertificateRow,locale:Locale):Promise<ManagedCompanyCertificate>{
  const draft=await draftRevision(client,row.id,locale),release=await activeRelease(client,row.id,locale),history=(await client.query<RevisionRow>('SELECT * FROM company_certificate_revisions WHERE certificate_id=$1 AND locale=$2 ORDER BY number DESC LIMIT 30',[row.id,locale])).rows;
  return{id:row.id,slug:row.slug,version:row.version,locale,draft:draft?definitionOf(draft):null,draftRevisionId:draft?.id||null,revisions:await Promise.all(history.map(value=>revisionDto(client,value))),published:release?await publicDto(client,row,release):null,revokedAt:row.revoked_at?.toISOString()||null,archived:row.archived,capabilities:await capabilities(client,actor,row,locale,draft)};
}
async function insertRevision(client:PoolClient,actor:Actor,row:CertificateRow,locale:Locale,value:CertificateDefinition){
  const prior=await draftRevision(client,row.id,locale),digest=checksum(value);
  if(value.resourceId&&value.resourceVersionId&&(value.resourceId!==prior?.resource_id||value.resourceVersionId!==prior?.resource_version_id))assert((await certificateResourceSources(client,locale,{resourceId:value.resourceId,versionId:value.resourceVersionId})).length,409,'CERTIFICATE_SOURCE','Select a currently public reviewed source version from the certificate selector.');
  if(prior?.checksum===digest)return prior;
  const number=(await client.query<{next:number}>('SELECT coalesce(max(number),0)+1 AS next FROM company_certificate_revisions WHERE certificate_id=$1 AND locale=$2',[row.id,locale])).rows[0].next;
  assert(number<=1000,422,'CERTIFICATE_HISTORY_LIMIT','Preserve this certificate history and create a separate renewal record.');
  const saved=(await client.query<RevisionRow>('INSERT INTO company_certificate_revisions(id,certificate_id,locale,number,definition,checksum,resource_id,resource_version_id,valid_from,valid_until,created_by) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11) RETURNING *',[randomUUID(),row.id,locale,number,JSON.stringify(value),digest,value.resourceId,value.resourceVersionId,value.validFrom||null,value.validUntil||null,actor.id])).rows[0];
  await client.query('INSERT INTO company_certificate_drafts(certificate_id,locale,revision_id) VALUES($1,$2,$3) ON CONFLICT(certificate_id,locale) DO UPDATE SET revision_id=excluded.revision_id',[row.id,locale,saved.id]);return saved;
}
async function requireEvidence(client:PoolClient,row:RevisionRow){const value=definitionOf(row);assert(value.title&&value.summary&&value.issuer&&value.certificateNumber&&value.standard&&value.validFrom&&value.validUntil,422,'CERTIFICATE_INCOMPLETE','Enter the actual title, description, issuer, number, standard and validity dates before review.');const evidence=await source(client,row);assert(evidence,409,'CERTIFICATE_SOURCE','Select a currently published, independently reviewed public resource version with available distribution rights.');return evidence;}
async function allowedReviewer(client:PoolClient,review:ReviewRow,row:RevisionRow){
  if(review.decision!=='approved'||review.reviewer_id===row.created_by)return false;
  try{const actor=await loadCrmAccess({id:review.reviewer_id,name:'',email:'',role:'customer',qualityScope:false,allowedLocales:[],mfaVerified:true},client);return actor.qualityScope&&allowed(actor,'review',row.locale);}catch(error){if(error instanceof HttpError&&error.status<500)return false;throw error;}
}
export async function listPublicCompanyCertificates(localeInput='fa'){
  const locale=parse(localeSchema,localeInput);
  return transaction(async client=>{await lockWorkspace(client);const rows=(await client.query<CertificateRow>("SELECT c.* FROM company_certificates c JOIN company_certificate_releases r ON r.certificate_id=c.id AND r.locale=$1 AND r.withdrawn_at IS NULL WHERE NOT c.archived ORDER BY c.created_at DESC,c.id LIMIT 200 FOR SHARE OF c,r",[locale])).rows;const items:PublicCompanyCertificate[]=[];for(const row of rows){const release=await activeRelease(client,row.id,locale);if(release)items.push(await publicDto(client,row,release));}return{items};});
}
export async function listManagedCompanyCertificates(actor:Actor,localeInput='fa'){
  const locale=parse(localeSchema,localeInput);
  return transaction(async client=>{await lockWorkspace(client);actor=await currentActor(client,actor,locale);const rows=(await client.query<CertificateRow>('SELECT * FROM company_certificates ORDER BY created_at DESC,id LIMIT 200 FOR SHARE')).rows;const items:ManagedCompanyCertificate[]=[];for(const row of rows)items.push(await managedDto(client,actor,row,locale));return{items,canCreate:allowed(actor,'create',locale)};});
}
export async function listCompanyCertificateSources(actor:Actor,localeInput='fa'){
  const locale=parse(localeSchema,localeInput);return transaction(async client=>{await lockWorkspace(client);actor=await currentActor(client,actor,locale);return{items:await certificateResourceSources(client,locale)};});
}
export async function createCompanyCertificate(actor:Actor,body:unknown){
  const input=parse(z.object({slug:z.string().min(2).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),locale:localeSchema,definition:companyCertificateDefinitionSchema}).strict(),body);
  return transaction(async client=>{await lockWorkspace(client);actor=await currentActor(client,actor,input.locale,'create');assert(!(await client.query('SELECT 1 FROM company_certificates WHERE slug=$1',[input.slug])).rowCount,409,'SLUG_CONFLICT','This certificate address is already retained.');const row=(await client.query<CertificateRow>('INSERT INTO company_certificates(id,slug,created_by,updated_by) VALUES($1,$2,$3,$3) RETURNING *',[randomUUID(),input.slug,actor.id])).rows[0];const saved=await insertRevision(client,actor,row,input.locale,input.definition);await audit(actor.id,'certificate.created','company_certificate',row.id,{locale:input.locale,revisionId:saved.id,checksum:saved.checksum},client);return managedDto(client,actor,row,input.locale);});
}
export async function updateCompanyCertificate(actor:Actor,id:string,body:unknown){
  const input=parse(command.extend({definition:companyCertificateDefinitionSchema}).strict(),body);
  return transaction(async client=>{await lockWorkspace(client);actor=await currentActor(client,actor,input.locale,'edit');const row=await certificate(client,id);expected(row,input.expectedVersion);assert(!row.archived&&!row.revoked_at,409,'CERTIFICATE_CLOSED','Restore an archived record first; a revoked identity requires a separate renewal certificate.');const saved=await insertRevision(client,actor,row,input.locale,input.definition);const updated=await nextVersion(client,actor,id);await audit(actor.id,'certificate.revised','company_certificate',id,{locale:input.locale,revisionId:saved.id,checksum:saved.checksum},client);return managedDto(client,actor,updated,input.locale);});
}
export async function reviewCompanyCertificate(actor:Actor,id:string,body:unknown){
  const input=parse(command.extend({decision:z.enum(['approved','rejected']),reason:text(2000).default('')}).strict(),body);
  return transaction(async client=>{await lockWorkspace(client);actor=await currentActor(client,actor,input.locale,'review');assert(actor.qualityScope,403,'QUALITY_SCOPE','Certificate review requires explicit current quality permission.');const row=await certificate(client,id);expected(row,input.expectedVersion);assert(!row.archived&&!row.revoked_at,409,'CERTIFICATE_CLOSED','This certificate is not open for review.');const saved=await draftRevision(client,id,input.locale);assert(saved,404,'NOT_FOUND','Save this language before requesting review.');assert(saved.created_by!==actor.id,403,'SELF_REVIEW','A different qualified reviewer must review the exact saved facts.');if(input.decision==='approved')await requireEvidence(client,saved);else assert(input.reason.length>=10,422,'CERTIFICATE_REASON','Explain the rejected review.');await client.query('INSERT INTO company_certificate_reviews(revision_id,decision,reviewer_id,reviewer_role,reason) VALUES($1,$2,$3,$4,$5)',[saved.id,input.decision,actor.id,actor.role,input.reason]);const updated=await nextVersion(client,actor,id);await audit(actor.id,'certificate.reviewed','company_certificate',id,{locale:input.locale,revisionId:saved.id,decision:input.decision},client);return managedDto(client,actor,updated,input.locale);});
}
export async function publishCompanyCertificate(actor:Actor,id:string,body:unknown){
  const input=parse(command,body);
  return transaction(async client=>{await lockWorkspace(client);actor=await currentActor(client,actor,input.locale,'publish');const row=await certificate(client,id);expected(row,input.expectedVersion);assert(!row.archived&&!row.revoked_at,409,'CERTIFICATE_CLOSED','This certificate cannot be published.');const saved=await draftRevision(client,id,input.locale);assert(saved,404,'NOT_FOUND','Save this language before publication.');await requireEvidence(client,saved);const review=await latestReview(client,saved.id);assert(review&&await allowedReviewer(client,review,saved),409,'CERTIFICATE_REVIEW_REQUIRED','The exact saved revision needs independent approval from a reviewer with current quality, role and language grants.');await client.query('INSERT INTO company_certificate_releases(certificate_id,locale,revision_id,review_id,published_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(certificate_id,locale) DO UPDATE SET revision_id=excluded.revision_id,review_id=excluded.review_id,published_by=excluded.published_by,published_at=now(),withdrawn_at=NULL,withdrawn_reason=NULL',[id,input.locale,saved.id,review.id,actor.id]);const updated=await nextVersion(client,actor,id);await audit(actor.id,'certificate.published','company_certificate',id,{locale:input.locale,revisionId:saved.id,reviewId:review.id},client);return managedDto(client,actor,updated,input.locale);});
}
export async function withdrawCompanyCertificate(actor:Actor,id:string,body:unknown){
  const input=parse(command.extend({reason:reasonSchema}).strict(),body);
  return transaction(async client=>{await lockWorkspace(client);actor=await currentActor(client,actor,input.locale,'publish');const row=await certificate(client,id);expected(row,input.expectedVersion);const released=await activeRelease(client,id,input.locale);assert(released,409,'CERTIFICATE_NOT_PUBLIC','This language has no active public release.');await client.query('UPDATE company_certificate_releases SET withdrawn_at=now(),withdrawn_reason=$3 WHERE certificate_id=$1 AND locale=$2',[id,input.locale,input.reason]);const updated=await nextVersion(client,actor,id);await audit(actor.id,'certificate.withdrawn','company_certificate',id,{locale:input.locale,revisionId:released.revision_id,reason:input.reason},client);return managedDto(client,actor,updated,input.locale);});
}
export async function revokeCompanyCertificate(actor:Actor,id:string,body:unknown){
  const input=parse(z.object({locale:localeSchema.default('fa'),expectedVersion:z.number().int().positive(),reason:reasonSchema}).strict(),body);
  return transaction(async client=>{await lockWorkspace(client);actor=await currentActor(client,actor,input.locale,'publish');assert(actor.qualityScope,403,'QUALITY_SCOPE','Revocation requires current explicit quality permission.');const row=await certificate(client,id);expected(row,input.expectedVersion);assert(await allSavedLocales(client,row,actor),403,'CONTENT_LOCALE','Global revocation requires grants for every saved or released certificate language.');assert(!row.revoked_at,409,'CERTIFICATE_REVOKED','This certificate identity is already irreversibly revoked.');await client.query('UPDATE company_certificates SET revoked_at=now(),revoked_by=$2,revocation_reason=$3 WHERE id=$1',[id,actor.id,input.reason]);const updated=await nextVersion(client,actor,id);await audit(actor.id,'certificate.revoked','company_certificate',id,{reason:input.reason},client);return managedDto(client,actor,updated,input.locale);});
}
export async function setCompanyCertificateState(actor:Actor,id:string,body:unknown){
  const input=parse(z.object({locale:localeSchema.default('fa'),expectedVersion:z.number().int().positive(),archived:z.boolean(),reason:reasonSchema}).strict(),body);
  return transaction(async client=>{await lockWorkspace(client);actor=await currentActor(client,actor,input.locale,'archive');const row=await certificate(client,id);expected(row,input.expectedVersion);assert(await allSavedLocales(client,row,actor),403,'CONTENT_LOCALE','Global archive or restore requires grants for every saved or released language.');await client.query('UPDATE company_certificates SET archived=$2 WHERE id=$1',[id,input.archived]);const updated=await nextVersion(client,actor,id);await audit(actor.id,input.archived?'certificate.archived':'certificate.restored','company_certificate',id,{reason:input.reason},client);return managedDto(client,actor,updated,input.locale);});
}

const alertCopy={fa:{expiring:'نزدیک‌شدن انقضای گواهی شرکت',expired:'گواهی شرکت منقضی شده است',due:'تاریخ پایان اعتبار'},en:{expiring:'Company certificate expires soon',expired:'Company certificate has expired',due:'Validity ends'},tr:{expiring:'Şirket sertifikasının süresi dolmak üzere',expired:'Şirket sertifikasının süresi doldu',due:'Geçerlilik bitişi'},ar:{expiring:'شهادة الشركة توشك على الانتهاء',expired:'انتهت صلاحية شهادة الشركة',due:'نهاية الصلاحية'},ru:{expiring:'Сертификат компании скоро истекает',expired:'Сертификат компании истёк',due:'Срок действия до'}};
async function eligibleAlert(client:PoolClient,row:AlertRow,at:Date){
  const saved=await revision(client,row.revision_id),owner=(await client.query<CertificateRow>('SELECT * FROM company_certificates WHERE id=$1',[saved.certificate_id])).rows[0];
  if(!owner||owner.archived||owner.revoked_at)return null;
  const release=await activeRelease(client,owner.id,saved.locale);if(!release||release.revision_id!==saved.id)return null;
  try{const actor=await loadCrmAccess({id:row.user_id,name:'',email:'',role:'customer',qualityScope:false,allowedLocales:[],mfaVerified:true},client);if(!actor.qualityScope||!allowed(actor,'view',saved.locale))return null;const evidence=await source(client,saved),status=companyCertificateStatus(saved.definition,false,!!evidence,at);if(!evidence||status!==row.state)return null;return{saved,owner,actor};}catch(error){if(error instanceof HttpError&&error.status<500)return null;throw error;}
}
export async function runCompanyCertificateAlerts(limit=100,at=new Date()){
  return transaction(async client=>{await lockWorkspace(client);const selected=(await client.query<{revision_id:string;user_id:string;state:'expiring'|'expired'}>(`SELECT v.id AS revision_id,u.id AS user_id,CASE WHEN v.valid_until<($1::timestamptz AT TIME ZONE 'UTC')::date THEN 'expired' ELSE 'expiring' END AS state FROM company_certificate_releases l JOIN company_certificates c ON c.id=l.certificate_id JOIN company_certificate_revisions v ON v.id=l.revision_id CROSS JOIN users u WHERE l.withdrawn_at IS NULL AND NOT c.archived AND c.revoked_at IS NULL AND u.active AND u.mfa_enabled AND u.quality_scope AND u.role<>'customer' AND u.allowed_locales ? v.locale AND v.valid_until<=($1::timestamptz AT TIME ZONE 'UTC')::date+30 AND v.valid_from<=($1::timestamptz AT TIME ZONE 'UTC')::date AND NOT EXISTS(SELECT 1 FROM company_certificate_alerts a WHERE a.revision_id=v.id AND a.user_id=u.id AND a.state=CASE WHEN v.valid_until<($1::timestamptz AT TIME ZONE 'UTC')::date THEN 'expired' ELSE 'expiring' END) ORDER BY v.valid_until,v.id,u.id LIMIT $2`,[at,Math.max(1,Math.min(100,limit))])).rows;let queued=0,suppressed=0;
    for(const candidate of selected){const id=randomUUID(),alert:AlertRow={...candidate,id,result:'suppressed',outbox_id:null};const permitted=await eligibleAlert(client,alert,at);let outboxId:string|null=null;
      if(permitted){const value=permitted.saved.definition,copy=alertCopy[permitted.saved.locale];outboxId=await enqueueAccountNotification(client,{userId:candidate.user_id,topic:'requests',channel:'in-app',purpose:'transactional',title:copy[candidate.state],body:value.title+' — '+copy.due+': '+value.validUntil,href:`/${permitted.saved.locale}/admin/cms/resources/?certificate=${permitted.owner.id}`,companyCertificateAlertId:id},'company-certificate:'+candidate.revision_id+':'+candidate.user_id+':'+candidate.state);}
      await client.query('INSERT INTO company_certificate_alerts(id,revision_id,user_id,state,result,outbox_id) VALUES($1,$2,$3,$4,$5,$6)',[id,candidate.revision_id,candidate.user_id,candidate.state,outboxId?'queued':'suppressed',outboxId]);if(outboxId)queued++;else suppressed++;
      await audit(null,'certificate.expiry-alert','company_certificate_revision',candidate.revision_id,{alertId:id,revisionId:candidate.revision_id,state:candidate.state,result:outboxId?'queued':'suppressed'},client);
    }
    return{examined:selected.length,queued,suppressed};
  });
}
export async function canDeliverCompanyCertificateAlert(client:PoolClient,payload:Record<string,unknown>):Promise<boolean>{
  if(!payload.companyCertificateAlertId)return true;
  if(typeof payload.companyCertificateAlertId!=='string'||!z.string().uuid().safeParse(payload.companyCertificateAlertId).success)return false;
  const row=(await client.query<AlertRow>('SELECT * FROM company_certificate_alerts WHERE id=$1',[payload.companyCertificateAlertId])).rows[0];
  return!!row&&row.result==='queued'&&row.user_id===payload.userId&&!!await eligibleAlert(client,row,new Date());
}
