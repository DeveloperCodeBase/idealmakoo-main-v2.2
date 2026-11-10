import {createHmac,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {canWorkspace} from '../lib/auth';
import type {Locale} from '../lib/i18n';
import {assert,HttpError,locales,type Actor} from './types';
import {audit,query,transaction} from './db';
import {cookies,parse,rateLimit,visitorKey} from './http';
import {config} from './config';
import {verifyGuest} from './crypto';
import {getPublicSite} from './workspace';
import {canonicalPublicPath,indexablePath,publicationAt,publicRouteKind} from './public-routing';
import {getResourcePage} from './resources';
import {loadCrmAccess} from './workspace-scopes';

const targetSchema=z.object({path:z.string().max(500).refine(value=>!value.startsWith('/')&&!value.endsWith('/')&&!/[?#\\\x00-\x20\x7f]/.test(value)&&!value.split('/').includes('..'),'Use a canonical public path.'),locale:z.enum(locales).default('fa')});
const modules:Record<string,string>={product:'products',products:'products',research:'research',article:'research',articles:'research',news:'news',events:'events',event:'events',careers:'hr',hr:'hr',resource:'resources',resources:'resources',page:'pages',pages:'pages',knowledge:'knowledge',glossary:'glossary'};
type Target={path:string;locale:Locale;kind:string};
export async function engagementTarget(body:unknown,client?:PoolClient):Promise<Target>{
  const input=parse(targetSchema.strict(),body),site=await getPublicSite(client);
  const route=publicRouteKind(site,input.locale,input.path?input.path.split('/'):[]);
  assert(indexablePath(input.path)&&route!=='missing',404,'CONTENT_UNAVAILABLE','This public content is unavailable.');
  const path=canonicalPublicPath(site,input.locale,input.path),publication=publicationAt(site,input.locale,path);
  if(route==='managed-resource'){
    try{
      const resource=await getResourcePage(null,path.split('/')[1],input.locale,client);
      assert(resource.visibility==='public',404,'CONTENT_UNAVAILABLE','This public content is unavailable.');
    }catch(error){if(error instanceof HttpError&&([403,404,409,410,422].includes(error.status)||error.code==='FILE_INTEGRITY'))throw new HttpError(404,'CONTENT_UNAVAILABLE','This public content is unavailable.');throw error;}
  }
  return {path,locale:input.locale,kind:publication?.kind||(path.split('/')[0] in modules?path.split('/')[0]:'page')};
}
async function summary(target:Target,actor:Actor|null,client?:PoolClient){
  const run=(sql:string,args:unknown[])=>client?client.query(sql,args):query(sql,args);
  const args=[target.path,target.locale];
  const counts=(await run(`SELECT
    (SELECT count(*)::int FROM content_visits WHERE path=$1 AND locale=$2) AS views,
    (SELECT count(*)::int FROM content_likes WHERE path=$1 AND locale=$2) AS likes,
    (SELECT count(*)::int FROM content_comments c JOIN users u ON u.id=c.user_id AND u.active WHERE c.path=$1 AND c.locale=$2 AND c.state='approved') AS "commentCount"`,args)).rows[0];
  const comments=(await run("SELECT c.id,u.name,c.body,c.created_at AS \"createdAt\" FROM content_comments c JOIN users u ON u.id=c.user_id AND u.active WHERE c.path=$1 AND c.locale=$2 AND c.state='approved' ORDER BY c.created_at DESC,c.id DESC LIMIT 50",args)).rows;
  const liked=actor?!!(await run('SELECT 1 FROM content_likes WHERE path=$1 AND locale=$2 AND user_id=$3',[...args,actor.id])).rowCount:false;
  return {...counts,comments,liked,measurement:'One visit per browser, content and 30-minute window; not a count of unique people.'};
}
export async function getEngagement(actor:Actor|null,body:unknown){return summary(await engagementTarget(body),actor);}
async function verifiedActor(actor:Actor,client:PoolClient){
  const current=await loadCrmAccess(actor,client),user=(await client.query('SELECT email_verified,phone_verified_at FROM users WHERE id=$1',[current.id])).rows[0];
  assert(current.role==='customer'||current.mfaVerified,403,'MFA_REQUIRED','Complete staff MFA first.');
  assert(current.mfaVerified||user?.email_verified||user?.phone_verified_at,403,'CONTACT_VERIFICATION_REQUIRED','Verify your email or sign in with a verified mobile number before interacting.');
  return current;
}
export async function recordContentView(request:Request,body:unknown){
  await rateLimit('content-view:'+visitorKey(request),240,60);
  const target=await engagementTarget(body),guest=cookies(request).im_guest_csrf;
  const browser=verifyGuest(guest)?guest:visitorKey(request),windowStart=new Date(Math.floor(Date.now()/1_800_000)*1_800_000);
  const visitor=createHmac('sha256',config().sessionSecret).update('content-visit:'+windowStart.toISOString().slice(0,10)+':'+browser).digest('hex');
  await query('INSERT INTO content_visits(path,locale,content_kind,window_start,visitor_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',[target.path,target.locale,target.kind,windowStart,visitor]);
  return {recorded:true};
}
export async function createContentComment(actor:Actor,body:unknown){
  const input=parse(targetSchema.extend({body:z.string().trim().min(2).max(4000)}).strict(),body);
  await rateLimit('content-comment:'+actor.id,12,3600);
  return transaction(async client=>{
    actor=await verifiedActor(actor,client);const target=await engagementTarget({path:input.path,locale:input.locale},client),id=randomUUID();
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['content-comment:'+actor.id+':'+target.locale+':'+target.path]);
    const duplicate=(await client.query("SELECT id,state FROM content_comments WHERE user_id=$1 AND path=$2 AND locale=$3 AND body=$4 AND created_at>now()-interval '5 minutes' ORDER BY created_at DESC LIMIT 1",[actor.id,target.path,target.locale,input.body])).rows[0];
    if(duplicate)return {id:duplicate.id,state:duplicate.state};
    await client.query('INSERT INTO content_comments(id,path,locale,content_kind,user_id,body) VALUES($1,$2,$3,$4,$5,$6)',[id,target.path,target.locale,target.kind,actor.id,input.body]);
    await audit(actor.id,'content.comment.submitted','content_comment',id,{locale:target.locale},client);
    return {id,state:'pending'};
  });
}
export async function setContentLike(actor:Actor,body:unknown){
  const input=parse(targetSchema.extend({liked:z.boolean()}).strict(),body);await rateLimit('content-like:'+actor.id,120,60);
  return transaction(async client=>{
    actor=await verifiedActor(actor,client);const target=await engagementTarget({path:input.path,locale:input.locale},client);
    if(input.liked)await client.query('INSERT INTO content_likes(path,locale,content_kind,user_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[target.path,target.locale,target.kind,actor.id]);
    else await client.query('DELETE FROM content_likes WHERE path=$1 AND locale=$2 AND user_id=$3',[target.path,target.locale,actor.id]);
    return summary(target,actor,client);
  });
}
export async function createContentReport(actor:Actor,body:unknown){
  const input=parse(targetSchema.extend({reason:z.string().trim().min(3).max(2000),commentId:z.string().uuid().optional()}).strict(),body);await rateLimit('content-report:'+actor.id,10,3600);
  return transaction(async client=>{
    actor=await verifiedActor(actor,client);const target=await engagementTarget({path:input.path,locale:input.locale},client),id=randomUUID();
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['content-report:'+actor.id+':'+target.locale+':'+target.path]);
    if(input.commentId)assert((await client.query("SELECT 1 FROM content_comments WHERE id=$1 AND path=$2 AND locale=$3 AND state='approved' FOR SHARE",[input.commentId,target.path,target.locale])).rowCount,404,'COMMENT_UNAVAILABLE','This comment is unavailable.');
    const duplicate=(await client.query("SELECT id FROM content_reports WHERE user_id=$1 AND path=$2 AND locale=$3 AND comment_id IS NOT DISTINCT FROM $4::uuid AND state='pending'",[actor.id,target.path,target.locale,input.commentId||null])).rows[0];
    if(duplicate)return {id:duplicate.id,state:'pending'};
    await client.query('INSERT INTO content_reports(id,path,locale,content_kind,user_id,comment_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,target.path,target.locale,target.kind,actor.id,input.commentId||null,input.reason]);
    await audit(actor.id,'content.report.submitted','content_report',id,{locale:target.locale},client);return {id,state:'pending'};
  });
}
async function moderator(actor:Actor,client?:PoolClient){actor=await loadCrmAccess(actor,client);assert(actor.mfaVerified&&['admin','superAdmin','publisher'].includes(actor.role),403,'MODERATION_FORBIDDEN','Your role cannot publish or moderate public comments.');return actor;}
export async function listContentModeration(actor:Actor,body:unknown){
  const input=parse(z.object({locale:z.enum(locales).optional(),state:z.enum(['pending','approved','rejected','resolved','dismissed']).default('pending')}).strict(),body);actor=await moderator(actor);
  const languages=input.locale?[input.locale]:actor.allowedLocales;assert(languages.every(locale=>actor.allowedLocales.includes(locale)),403,'LOCALE_SCOPE','This language is outside your grant.');
  const comments=(await query('SELECT c.id,c.path,c.locale,c.content_kind AS kind,u.name,c.body,c.state,c.version,c.created_at AS "createdAt" FROM content_comments c JOIN users u ON u.id=c.user_id WHERE c.locale=ANY($1::text[]) AND c.state=$2 ORDER BY c.created_at LIMIT 200',[languages,input.state])).rows;
  const reports=(await query('SELECT id,path,locale,content_kind AS kind,comment_id AS "commentId",reason,state,version,created_at AS "createdAt" FROM content_reports WHERE locale=ANY($1::text[]) AND state=$2 ORDER BY created_at LIMIT 200',[languages,input.state])).rows;
  return {comments,reports,limit:200};
}
export async function moderateContent(actor:Actor,table:'comments'|'reports',id:string,body:unknown){
  parse(z.string().uuid(),id);const input=parse(z.object({state:table==='comments'?z.enum(['approved','rejected']):z.enum(['resolved','dismissed']),expectedVersion:z.number().int().positive()}).strict(),body);
  return transaction(async client=>{
    actor=await moderator(actor,client);const relation=table==='comments'?'content_comments':'content_reports';
    const current=(await client.query('SELECT * FROM '+relation+' WHERE id=$1 FOR UPDATE',[id])).rows[0];assert(current&&actor.allowedLocales.includes(current.locale),404,'NOT_FOUND','The moderation item was not found.');
    assert(current.version===input.expectedVersion,409,'CONFLICT','Another moderator changed this item. Reload before deciding.');
    assert(current.user_id!==actor.id,403,'SELF_REVIEW_FORBIDDEN','Another publisher must review your own submission.');
    if(table==='comments'&&input.state==='approved')await engagementTarget({path:current.path,locale:current.locale},client);
    const row=(await client.query('UPDATE '+relation+' SET state=$2,version=version+1,moderated_by=$3,moderated_at=clock_timestamp() WHERE id=$1 RETURNING id,state,version',[id,input.state,actor.id])).rows[0];
    await audit(actor.id,'content.'+table+'.'+input.state,relation,id,{locale:current.locale,version:row.version},client);return row;
  });
}
export async function contentAnalytics(actor:Actor,body:unknown={}){
  const input=parse(z.object({days:z.coerce.number().int().min(1).max(365).default(30),locale:z.enum(locales).optional()}).strict(),body);actor=await loadCrmAccess(actor);assert(actor.role!=='customer'&&actor.mfaVerified&&canWorkspace(actor.role,'view','overview'),403,'REPORT_FORBIDDEN','Staff MFA and report access are required for content analytics.');
  const languages=input.locale?[input.locale]:actor.allowedLocales;assert(languages.every(value=>actor.allowedLocales.includes(value)),403,'LOCALE_SCOPE','This language is outside your grant.');
  const all=['superAdmin','admin','analyst'].includes(actor.role),kinds=Object.keys(modules).filter(kind=>all||canWorkspace(actor.role,'view',modules[kind]));
  const params=[input.days,languages,kinds];
  const rows=(await query(`WITH events AS (
    SELECT path,locale,content_kind,1 AS views,0 AS likes,0 AS comments,0 AS pending,0 AS reports FROM content_visits WHERE created_at>=now()-($1*interval '1 day')
    UNION ALL SELECT path,locale,content_kind,0,1,0,0,0 FROM content_likes WHERE created_at>=now()-($1*interval '1 day')
    UNION ALL SELECT path,locale,content_kind,0,0,(state='approved')::int,(state='pending')::int,0 FROM content_comments WHERE created_at>=now()-($1*interval '1 day')
    UNION ALL SELECT path,locale,content_kind,0,0,0,0,1 FROM content_reports WHERE created_at>=now()-($1*interval '1 day')
  ) SELECT path,locale,content_kind AS kind,sum(views)::int AS views,sum(likes)::int AS likes,sum(comments)::int AS comments,sum(pending)::int AS "pendingComments",sum(reports)::int AS reports,
    (sum(sum(views)) OVER())::int AS "totalViews",(sum(sum(likes)) OVER())::int AS "totalLikes",(sum(sum(comments)) OVER())::int AS "totalComments",(sum(sum(pending)) OVER())::int AS "totalPending",(sum(sum(reports)) OVER())::int AS "totalReports",(count(*) OVER())::int AS "totalItems"
    FROM events WHERE locale=ANY($2::text[]) AND content_kind=ANY($3::text[]) GROUP BY path,locale,content_kind ORDER BY sum(views) DESC,path LIMIT 1000`,params)).rows;
  const daily=(await query("SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day,count(*)::int AS views FROM content_visits WHERE created_at>=now()-($1*interval '1 day') AND locale=ANY($2::text[]) AND content_kind=ANY($3::text[]) GROUP BY 1 ORDER BY 1",params)).rows;
  const first=rows[0],summary={views:first?.totalViews||0,likes:first?.totalLikes||0,comments:first?.totalComments||0,pendingComments:first?.totalPending||0,reports:first?.totalReports||0};
  const items=rows.map(({totalViews:_views,totalLikes:_likes,totalComments:_comments,totalPending:_pending,totalReports:_reports,totalItems:_total,...row})=>row),totalItems=first?.totalItems||0;
  return {summary,items,daily,days:input.days,scope:all?'organization':'role',limit:1000,totalItems,truncated:totalItems>items.length,measurement:'Visits are deduplicated per browser and content in 30-minute windows. Not unique people. Likes are current likes created within the period. Dates are UTC. Totals include all authorized content; at most 1,000 detail rows are returned.'};
}
