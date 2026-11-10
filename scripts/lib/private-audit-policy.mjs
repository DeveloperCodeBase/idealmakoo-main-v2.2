import {createHash,createHmac} from 'node:crypto';

export const auditLocales=['fa','en','tr','ar','ru'];
export const auditRoles=['superAdmin','customer','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support'];
const loopback=new Set(['127.0.0.1','localhost','[::1]']);
const disposableName=/^(?:idealmakoo_test|idealmakoo_acceptance\d*_\d{13}_[a-f0-9]{8}|idealmakoo_repair_acceptance_\d{13}_[a-f0-9]{6})$/;
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const auditHash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');

/** No operational database, remote host or ambient fallback can enable this fixture. */
export function privateAuditContext(environment,baseUrl){
 if(environment.LIGHTHOUSE_DISPOSABLE_AUTH_AUDIT!=='true')throw new Error('Private audit requires LIGHTHOUSE_DISPOSABLE_AUTH_AUDIT=true.');
 if(environment.NODE_ENV!=='production'||environment.DEMO_MODE==='true'||environment.NEXT_PUBLIC_DEMO_MODE==='true'||environment.NEXT_PUBLIC_DATA_MODE==='local')throw new Error('Private audit requires the actual production server adapter.');
 if(!environment.TEST_DATABASE_URL||!environment.DATABASE_URL||!environment.SITE_URL)throw new Error('Private audit requires explicit TEST_DATABASE_URL, DATABASE_URL and SITE_URL.');
 let test,runtime,base,site;try{test=new URL(environment.TEST_DATABASE_URL);runtime=new URL(environment.DATABASE_URL);base=new URL(baseUrl);site=new URL(environment.SITE_URL);}catch{throw new Error('Private audit requires valid explicit database and site URLs.');}
 for(const database of[test,runtime])if(!['postgres:','postgresql:'].includes(database.protocol)||!loopback.has(database.hostname)||database.search||database.hash)throw new Error('Private audit requires a loopback database without connection options.');
 const databaseName=decodeURIComponent(test.pathname.slice(1));
 if(!disposableName.test(databaseName)||test.hostname!==runtime.hostname||(test.port||'5432')!==(runtime.port||'5432')||test.pathname!==runtime.pathname)throw new Error('Private audit is limited to matching named disposable test databases.');
 for(const origin of[base,site])if(!['http:','https:'].includes(origin.protocol)||!loopback.has(origin.hostname)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)throw new Error('Private audit requires a loopback application origin without credentials or a path.');
 if(base.origin!==site.origin)throw new Error('The audited origin must exactly match the disposable runtime SITE_URL.');
 if(environment.TRUST_PROXY==='true'&&base.hostname!=='127.0.0.1')throw new Error('Trusted-proxy private audits require explicit IPv4 loopback.');
 if(!/^[a-f0-9]{64}$/i.test(environment.MFA_ENCRYPTION_KEY||'')||(environment.SESSION_SECRET||'').length<32)throw new Error('Private audit requires the disposable runtime authentication keys.');
 // Requests created for a genuine owned-detail view must remain inside the
 // disposable environment. The audit never sends email, SMS or webhooks.
 if(environment.NOTIFICATIONS_MODE==='live')throw new Error('Disable external notification delivery before preparing private audit fixtures.');
 for(const key of['SMTP_URL','SMTP_HOST','SMTP_PASSWORD','RESEND_API_KEY','BREVO_API_KEY','SENDGRID_API_KEY','SMS_API_KEY','SMS_WEBHOOK_URL','NOTIFICATION_WEBHOOK_URL','KAVENEGAR_API_KEY','TELEGRAM_BOT_TOKEN','NAJVA_API_KEY'])if(environment[key]?.trim())throw new Error('Disable outbound providers before preparing private audit fixtures.');
 return{baseUrl:base.origin,databaseName,databaseUrl:environment.TEST_DATABASE_URL,databaseIdentity:auditHash(test.hostname+':'+(test.port||'5432')+'/'+databaseName)};
}

