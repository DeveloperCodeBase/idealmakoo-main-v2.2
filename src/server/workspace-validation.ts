import {validatePublicNoticeRecord} from './workspace-public-notices';
import {validateGlossaryRecord} from './workspace-glossary';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */
export type ContentLocale = typeof LOCALES[number];

import type { WorkspaceState, WorkspaceRecord, PageDraft, PageBlock, WorkspaceActivity, WorkspaceForm, WorkspaceMedia, AIJob } from '@/data/workspace-seed';
import type { CommercialDraft, Currency } from '@/components/workspace/crm-tools-logic';
import { HttpError } from "./types";
import { blockTypes } from "@/components/workspace/i18n";
import { parseFormSchema } from "@/lib/form-schema";
import { parseEditorialSeoByLocale, editorialSeoKinds } from "../lib/editorial-seo";
import { calculateCommercial } from "@/components/workspace/crm-tools-logic";
const CONTENT_COLLECTIONS = ['pages','products','research','news','events','resources','knowledge','glossary','hr'] as const;
const RECORD_COLLECTIONS = [...CONTENT_COLLECTIONS,'menus','leads','accounts','contacts','opportunities','activities','quotes','pricebooks','samples','handoffs','partners','tickets','segments','campaigns','inbox','automations','success','communications','staff'] as const;
const LOCALES = ['fa','en','tr','ar','ru'] as const;
const isObject = (value:unknown):value is Record<string,unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function fail(message:string):never { throw new HttpError(422,'validation',message); }
function assertObject(value:unknown, path:string):asserts value is Record<string,unknown> { if (!isObject(value)) fail(`${path} must be an object`); }
function keys(value:Record<string,unknown>,allowed:readonly string[],path:string) { for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key} is not a writable field`); }
function string(value:unknown,path:string,max=1000,min=0):asserts value is string { if (typeof value!=='string'||value.length>max||value.length<min||value.includes('\u0000')) fail(`${path} is invalid`); }
function id(value:unknown,path='id'):asserts value is string { string(value,path,160,1); if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value)||['constructor','prototype','__proto__'].includes(value)) fail(`${path} is invalid`); }
function locale(value:unknown):asserts value is ContentLocale { if (!(LOCALES as readonly unknown[]).includes(value)) fail('Unsupported locale'); }
function integer(value:unknown,path:string,min=0,max=Number.MAX_SAFE_INTEGER):asserts value is number { if (typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max) fail(`${path} must be an integer between ${min} and ${max}`); }
function safeJson(value:unknown,path='state',depth=0) {
  if (depth>24) fail(`${path} exceeds maximum nesting`);
  if (typeof value==='string') { string(value,path,700000); return; }
  if (typeof value==='number') { if (!Number.isFinite(value)) fail(`${path} contains a non-finite number`); return; }
  if (value===null||value===undefined||typeof value==='boolean') return;
  if (Array.isArray(value)) { if (value.length>25000) fail(`${path} exceeds row limit`); for (const item of value) safeJson(item,path,depth+1); return; }
  assertObject(value,path);
  for (const [key,item] of Object.entries(value)) { if (['__proto__','constructor','prototype'].includes(key)) fail(`${path} has a reserved field`); safeJson(item,`${path}.${key}`,depth+1); }
}
function localText(value:unknown,path:string,max=30000) { assertObject(value,path); keys(value,LOCALES,path); for (const code of LOCALES) string(value[code],`${path}.${code}`,max); }
function optionalText(value:unknown,path:string,max=1000) { if (value!==undefined&&value!==null) string(value,path,max); }
function safeUrl(value:unknown,path:string,empty=true) {
  string(value,path,4000); if (empty&&!value) return;
  if (/[\s\u0000-\u001f\u007f\\]/.test(value)) fail(`${path} is not a safe URL`);
  if (/^\/(?!\/)/.test(value)) { if (/%(?:2e|2f|5c)|(?:^|\/)\.\.(?:\/|$)/i.test(value)) fail(`${path} contains traversal`); return; }
  try { const url=new URL(value); if (['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&url.hostname) return; } catch { /* Fall through. */ }
  fail(`${path} must be an HTTP(S) or application URL`);
}
function date(value:unknown,path:string) { if(value===undefined||value==='') return; string(value,path,50,1); if(!/^\d{4}-\d{2}-\d{2}(?:T.*Z)?$/.test(value)||!Number.isFinite(Date.parse(value))) fail(`${path} is not an ISO date`); if(value.length===10&&new Date(value).toISOString().slice(0,10)!==value) fail(`${path} is not a valid calendar date`); }
function uniqueRows<T>(value:unknown,path:string,max:number,validate:(row:unknown)=>void):asserts value is T[] {
    if (!Array.isArray(value) || value.length > max)
        fail(`${path} exceeds limit ${max}`);
    const seen=new Set<string>();
    for (const row of value) {
        assertObject(row,path);
        if (path === "blocks") {
            string(row.id,'block.id',160,1);
            if (!/^[a-zA-Z0-9][a-zA-Z0-9_\/-]*$/.test(row.id))
                fail('Invalid block ID');
        }
        else
            id(row.id,`${path}.id`);
        if (seen.has(row.id as string))
            fail(`${path} contains a duplicate ID`);
        seen.add(row.id as string);
        validate(row);
    }
}
function validateActivity(value:unknown) { assertObject(value,'activity'); keys(value,['id','text','at','visibility','actor'],'activity'); id(value.id,'activity.id'); localText(value.text,'activity.text',30000); date(value.at,'activity.at'); if(!['public','internal'].includes(String(value.visibility))) fail('Invalid activity visibility'); string(value.actor,'activity.actor',160); }
function validateBlocks(value:unknown):asserts value is PageBlock[] {
    uniqueRows(value, "blocks", 250, raw => {
        assertObject(raw,'block');
        keys(raw, ["id", "type", "title", "body", "mediaUrl", "link", "formId", "formSchema", "hidden", "options", "shared"], "block");
        if (raw.shared !== void 0) {
            assertObject(raw.shared, "block.shared");
            keys(raw.shared, ["blockId", "revisionId"], "block.shared");
            for (const key of ["blockId", "revisionId"]) {
                string(raw.shared[key], "block.shared." + key, 36, 36);
                if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(raw.shared[key]))
                    fail("Invalid shared block reference");
            }
        }
        if (!blockTypes.some(type=>type[0]===raw.type))
            fail('Unsupported page block');
        string(raw.title,'block.title',1000);
        string(raw.body,'block.body',100000);
        for (const field of ["mediaUrl", "link"])
            if (raw[field] !== void 0)
                safeUrl(raw[field],`block.${field}`);
        if (raw.hidden !== void 0 && typeof raw.hidden !== "boolean")
            fail('Invalid block visibility');
        if (raw.formId)
            id(raw.formId,'block.formId');
        if (raw.formSchema !== void 0) {
            const schema=parseFormSchema(raw.formSchema);
            if (!schema || schema.id !== raw.formId)
                fail('Invalid embedded form schema');
        }
        if (raw.options !== void 0) {
            assertObject(raw.options,'block.options');
            keys(raw.options,['productIds','ctaLabel','secondaryLabel','secondaryLink','visual','tone'],'block.options');
            for (const key of ["ctaLabel", "secondaryLabel"])
                optionalText(raw.options[key],key,180);
            if (raw.options.secondaryLink !== void 0)
                safeUrl(raw.options.secondaryLink,'secondaryLink');
            if (raw.options.visual !== void 0 && !['scene','image'].includes(String(raw.options.visual)))
                fail('Invalid visual');
            if (raw.options.tone !== void 0 && !['cyan','violet','neutral'].includes(String(raw.options.tone)))
                fail('Invalid tone');
            if (raw.options.productIds !== void 0) {
                if (!Array.isArray(raw.options.productIds) || raw.options.productIds.length > 40)
                    fail('Invalid selected products');
                for (const selected of raw.options.productIds)
                    id(selected,'selected product');
            }
        }
    });
}
function validateRecord(value:unknown):asserts value is WorkspaceRecord {
    assertObject(value,'record');
    keys(value,['id','collection','title','summary','status','owner','ownerId','assigneeId','teamId','territoryId','updatedAt','createdAt','tags','demo','organization','email','product','sourceUrl','image','amount','currency','requestId','linkedId','due','priority','history','archivedFrom','publishedLocales','author','authorId','approvedBy','approvedById','scheduledAt','quoteResponse','eventStart','eventEnd','location','details'],'record');
    id(value.id);
    if (!(RECORD_COLLECTIONS as readonly unknown[]).includes(value.collection))
        fail('Unsupported record collection');
    localText(value.title,'record.title',1000);
    localText(value.summary,'record.summary',100000);
    string(value.status,'record.status',64,1);
    string(value.owner,'record.owner',160);
    if (typeof value.demo !== "boolean")
        fail('Invalid demo marker');
    if (!Array.isArray(value.tags) || value.tags.length > 100)
        fail('Too many tags');
    for (const tag of value.tags)
        string(tag,'tag',160);
    uniqueRows<WorkspaceActivity>(value.history,'record.history',10000,validateActivity);
    for (const field of ["organization", "email", "product", "requestId", "linkedId", "archivedFrom", "author", "authorId", "approvedBy", "approvedById", "location"])
        optionalText(value[field],`record.${field}`,field==='location'?2000:500);
    for (const field of ["product", "requestId", "linkedId"])
        if (value[field])
            id(value[field],`record.${field}`);
    for (const field of ["ownerId", "assigneeId", "teamId", "territoryId"])
        if (value[field] !== void 0)
            id(value[field],`record.${field}`);
    for (const field of ["createdAt", "updatedAt", "due", "scheduledAt", "eventStart", "eventEnd"])
        date(value[field],`record.${field}`);
    for (const field of ["sourceUrl", "image"])
        if (value[field] !== void 0)
            safeUrl(value[field],`record.${field}`);
    if (value.amount !== void 0 && value.amount !== null && value.amount !== "" && (typeof value.amount !== "string" || !/^\d{1,24}(?:\.\d{1,6})?$/.test(value.amount)))
        fail('Amounts must be exact nonnegative decimal strings');
    if (value.currency !== void 0 && !['IRR','USD','EUR','TRY','RUB',''].includes(String(value.currency)))
        fail('Unsupported currency');
    if (value.priority !== void 0 && !['low','normal','high'].includes(String(value.priority)))
        fail('Unsupported priority');
    if (value.publishedLocales !== void 0) {
        if (!Array.isArray(value.publishedLocales))
            fail('Invalid published locales');
        for (const item of value.publishedLocales)
            locale(item);
    }
    if (value.details !== void 0) {
        assertObject(value.details,'record.details');
        if (value.details.category !== void 0)
            string(value.details.category,'record.details.category',120);
        if (JSON.stringify(value.details).length > 15e5)
            fail('Record details exceed maximum size');
        if (value.details.crmMergeOperations !== void 0) {
            if (!Array.isArray(value.details.crmMergeOperations) || value.details.crmMergeOperations.length > 1e3)
                fail('Invalid merge operation history');
            for (const operation of value.details.crmMergeOperations) {
                assertObject(operation,'merge operation');
                id(operation.id,'merge.id');
                id(operation.targetId,'merge.targetId');
                id(operation.sourceId,'merge.sourceId');
                if (!['merged','undone'].includes(String(operation.state)) || !Array.isArray(operation.importedActivityIds) || operation.importedActivityIds.length > 1e4)
                    fail('Invalid merge operation metadata');
                for (const activityId of operation.importedActivityIds)
                    id(activityId,'merge.activityId');
                assertObject(operation.beforeTarget,'merge.beforeTarget');
                assertObject(operation.afterTarget,'merge.afterTarget');
            }
        }
        if (value.details.editorialContent !== void 0) {
            const editorial=value.details.editorialContent;
            assertObject(editorial,'editorialContent');
            keys(editorial, ["schemaVersion", "body", "mediaId", "mediaUrl", "mediaType", "mediaTitle", "seo"], "editorialContent");
            integer(editorial.schemaVersion,'editorialContent.schemaVersion',1,1);
            localText(editorial.body,'editorialContent.body',100000);
            if (editorial.mediaId !== void 0)
                id(editorial.mediaId,'editorialContent.mediaId');
            if (editorial.mediaUrl !== void 0)
                safeUrl(editorial.mediaUrl,'editorialContent.mediaUrl');
            if (editorial.mediaTitle !== void 0)
                string(editorial.mediaTitle,'editorialContent.mediaTitle',1000);
            if (editorial.mediaType !== void 0 && !['image','video','audio','document'].includes(String(editorial.mediaType)))
                fail('Invalid editorial media type');
            if (editorial.seo !== void 0) {
                const seo = (parseEditorialSeoByLocale)(editorial.seo);
                if (!seo || !(CONTENT_COLLECTIONS as readonly unknown[]).includes(value.collection) || value.collection === "hr" && value.requestId)
                    fail("Invalid public editorial metadata");
                for (const entry of Object.values(seo))
                    for (const kind of Object.keys(entry))
                        if (!(editorialSeoKinds)(String(value.collection)).has(kind))
                            fail("Editorial metadata does not match the content type");
            }
        }
    }
    validateGlossaryRecord(value as unknown as WorkspaceRecord);
    validatePublicNoticeRecord(value as unknown as WorkspaceRecord);
}
function validatePage(value:unknown):asserts value is PageDraft {
  assertObject(value,'page'); keys(value,['id','slug','locale','title','summary','status','version','author','authorId','approvedBy','approvedById','scheduledAt','updatedAt','blocks','previous','taxonomy'],'page');
  id(value.id); string(value.slug,'page.slug',240,1); if(!/^[a-zA-Z0-9]+(?:[\/-][a-zA-Z0-9]+)*$/.test(value.slug)) fail('Invalid page slug');
  if(/^(?:api|admin|account|auth)(?:\/|$)/i.test(value.slug))fail('Private application routes cannot be used as public page slugs');
  locale(value.locale); string(value.title,'page.title',1000); string(value.summary,'page.summary',100000);
  if(!['draft','review','approved','published','scheduled','archived'].includes(String(value.status))) fail('Invalid page status');
  integer(value.version,'page.version',1); string(value.author,'page.author',160);
  for(const field of ['authorId','approvedBy','approvedById'] as const) optionalText(value[field],field,160);
  date(value.updatedAt,'page.updatedAt'); date(value.scheduledAt,'page.scheduledAt'); validateBlocks(value.blocks);
  if(value.taxonomy!==undefined) {
    assertObject(value.taxonomy,'page.taxonomy');keys(value.taxonomy,['category','tags'],'page.taxonomy');string(value.taxonomy.category,'page.taxonomy.category',120);
    if(!Array.isArray(value.taxonomy.tags)||value.taxonomy.tags.length>20)fail('Too many page taxonomy tags');
    for(const tag of value.taxonomy.tags)string(tag,'page.taxonomy.tag',80,1);
  }
  if(value.previous!==undefined) { assertObject(value.previous,'page.previous'); keys(value.previous,['title','summary','blocks','version'],'page.previous'); string(value.previous.title,'previous.title',1000); string(value.previous.summary,'previous.summary',100000); integer(value.previous.version,'previous.version',1); validateBlocks(value.previous.blocks); }
}
function validateMedia(value:unknown):asserts value is WorkspaceMedia {
  assertObject(value,'media'); keys(value,['id','title','type','url','filename','size','usage','rights','sourceUrl','focalX','focalY'],'media'); id(value.id); string(value.title,'media.title',1000); string(value.filename,'media.filename',500);
  if(!['image','video','audio','document'].includes(String(value.type))) fail('Invalid media type'); safeUrl(value.url,'media.url',false); if(value.sourceUrl!==undefined) safeUrl(value.sourceUrl,'media.sourceUrl');
  integer(value.size,'media.size',0,536870912); if(typeof value.rights!=='boolean') fail('Media rights declaration is required');
  if(!Array.isArray(value.usage)||value.usage.length>10000) fail('Invalid media usages'); for(const usage of value.usage as unknown[]) string(usage,'usage',500);
  for(const axis of ['focalX','focalY']) if(typeof value[axis]!=='number'||!Number.isFinite(value[axis])||Number(value[axis])<0||Number(value[axis])>100) fail('Invalid focal point');
}
function validateForm(value:unknown):asserts value is WorkspaceForm { assertObject(value,'form'); keys(value,['id','title','fields','responses','version','status','updatedAt'],'form'); if(!parseFormSchema(value)) fail('Invalid form schema'); if(value.status!==undefined&&!['active','archived'].includes(String(value.status)))fail('Invalid form lifecycle');date(value.updatedAt,'form.updatedAt');if(!Array.isArray(value.responses)||value.responses.length>10000) fail('Invalid form responses'); }
function validateAiJob(value:unknown):asserts value is AIJob {
  assertObject(value,'aiJob'); keys(value,['id','mode','locale','productId','prompt','output','createdAt','status','authorId','responseId','provider','model','tokens','image','sources','sourceText','referenceLabel'],'aiJob'); id(value.id); locale(value.locale);
  for(const field of ['mode','productId','prompt','output'] as const) string(value[field],`aiJob.${field}`,field==='output'?500000:30000);
  if(!['ready','draft'].includes(String(value.status))) fail('Invalid AI draft status'); date(value.createdAt,'aiJob.createdAt');
}
function validateWorkspace(value:unknown):asserts value is WorkspaceState {
  safeJson(value); assertObject(value,'state'); keys(value,['version','records','pages','media','audit','aiJobs','forms','settings'],'state'); if(value.version!==1) fail('Unsupported workspace schema version');
  uniqueRows<WorkspaceRecord>(value.records,'records',20000,validateRecord); uniqueRows<PageDraft>(value.pages,'pages',2500,validatePage); uniqueRows<WorkspaceMedia>(value.media,'media',10000,validateMedia); uniqueRows<WorkspaceForm>(value.forms,'forms',1000,validateForm); uniqueRows<AIJob>(value.aiJobs,'aiJobs',2500,validateAiJob); uniqueRows<WorkspaceActivity>(value.audit,'audit',1000,validateActivity);
  assertObject(value.settings,'settings'); keys(value.settings,['name','apiUrl','defaultLocale','compact','email'],'settings'); string(value.settings.name,'settings.name',200); string(value.settings.apiUrl,'settings.apiUrl',1000); locale(value.settings.defaultLocale); if(typeof value.settings.compact!=='boolean') fail('Invalid compact setting'); string(value.settings.email,'settings.email',254);
}
function normalizeCommercial(record:WorkspaceRecord):WorkspaceRecord {
  const draft=record.details?.commercialDraft as CommercialDraft|undefined; if(!draft) return record;
  if(!['quotes','pricebooks'].includes(record.collection)||draft.schemaVersion!==1||draft.kind!==(record.collection==='quotes'?'quote':'pricebook')||draft.currency!==record.currency) fail('Invalid commercial draft');
  const computed=calculateCommercial(draft.lines,draft.currency as Currency); if(!computed.ok) return fail(computed.error);
  if(computed.value.grandTotalDecimal!==record.amount) fail('Quote amount must equal the server-calculated total');
  return {...record,details:{...record.details,commercialDraft:{...draft,estimate:computed.value}}};
}
export { CONTENT_COLLECTIONS, LOCALES, RECORD_COLLECTIONS, assertObject, fail, id, integer, isObject, keys, locale, normalizeCommercial, safeJson, safeUrl, string, validateActivity, validateBlocks, validateForm, validateMedia, validatePage, validateRecord, validateWorkspace };
