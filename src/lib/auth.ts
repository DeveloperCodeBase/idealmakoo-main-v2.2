import type {CrmAccess} from '@/types/crm';
import type { RoleKey } from '@/types/domain';
import type { Locale } from '@/lib/i18n';
import { localizedPath } from '@/lib/locale-routing';
export interface DemoUser { id:string; role:RoleKey; name:string; email:string; password:string; route:string }
export const demoUsers:DemoUser[] = [
 {id:'demo-customer',role:'customer',name:'کاربر حرفه‌ای',email:'demo.customer@idealmako.invalid',password:'Demo#Cust2026!1',route:'account'},
 {id:'demo-superAdmin',role:'superAdmin',name:'مدیر ارشد سیستم',email:'demo.superadmin@idealmako.invalid',password:'Demo#SupAdm2026!2',route:'admin'},
 {id:'demo-admin',role:'admin',name:'مدیر عملیاتی سایت',email:'demo.admin@idealmako.invalid',password:'Demo#Admin2026!3',route:'admin'},
 {id:'demo-contentEditor',role:'contentEditor',name:'ویراستار محتوا',email:'demo.editor@idealmako.invalid',password:'Demo#Editor2026!4',route:'admin/content'},
 {id:'demo-productManager',role:'productManager',name:'مدیر محصول',email:'demo.pm@idealmako.invalid',password:'Demo#ProdMgr2026!5',route:'admin/products'},
 {id:'demo-scientificReviewer',role:'scientificReviewer',name:'بازبین علمی',email:'demo.reviewer@idealmako.invalid',password:'Demo#SciRev2026!6',route:'admin/reviews'},
 {id:'demo-translator',role:'translator',name:'مترجم',email:'demo.translator@idealmako.invalid',password:'Demo#Trans2026!7',route:'admin/translations'},
 {id:'demo-publisher',role:'publisher',name:'ناشر',email:'demo.publisher@idealmako.invalid',password:'Demo#Publish2026!8',route:'admin/publications'},
 {id:'demo-hr',role:'hr',name:'منابع انسانی',email:'demo.hr@idealmako.invalid',password:'Demo#HrTeam2026!9',route:'admin/hr'},
 {id:'demo-business',role:'business',name:'کارشناس فروش و CRM',email:'demo.business@idealmako.invalid',password:'Demo#BizCrm2026!10',route:'admin/crm'},
 {id:'demo-analyst',role:'analyst',name:'تحلیلگر گزارش‌ها',email:'demo.analyst@idealmako.invalid',password:'Demo#Analyst2026!11',route:'admin/crm/reports'},
 {id:'demo-support',role:'support',name:'کارشناس پشتیبانی',email:'demo.support@idealmako.invalid',password:'Demo#Support2026!12',route:'admin/crm/cases'},
];
export const roles = demoUsers.map(user=>user.role);
export interface FrontSession {id:string;name:string;email:string;phone?:string;phoneVerified?:boolean;role:RoleKey;demo:boolean;mfaEnrollmentRequired?:boolean;mfaEnabled?:boolean;emailVerified?:boolean;allowedLocales?:string[];qualityScope?:boolean;crmAccess?:CrmAccess}
/** Frontend policy shared by routes, navigation, actions and local state guards.
 * A backend must independently authorize every operation and redact its DTOs. */
