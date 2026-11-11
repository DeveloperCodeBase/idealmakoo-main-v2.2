import {canManageSitePage} from '@/lib/page-authority';
import {parsePublicNoticeDefinition} from '@/lib/public-notices';
import {parseGlossaryDefinition} from '@/lib/glossary';
import {parseEditorialSeoByLocale} from '@/lib/editorial-seo';
import type {CrmAccess} from '@/types/crm';
import { allowedTranslationLocales, canWorkspace, type WorkspaceAction } from '@/lib/auth';
import type { PageDraft, WorkspaceRecord, WorkspaceState } from '@/data/workspace-seed';
import { parseCustomProduct } from '@/lib/custom-products';
import { products } from '@/data/catalog';
import { parseProductRelease } from '@/lib/product-release';
import { permittedProductTranslation } from '@/lib/product-translation';

export interface WorkspaceActor { role:string; id:string; locale:string; allowedLocales?:readonly string[]; qualityScope?:boolean; crmAccess?:CrmAccess }
export function matchesWorkspaceSession(value:unknown,actor:WorkspaceActor):boolean {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const session=value as Record<string,unknown>;
 return !!actor.id&&session.id===actor.id&&session.role===actor.role&&canWorkspace(actor.role,'view','overview');
}
export function validWorkspaceSnapshot(value:unknown):value is WorkspaceState {
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const state=value as WorkspaceState;const text=(value:unknown)=>!!value&&typeof value==='object'&&['fa','en','tr','ar','ru'].every(locale=>typeof (value as Record<string,unknown>)[locale]==='string');
 const rows=(value:unknown):value is {id:string}[]=>Array.isArray(value)&&value.every(row=>row&&typeof row==='object'&&typeof row.id==='string')&&new Set(value.map(row=>row.id)).size===value.length;
 return state.version===1&&rows(state.records)&&state.records.every(row=>typeof row.collection==='string'&&canWorkspace('superAdmin','view',row.collection)&&text(row.title)&&text(row.summary)&&typeof row.status==='string'&&typeof row.owner==='string'&&Array.isArray(row.tags)&&row.tags.every(tag=>typeof tag==='string')&&Array.isArray(row.history)&&row.history.every(event=>event&&typeof event.id==='string'&&text(event.text)))&&rows(state.pages)&&state.pages.every(page=>typeof page.title==='string'&&typeof page.summary==='string'&&typeof page.slug==='string'&&['fa','en','tr','ar','ru'].includes(page.locale)&&Array.isArray(page.blocks)&&page.blocks.every(block=>block&&typeof block.id==='string'&&typeof block.type==='string'&&typeof block.title==='string'&&typeof block.body==='string'))&&rows(state.media)&&state.media.every(media=>typeof media.url==='string'&&Array.isArray(media.usage))&&rows(state.forms)&&state.forms.every(form=>text(form.title)&&Array.isArray(form.fields)&&Array.isArray(form.responses))&&rows(state.aiJobs)&&Array.isArray(state.audit)&&state.audit.every(event=>event&&typeof event.id==='string'&&text(event.text))&&!!state.settings&&typeof state.settings==='object';
}
export function canRestoreWorkspaceSnapshot(actor:WorkspaceActor,value:unknown):value is WorkspaceState {
 return canWorkspace(actor.role,'manage','settings')&&canWorkspace(actor.role,'import','data')&&validWorkspaceSnapshot(value);
}
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const contentKinds=['pages','products','research','news','events','resources','knowledge','glossary','hr'];
const operationalKinds=['leads','accounts','contacts','opportunities','activities','quotes','pricebooks','samples','handoffs','partners','tickets','segments','campaigns','inbox','automations','success'];
const isAdmin=(role:string)=>role==='superAdmin'||role==='admin';
export function canReadRecord(role:string,record:WorkspaceRecord):boolean {
 if(!canWorkspace(role,'view',record.collection))return false;
 if(record.tags.includes('quality')&&!['superAdmin','admin','support','scientificReviewer'].includes(role))return false;
 if(role==='scientificReviewer'&&record.collection==='tickets'&&!record.tags.includes('quality'))return false;
 if(record.collection==='hr'&&record.requestId&&!['superAdmin','admin','hr'].includes(role))return false;
 if(role==='support'&&record.collection==='activities'&&record.owner!=='support')return false;
 return true;
}
export function canRecordAction(actor:WorkspaceActor,action:WorkspaceAction,record:WorkspaceRecord):boolean {
 if(record.collection==='hr'&&record.requestId&&['submit','review','publish'].includes(action))return false;
 return canReadRecord(actor.role,record)&&canWorkspace(actor.role,action,record.collection,{...actor,locale:actor.locale,actorId:actor.id,authorId:record.authorId,authorRole:record.author||record.owner});
}
/** Project before rendering, searching or exporting. The raw demo snapshot stays a local backend stand-in. */
export function projectWorkspaceState(state:WorkspaceState,role:string):WorkspaceState {
 const records=state.records.filter(record=>canReadRecord(role,record)).map(record=>role==='scientificReviewer'&&record.collection==='tickets'?{...record,title:{fa:'پرونده کیفیت '+record.id,en:'Quality case '+record.id,tr:'Kalite kaydı '+record.id,ar:'ملف الجودة '+record.id,ru:'Случай качества '+record.id},email:undefined,organization:undefined,amount:undefined,currency:undefined,requestId:undefined,linkedId:undefined,details:undefined}:record);
 const historyIds=new Set(records.flatMap(record=>record.history.map(event=>event.id)));
 const forms=canWorkspace(role,'view','forms')?state.forms.map(form=>({...form,responses:canWorkspace(role,'responses','forms')?form.responses:[]})):[];
 return {version:1,records,pages:canWorkspace(role,'view','pages')?state.pages:[],media:canWorkspace(role,'view','media')?state.media:[],aiJobs:canWorkspace(role,'view','ai')?state.aiJobs:[],forms,audit:isAdmin(role)?state.audit:state.audit.filter(event=>historyIds.has(event.id)),settings:canWorkspace(role,'view','settings')?state.settings:{name:'Ideal Makoo',apiUrl:'',email:'',defaultLocale:state.settings.defaultLocale,compact:state.settings.compact}};
}
export function workspaceInsights(state:WorkspaceState,role:string) {
 const allowed=role==='analyst'?state.records.filter(record=>operationalKinds.includes(record.collection)&&!record.tags.includes('quality')):projectWorkspaceState(state,role).records;
 const counts:Record<string,number>={};const stages:Record<string,number>={};const statuses:Record<string,number>={};
 for(const record of allowed){if(record.status==='archived')continue;counts[record.collection]=(counts[record.collection]||0)+1;statuses[record.status]=(statuses[record.status]||0)+1;if(record.collection==='opportunities')stages[record.status]=(stages[record.status]||0)+1;}
 return {counts,stages,statuses,total:allowed.filter(record=>record.status!=='archived').length};
}
function translationRecord(before:WorkspaceRecord,after:WorkspaceRecord,actor:WorkspaceActor):boolean {
 const ignored=['title','summary','details','status','author','authorId','approvedBy','approvedById','updatedAt','history'];
 for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(!ignored.includes(key)&&!equal(before[key as keyof WorkspaceRecord],after[key as keyof WorkspaceRecord]))return false;
 if(!['draft','review'].includes(after.status))return false;
 const targetAllowed=(locale:string)=>actor.allowedLocales?actor.allowedLocales.includes(locale):allowedTranslationLocales(actor.role).includes(locale as 'fa');
 for(const locale of ['fa','en','tr','ar','ru'] as const)if((before.title[locale]!==after.title[locale]||before.summary[locale]!==after.summary[locale])&&!targetAllowed(locale))return false;
 if(!equal(before.details,after.details)){
  const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
  const original=before.details||{},modified=after.details||{};
  if(!equal({...original,editorialContent:undefined,glossary:undefined,publicNotice:undefined,productDraft:undefined,productReviewDraft:undefined},{...modified,editorialContent:undefined,glossary:undefined,publicNotice:undefined,productDraft:undefined,productReviewDraft:undefined}))return false;
  if((!equal(original.productDraft,modified.productDraft)||!equal(original.productReviewDraft,modified.productReviewDraft))&&!permittedProductTranslation(before,after,targetAllowed,actor.role))return false;
  if(!equal(original.publicNotice,modified.publicNotice)){if(before.collection!=='news')return false;const previous=parsePublicNoticeDefinition(original.publicNotice??{schemaVersion:1,locales:{}}),next=parsePublicNoticeDefinition(modified.publicNotice??{schemaVersion:1,locales:{}});if(!previous||!next)return false;for(const language of ['fa','en','tr','ar','ru'] as const)if(!equal(previous.locales[language]??null,next.locales[language]??null)&&!targetAllowed(language))return false;}
  if(!equal(original.glossary,modified.glossary)){if(before.collection!=='glossary')return false;const sourceGlossary=parseGlossaryDefinition(original.glossary===undefined?{schemaVersion:1,aliases:{}}:original.glossary);const nextGlossary=parseGlossaryDefinition(modified.glossary);if(!sourceGlossary||!nextGlossary)return false;for(const lang of ['fa','en','tr','ar','ru'] as const)if(!equal(sourceGlossary.aliases[lang]||[],nextGlossary.aliases[lang]||[])&&!targetAllowed(lang))return false;}
  if(!equal(original.editorialContent,modified.editorialContent)){
   const source=plain(original.editorialContent)?original.editorialContent:{schemaVersion:1,body:{}};
   const result=modified.editorialContent;
   if(!plain(result)||result.schemaVersion!==1||!plain(source.body)||!plain(result.body)||!equal({...source,body:undefined,seo:undefined},{...result,body:undefined,seo:undefined}))return false;
   if(Object.keys(result.body).some(locale=>!['fa','en','tr','ar','ru'].includes(locale)))return false;
   for(const locale of ['fa','en','tr','ar','ru']){const next=result.body[locale]??'',previous=source.body[locale]??'';if(typeof next!=='string'||next.length>100000||next!==previous&&!targetAllowed(locale))return false;}
   const sourceSeo=parseEditorialSeoByLocale(source.seo??{}),nextSeo=parseEditorialSeoByLocale(result.seo??{});
   if(!sourceSeo||!nextSeo)return false;
   for(const locale of ['fa','en','tr','ar','ru'] as const)if(!equal(sourceSeo[locale],nextSeo[locale])&&!targetAllowed(locale))return false;
  }
 }
 return !after.approvedBy&&!after.approvedById;
}
function changedKeys(before:object,after:object,ignore:string[]=[]):string[]{return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!ignore.includes(key)&&!equal((before as Record<string,unknown>)[key],(after as Record<string,unknown>)[key]));}
export function canChangeRecord(before:WorkspaceRecord|undefined,after:WorkspaceRecord|undefined,actor:WorkspaceActor):boolean {
 if(!before)return !!after&&canReadRecord(actor.role,after)&&canWorkspace(actor.role,'create',after.collection)&&!['approved','published','scheduled','proposal','converted'].includes(after.status)&&!after.approvedBy&&!after.approvedById;
 if(!canReadRecord(actor.role,before))return false;
 if(!after)return canRecordAction(actor,'archive',before);
 if(before.id!==after.id||before.collection!==after.collection)return false;
 if(!canReadRecord(actor.role,after))return false;
 if(before.requestId&&before.collection!=='quotes'&&before.requestId!==after.requestId)return false;
 if(equal(before,after))return true;
 const changes=changedKeys(before,after,['updatedAt','history']);
 const appended=after.history.filter(event=>!before.history.some(old=>old.id===event.id));
 if(before.history.some(event=>!after.history.some(next=>next.id===event.id&&equal(next,event)))&&!canRecordAction(actor,'merge',before))return false;
 if(!changes.length)return appended.every(event=>canRecordAction(actor,event.visibility==='public'?'reply':'note',before));
 if(actor.role==='translator')return canWorkspace(actor.role,'translate',before.collection)&&translationRecord(before,after,actor);
 const metadata=['status','approvedBy','approvedById','scheduledAt','publishedLocales'];
 if(after.status!==before.status&&after.status==='approved')return before.status==='review'&&canRecordAction(actor,'review',before)&&after.approvedBy===actor.role&&after.approvedById===actor.id&&changes.every(key=>metadata.includes(key));
 if(after.status!==before.status&&['published','scheduled'].includes(after.status))return ['approved','published'].includes(before.status)&&!!before.approvedBy&&canRecordAction(actor,'publish',before)&&changes.every(key=>metadata.includes(key));
 if(before.status==='approved'&&after.status==='proposal'&&before.collection==='quotes')return canRecordAction(actor,'issue',before)&&changes.every(key=>metadata.includes(key));
 if(after.status==='archived'||before.status==='archived')return canRecordAction(actor,'archive',before);
 if(before.collection==='leads'&&after.status==='converted'&&before.status!=='converted')return canRecordAction(actor,'convert',before);
 if(changes.every(key=>['status','owner','due','priority'].includes(key))&&!contentKinds.includes(before.collection)&&before.collection!=='quotes')return canRecordAction(actor,changes.includes('owner')?'assign':'stage',before);
 if(!canRecordAction(actor,'edit',before))return false;
 if(after.status==='review'&&!canRecordAction(actor,'submit',before)&&contentKinds.includes(before.collection))return false;
 if(contentKinds.includes(before.collection)||before.collection==='quotes') {
  const onlyProductAutosave=before.collection==='products'&&changes.every(key=>key==='details')&&equal({...before.details,productDraft:undefined},{...after.details,productDraft:undefined});
  if(!onlyProductAutosave&&['approved','published','scheduled','proposal'].includes(after.status))return false;
  if(!onlyProductAutosave&&(after.approvedBy||after.approvedById))return false;
 }
 return true;
}
export function canChangePage(before:PageDraft|undefined,after:PageDraft|undefined,actor:WorkspaceActor):boolean {
 if(before&&!canManageSitePage(actor.role,before.slug)||after&&!canManageSitePage(actor.role,after.slug))return false;
 if(!before)return !!after&&(canWorkspace(actor.role,'create','pages')||(actor.role==='translator'&&canWorkspace(actor.role,'translate','pages',{...actor,locale:after.locale})))&&!['approved','published','scheduled','archived'].includes(after.status)&&!after.approvedBy&&!after.approvedById;
 if(!after)return false; // Page removal must withdraw releases and revoke previews atomically.
 if(equal(before,after))return true;
 if(before.status==='archived'||after.status==='archived')return false;
 if(before.id!==after.id)return false;
 const changes=changedKeys(before,after,['version','updatedAt','previous']);
 if(after.status==='approved'&&before.status==='review')return canWorkspace(actor.role,'review','pages',{authorId:before.authorId,authorRole:before.author,actorId:actor.id})&&after.approvedBy===actor.role&&after.approvedById===actor.id&&changes.every(key=>['status','approvedBy','approvedById'].includes(key));
 if(['published','scheduled'].includes(after.status)&&before.status==='approved')return !!before.approvedBy&&canWorkspace(actor.role,'publish','pages')&&changes.every(key=>['status','approvedBy','approvedById','scheduledAt'].includes(key));
 if(actor.role==='translator'){
  if(!canWorkspace(actor.role,'translate','pages',{...actor,locale:after.locale})||before.locale!==after.locale||before.slug!==after.slug||after.blocks.length!==before.blocks.length)return false;
  const structural=(page:PageDraft)=>page.blocks.map(block=>({...block,title:'',body:'',options:block.options?{...block.options,ctaLabel:'',secondaryLabel:''}:undefined}));
  return equal(structural(before),structural(after))&&changes.every(key=>['title','summary','taxonomy','blocks','status','author','authorId','approvedBy','approvedById'].includes(key))&&['draft','review'].includes(after.status)&&!after.approvedBy&&!after.approvedById;
 }
 return canWorkspace(actor.role,'edit','pages')&&['draft','review'].includes(after.status)&&!after.approvedBy&&!after.approvedById;
}
export function canPublishWorkspaceSnapshot(actor:WorkspaceActor,publication:{id:string;kind:string;locale:string;title:string;summary:string;blocks:unknown[];productRelease?:unknown;customProduct?:unknown},source:PageDraft|WorkspaceRecord|undefined):boolean {
 if(source&&'slug' in source&&typeof source.slug==='string'&&!canManageSitePage(actor.role,source.slug))return false;
 if(!source||!['approved','published'].includes(source.status)||!source.approvedBy)return false;
 const module=publication.kind==='page'?'pages':publication.kind==='product'?'products':publication.kind==='article'?'research':publication.kind;
 if(!canWorkspace(actor.role,'publish',module,{locale:publication.locale})||source.id!==publication.id||!publication.title.trim()||!publication.summary.trim())return false;
 if(source.authorId&&source.approvedById&&source.authorId===source.approvedById&&!isAdmin(actor.role))return false;
 if('collection' in source){
  if(source.details?.customProduct||publication.customProduct){const definition=parseCustomProduct(publication.customProduct);if(!definition||definition.id!==(source.product||source.id)||!publication.productRelease||!equal(publication.customProduct,source.details?.customProduct))return false;}
  if(publication.productRelease){const product=parseCustomProduct(publication.customProduct)||products.find(item=>item.id===(source.product||source.id));if(!product||!parseProductRelease(publication.productRelease,product))return false;}
  const lang=publication.locale as keyof typeof source.title;
  return source.collection===module&&canRecordAction(actor,'publish',source)&&source.title[lang]===publication.title&&source.summary[lang]===publication.summary&&(!publication.productRelease||equal(publication.productRelease,source.details?.productReviewDraft));
 }
 return module==='pages'&&source.locale===publication.locale&&source.title===publication.title&&source.summary===publication.summary&&equal(source.blocks,publication.blocks);
}
/** Atomic local command guard. Functions receive a projected view; hidden rows are retained, never overwritten. */
export function applyWorkspaceMutation(original:WorkspaceState,proposed:WorkspaceState,actor:WorkspaceActor):{ok:boolean;state:WorkspaceState} {
 const before=projectWorkspaceState(original,actor.role);
 const fail=()=>({ok:false,state:original});
 if(!proposed||proposed.version!==1||!Array.isArray(proposed.records)||!Array.isArray(proposed.pages)||!Array.isArray(proposed.forms)||!Array.isArray(proposed.media)||!Array.isArray(proposed.aiJobs)||!Array.isArray(proposed.audit))return fail();
 const mergeRows=<T extends {id:string}>(raw:T[],visible:T[],next:T[],allowed:(before:T|undefined,after:T|undefined)=>boolean):T[]|null=>{
  if(new Set(next.map(item=>item.id)).size!==next.length)return null;
  for(const id of new Set([...visible.map(item=>item.id),...next.map(item=>item.id)])){
   const prev=visible.find(item=>item.id===id),candidate=next.find(item=>item.id===id);
   if(!prev&&raw.some(item=>item.id===id))return null;
   if(!equal(prev,candidate)&&!allowed(prev,candidate))return null;
  }
  const visibleIds=new Set(visible.map(item=>item.id));return [...next,...raw.filter(item=>!visibleIds.has(item.id)&&!next.some(candidate=>candidate.id===item.id))];
 };
 const records=mergeRows(original.records,before.records,proposed.records,(a,b)=>canChangeRecord(a,b,actor));if(!records)return fail();
 const pages=mergeRows(original.pages,before.pages,proposed.pages,(a,b)=>{
  if(!a&&b&&actor.role==='translator'&&(b.status!=='draft'||!original.pages.some(source=>isPageTranslationStructure(source,b))))return false;
  return canChangePage(a,b,actor);
 });if(!pages)return fail();
 const media=mergeRows(original.media,before.media,proposed.media,(a,b)=>canWorkspace(actor.role,a?(b?'edit':'archive'):'create','media'));if(!media)return fail();
 const aiJobs=mergeRows(original.aiJobs,before.aiJobs,proposed.aiJobs,(a,b)=>canWorkspace(actor.role,a?(b?'edit':'archive'):'create','ai'));if(!aiJobs)return fail();
 const forms=mergeRows(original.forms,before.forms,proposed.forms,(a,b)=>canWorkspace(actor.role,a?(b?'edit':'archive'):'create','forms'));if(!forms)return fail();
 const safeForms=forms.map(form=>{const raw=original.forms.find(old=>old.id===form.id);return raw&&!canWorkspace(actor.role,'responses','forms')?{...form,responses:raw.responses}:form;});
 if(!equal(before.settings,proposed.settings)&&!canWorkspace(actor.role,'manage','settings'))return fail();
 const changed= !equal(before.records,proposed.records)||!equal(before.pages,proposed.pages)||!equal(before.media,proposed.media)||!equal(before.aiJobs,proposed.aiJobs)||!equal(before.forms,proposed.forms)||!equal(before.settings,proposed.settings);
 if(!changed&&!equal(before.audit,proposed.audit))return fail();
 const audit=isAdmin(actor.role)?proposed.audit:[...proposed.audit.filter(event=>!before.audit.some(old=>old.id===event.id)),...original.audit].slice(0,300);
 const safeRecords=records.map(record=>{const raw=original.records.find(item=>item.id===record.id);return raw&&actor.role==='scientificReviewer'&&record.collection==='tickets'?{...record,title:raw.title,email:raw.email,organization:raw.organization,amount:raw.amount,currency:raw.currency,requestId:raw.requestId,linkedId:raw.linkedId,details:raw.details}:record;});
 return {ok:true,state:{...original,records:safeRecords,pages,media,aiJobs,forms:safeForms,audit,settings:canWorkspace(actor.role,'manage','settings')?proposed.settings:original.settings}};
}
import {isPageTranslationStructure} from '@/lib/page-translation';