/** Passwords are derived in memory from an existing test-runtime secret only. */
export function privateFixtureActor(runId,role,key){
 if(!uuid.test(runId)||!auditRoles.includes(role)||!/^[a-f0-9]{64}$/i.test(key||''))throw new Error('Invalid owned private-audit fixture identity.');
 const value=auditHash('idealmakoo-private-lighthouse-user-v1:'+runId+':'+role),id=`${value.slice(0,8)}-${value.slice(8,12)}-4${value.slice(13,16)}-a${value.slice(17,20)}-${value.slice(20,32)}`;
 const allowedLocales=role==='translator'?auditLocales.filter(locale=>locale!=='fa'):[...auditLocales];
 return{id,role,allowedLocales,email:`lighthouse-${runId.slice(0,8)}-${role.toLowerCase()}@example.test`,name:`Lighthouse fixture ${role}`,password:'Audit-'+createHmac('sha256',Buffer.from(key,'hex')).update('private-audit-password-v1:'+runId+':'+role).digest('base64url')+'-aA9!'};
}

/** A selector can name one existing principal-role page, never an arbitrary URL or owned record. */
export function privateAuditTargetPath(sitePaths,value){
 if(value===undefined)return undefined;
 const match=typeof value==='string'&&value.length<=512&&/^\/(fa|en|tr|ar|ru)\/((?:admin|account)(?:\/[A-Za-z0-9_-]+)*)\/$/.exec(value);
 if(!match||!sitePaths.includes(match[2]))throw new Error('The private target must be one exact registered, query-free localized protected path.');
 return value;
}

export function privateAuditJobs(sitePaths,baseUrl,requestId,{pilot=false,representative=false,device='mobile',authorize=()=>true,targetPath}={}){
 targetPath=privateAuditTargetPath(sitePaths,targetPath);
 if(Number(pilot)+Number(representative)+Number(targetPath!==undefined)>1)throw new Error('Choose one private scope: pilot, representative, selected target, or the default full inventory.');
 if(!/^IM-REQ-[a-f0-9-]{36}$/.test(requestId)||!uuid.test(requestId.slice(7)))throw new Error('A real owned request identity is required for detail coverage.');
 if(!['mobile','desktop'].includes(device))throw new Error('Invalid private audit device.');
 const protectedPaths=sitePaths.filter(route=>/^(?:admin|account)(?:\/|$)/.test(route));
 const make=(route,locale,role,kind,query='')=>{
  if(!protectedPaths.includes(route)||!auditLocales.includes(locale)||!auditRoles.includes(role))throw new Error('An audit target is not a registered protected route.');
  if(route.startsWith('admin')&&!authorize(role,route.slice(5).replace(/^\//,'')))throw new Error('The selected role cannot access this registered workspace route.');
  const url=new URL(`/${locale}/${route}/`+query,baseUrl).href;
  return{id:auditHash(url+'|'+device+'|'+role).slice(0,16),url,route,locale,role,kind,device,expectedStatus:200,indexed:false};
 };
 if(pilot)return[make('admin','fa','superAdmin','workspace'),make('admin/pages','en','superAdmin','workspace'),make('account/requests','fa','customer','owned-request-detail','?id='+requestId)];
 const jobs=protectedPaths.flatMap(route=>auditLocales.map(locale=>make(route,locale,route.startsWith('admin')?'superAdmin':'customer',route.startsWith('admin')?'workspace':'account')));
 jobs.push(...auditLocales.map(locale=>make('account/requests',locale,'customer','owned-request-detail','?id='+requestId)));
 const representatives={admin:'admin/settings',contentEditor:'admin/content',productManager:'admin/products',scientificReviewer:'admin/reviews',translator:'admin/translations',publisher:'admin/publications',hr:'admin/hr',business:'admin/crm',analyst:'admin/crm/reports',support:'admin/crm/cases'};
 for(const [role,route] of Object.entries(representatives))for(const locale of['fa','en'])jobs.push(make(route,locale,role,'representative-role'));
 jobs.sort((a,b)=>auditRoles.indexOf(a.role)-auditRoles.indexOf(b.role)||a.url.localeCompare(b.url,'en'));
 if(representative){
  // Select real jobs from the complete inventory, preserving their identities,
  // role checks and owned-detail query. Coverage is explicitly representative.
  return jobs.filter(job=>job.kind==='representative-role'
   ||job.role==='superAdmin'&&(job.route==='admin'&&job.locale==='fa'||job.route==='admin/pages'&&job.locale==='en')
   ||job.role==='customer'&&(job.route==='account'&&job.locale==='fa'||job.kind==='owned-request-detail'&&job.locale==='en'));
 }
 if(targetPath!==undefined){
  const selected=jobs.filter(job=>['workspace','account'].includes(job.kind)&&new URL(job.url).pathname===targetPath&&!new URL(job.url).search&&!new URL(job.url).hash);
  if(selected.length!==1)throw new Error('The private target must resolve to exactly one registered principal-role job.');
  return selected;
 }
 return jobs;
}