export const workspaceModules = ['overview','site-control','pages','products','research','news','events','resources','media','translations','reviews','publications','forms','menus','hr','ai','crm','leads','accounts','contacts','opportunities','activities','quotes','pricebooks','samples','handoffs','partners','tickets','segments','campaigns','inbox','automations','success','reports','data','monitoring','communications','staff','roles','migration','settings','knowledge','glossary','profile','preferences'] as const;
export type WorkspaceModule = typeof workspaceModules[number];
export const workspaceActions = ['view','create','edit','archive','export','submit','review','publish','translate','reply','note','assign','stage','convert','merge','import','issue','manage','responses'] as const;
export type WorkspaceAction = typeof workspaceActions[number];
type Grants = Partial<Record<WorkspaceModule, readonly WorkspaceAction[]>>;
const read = ['view','export'] as const;
const content = ['view','create','edit','archive','export','submit','note'] as const;
const operation = ['view','create','edit','archive','export','note','reply','assign','stage','import'] as const;
const editorialModules:WorkspaceModule[] = ['pages','products','research','news','events','resources','knowledge','glossary'];
const crmModules:WorkspaceModule[] = ['leads','accounts','contacts','opportunities','activities','quotes','pricebooks','samples','handoffs','partners','tickets','segments','campaigns','inbox','automations','success'];
const all = Object.fromEntries(workspaceModules.map(module=>[module,workspaceActions])) as Grants;
const admin:Grants = {...all, roles:['view'], staff:['view','create','edit','archive','export','assign']};
const editor:Grants = {overview:['view'], 'site-control':content,pages:content,research:content,news:content,events:content,resources:content,products:['view'],media:content,forms:content,menus:['view','edit','publish','export'],knowledge:content,glossary:content,ai:content,translations:['view'],reviews:['view'],publications:['view'],roles:['view']};
const productManager:Grants = {overview:['view'],products:content,resources:content,media:content,research:['view'],ai:content,reviews:['view'],publications:['view'],roles:['view']};
const scientist:Grants = {overview:['view'],reviews:['view','review'],products:['view','review','note'],research:['view','review','note'],resources:['view','review','note'],pages:['view','review','note'],'site-control':['view'],tickets:['view','note'],roles:['view']};
const translator:Grants = {overview:['view'],communications:['view','translate','submit'],translations:['view','translate','submit','export'],glossary:['view','translate'],ai:['view','create','edit','export'],reviews:['view'],roles:['view']};
const publisher:Grants = {overview:['view'],communications:['view','review','publish','export'],'site-control':['view'],reviews:['view','review'],publications:['view','publish','export'],pages:['view','review','publish','export'],products:['view','publish','export'],research:['view','publish','export'],resources:['view','publish','export'],news:['view','review','publish','export'],events:['view','review','publish','export'],hr:['view','review','publish'],menus:['view'],forms:['view'],roles:['view']};
const business:Grants = {overview:['view'],crm:['view'],reports:['view','export'],data:['view','import','export'],communications:content,roles:['view']};
for(const module of crmModules)business[module] = module==='tickets'?['view','note']:operation;
for(const module of ['accounts','contacts','leads'] as const)business[module]=[...operation,'merge',...(module==='leads'?['convert' as const]:[])];
business.quotes=[...operation,'submit','issue'];
business.pricebooks=[...operation,'submit'];
business.resources=['view'];
business.events=['view'];
const support:Grants = {overview:['view'],tickets:operation,inbox:operation,activities:operation,samples:['view','note'],communications:['view','create','edit','note'],roles:['view']};
export const roleGrants:Record<RoleKey,Grants> = {customer:{},superAdmin:all,admin,contentEditor:editor,productManager,scientificReviewer:scientist,translator,publisher,hr:{overview:['view'],hr:[...content,'reply','assign','stage'],media:['view'],roles:['view']},business,analyst:{overview:['view'],reports:['view','export'],monitoring:['view'],roles:['view']},support};
// Personal settings are scoped to the current account by the user settings store.
// They do not grant access to company settings or to another user's profile.
for(const role of roles)if(role!=='customer'){
 roleGrants[role].profile=['view','edit','export'];
 roleGrants[role].preferences=['view','edit','export'];
}
const routes:Record<string,WorkspaceModule> = {'':'overview',overview:'overview',dashboard:'overview',content:'site-control',cms:'site-control','cms/content':'site-control','site-control':'site-control','page-builder':'pages','page-builder/new':'pages','page-builder/home':'pages','media/library':'media','media/collections':'media','locales/translations':'translations','locales/releases':'publications','locales/reviews':'reviews',users:'staff',Migration:'migration',careers:'hr',quality:'tickets','crm/overview':'crm','crm/pipeline':'opportunities','crm/deliveries':'handoffs','crm/cases':'tickets','crm/customer-success':'success','crm/rfqs':'leads','crm/data':'data'};
for(const module of workspaceModules)routes[module]??=module;
for(const module of [...crmModules,'reports'] as WorkspaceModule[])routes[`crm/${module}`]=module;
for(const module of ['pages','products','research','news','events','resources','menus','forms','knowledge','glossary'] as WorkspaceModule[])routes[`cms/${module}`]=module;
for(const path of ['text','image','video','audio','translation','rewrite','document'])routes[`ai/${path}`]='ai';
for(const path of ['overview','availability','performance','business','content','security','jobs','notifications','ai','storage','infrastructure','recovery'])routes[`monitoring/${path}`]='monitoring';
/** Exact, fail-closed aliases: a permitted prefix never grants arbitrary children. */
const normalizedSection=(section:string)=>section.replace(/^\/+|\/+$/g,'').replace(/^admin(?:\/|$)/,'');
export function canonicalWorkspaceSection(section:string):WorkspaceModule|null {
 const normalized=normalizedSection(section);
 return routes[normalized]??null;
}
export function allowedTranslationLocales(role:string):readonly ('fa'|'en'|'tr'|'ar'|'ru')[]{return role==='translator'?['en','tr','ar','ru']:['fa','en','tr','ar','ru'];}
export function roleLandingRoute(role:string):string{return role==='customer'?'account':'admin';}
/** Signing in or switching demo roles never opts into another account's language. */
export function roleLandingPath(role:string,locale:Locale):string{return localizedPath(locale,roleLandingRoute(role));}
export function canWorkspace(role:string,action:WorkspaceAction,section:string,context:{locale?:string;authorId?:string;actorId?:string;authorRole?:string;allowedLocales?:readonly string[];qualityScope?:boolean}={}):boolean {
 if(!roles.includes(role as RoleKey))return false;
 const module=canonicalWorkspaceSection(section);if(!module)return false;
 const path=normalizedSection(section);
 if(role==='analyst'&&path.startsWith('monitoring/')&& !['overview','availability','performance','business','content'].includes(path.split('/').at(-1)||''))return false;
 const grant=roleGrants[role as RoleKey][module];
 let permitted=!!grant?.includes(action);
 if(role==='translator'&&editorialModules.includes(module)&&['view','translate','submit'].includes(action))permitted=true;
 if(editorialModules.includes(module)&&context.locale&&context.allowedLocales&&['create','edit','archive','submit','review','publish','translate'].includes(action)&&!context.allowedLocales.includes(context.locale))return false;
 if(action==='translate'&&context.locale&&!(context.allowedLocales??allowedTranslationLocales(role)).includes(context.locale))return false;
 if(path==='quality'&&context.qualityScope===false)return false;
 if(action==='review'&&((context.authorId&&context.actorId&&context.authorId===context.actorId)||(!context.authorId&&context.authorRole===role)))return false;
 return permitted;
}
export function authorize(role:string,section:string):boolean {
 const module=canonicalWorkspaceSection(section);
 if(!module||!roles.includes(role as RoleKey)||role==='customer')return false;
 // Translators read source records inside their dedicated translation desk.
 if(role==='translator'&&editorialModules.includes(module)&&module!=='glossary')return false;
 return canWorkspace(role,'view',section);
}
