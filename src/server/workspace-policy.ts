import {assertPublicNoticeLocaleChanges} from './workspace-public-notices';
import {assertGlossaryLocaleChanges} from './workspace-glossary';
import {assertFormLanguageChanges} from './editor-workflows';
import {assertSitePageMutation} from './page-authority';
import {canManageSitePage} from '../lib/page-authority';
import {isPageTranslationStructure} from '../lib/page-translation';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */
export type Bucket = 'records'|'pages'|'media'|'forms'|'aiJobs';

export type WorkspaceRow = WorkspaceState[Bucket][number];

export type WorkspaceChange = {[B in Bucket]:{bucket:B;id:string;before?:WorkspaceState[B][number];after?:WorkspaceState[B][number];action:string;activity:WorkspaceActivity}}[Bucket];

import type { WorkspaceActivity, WorkspaceState, WorkspaceRecord, PageDraft } from '@/data/workspace-seed';
import type { WorkspaceAction } from '@/lib/auth';
import type { Actor } from './types';
import { CONTENT_COLLECTIONS, LOCALES, normalizeCommercial, validateWorkspace } from "./workspace-validation";
import { createHash, randomUUID } from "node:crypto";
import { HttpError } from "./types";
import { canWorkspace } from "@/lib/auth";
import { isScopedCrmRecord, canAccessCrmRecord, redactCrmRecord, normalizeCrmAssignment, preserveCrmProtectedFields } from "./workspace-scopes";
import { canReadRecord, projectWorkspaceState, canChangeRecord, canChangePage } from "@/components/workspace/permissions";
import { recordText } from "@/data/workspace-seed";
const isContent = (record:WorkspaceRecord) => (CONTENT_COLLECTIONS as readonly string[]).includes(record.collection)&&!(record.collection==='hr'&&record.requestId);
function stableJson(value:unknown):string {
  if(value===undefined) return 'null';
  if(value===null||typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value as object).sort().filter(key=>(value as Record<string,unknown>)[key]!==undefined).map(key=>`${JSON.stringify(key)}:${stableJson((value as Record<string,unknown>)[key])}`).join(',')}}`;
}
const equal=(a:unknown,b:unknown) => stableJson(a)===stableJson(b);
const checksum=(value:unknown) => createHash('sha256').update(stableJson(value)).digest('hex');
const denied=(message='This operation is not allowed for the authenticated account'):never=>{throw new HttpError(403,'forbidden',message);};
function assertWorkspaceActor(actor:Actor) {
  if(!actor.id||!canWorkspace(actor.role,'view','overview')) denied();
  if(!actor.mfaVerified) throw new HttpError(403,'mfa_required','Complete multi-factor authentication first');
}
function hasWorkspacePermission(actor:Actor,action:WorkspaceAction,section:string,targetLocale?:string) {
  return canWorkspace(actor.role,action,section,{locale:targetLocale,actorId:actor.id,allowedLocales:actor.allowedLocales,qualityScope:actor.qualityScope})&&(!targetLocale||actor.allowedLocales.includes(targetLocale));
}
function qualityRecord(record:WorkspaceRecord) {return record.tags.includes('quality')||record.details?.qualityQuarantined===true;}
function canReviewSource(actor:Actor,source:WorkspaceRecord|PageDraft,lang?:string) {
    const section='collection' in source?source.collection:'pages';
    if(!('collection'in source)&&!canManageSitePage(actor.role,source.slug))return false;
    if ("collection" in source && (isScopedCrmRecord)(source) && ["quotes", "pricebooks"].includes(source.collection) && actor.crmAccess?.permissions.financial !== true)
        return false;
    const selfReview=source.authorId===actor.id&&['admin','superAdmin'].includes(actor.role);
    if (!hasWorkspacePermission(actor,'review',section,lang) || !source.authorId || source.authorId === actor.id&&!selfReview)
        return false;
    if (['products','research','resources'].includes(section) && !(actor.role === "scientificReviewer" || ['admin','superAdmin'].includes(actor.role) && actor.qualityScope))
        return false;
    return true;
}
function readableRecord(actor:Actor,record:WorkspaceRecord) {
  return canReadRecord(actor.role,record)&&(!qualityRecord(record)||actor.qualityScope===true)&&canAccessCrmRecord(actor,record);
}
function projectForActor(state:WorkspaceState,actor:Actor):WorkspaceState {
    const visibleRecords = state.records.filter(record=>readableRecord(actor,record));
    const responseIds = new Set(visibleRecords.filter(record => record.id === record.requestId && (canAccessCrmRecord)(actor, { ...record, ownerId: void 0 }) && (!(isScopedCrmRecord)(record) || actor.crmAccess?.permissions.contact && actor.crmAccess.permissions.financial) && actor.role !== "scientificReviewer").map(record => record.requestId));
    const scoped = { ...state, records: visibleRecords.map(record=>redactCrmRecord(actor,record)), forms: state.forms.map(form => ({ ...form, responses: form.responses.filter(response => responseIds.has(response.id)) })) };
    const projected=projectWorkspaceState(scoped,actor.role);
    projected.aiJobs = projected.aiJobs.filter(job=>['superAdmin','admin'].includes(actor.role)||job.authorId===actor.id);
    const ids = new Set(projected.records.flatMap(record => record.history.map(activity2 => activity2.id)));
    if (!['superAdmin','admin'].includes(actor.role))
        projected.audit = projected.audit.filter(activity2 => ids.has(activity2.id));
    return projected;
}
const diffKeys=(a:object,b:object,ignored:string[]=[]) => [...new Set([...Object.keys(a),...Object.keys(b)])].filter(key=>!ignored.includes(key)&&!equal((a as Record<string,unknown>)[key],(b as Record<string,unknown>)[key]));
function activity(actor:Actor,action:string,entityId:string):WorkspaceActivity {
  return {id:`event-${randomUUID()}`,text:recordText(`${action}: ${entityId}`),actor:actor.role,at:new Date().toISOString(),visibility:'internal'};
}
function serverActivity(actor:Actor,action:string,entityId:string) {return activity(actor,action,entityId);}
const stripKeys=(row:object,ignored:string[])=>Object.fromEntries(Object.entries(row).filter(([key])=>!ignored.includes(key)));
function editableSnapshot(row:WorkspaceRecord|PageDraft) {
  return stripKeys(row,['status','author','authorId','approvedBy','approvedById','publishedLocales','scheduledAt','history','updatedAt','createdAt','version','previous','quoteResponse','owner','ownerId','assigneeId','teamId','territoryId']);
}
function recordReviewSnapshot(record:WorkspaceRecord) {
  const snapshot=editableSnapshot(record);
  // An editor may autosave a future technical draft without changing the review snapshot.
  if(record.details) snapshot.details=stripKeys(record.details,['productDraft']);
  return snapshot;
}
function recordChanged(before:WorkspaceRecord,after:WorkspaceRecord) {return !equal(recordReviewSnapshot(before),recordReviewSnapshot(after));}
function unchangedIdentity(provided:WorkspaceRecord|PageDraft,before:WorkspaceRecord|PageDraft|undefined,actor:Actor) {
  if(provided.authorId&&provided.authorId!==before?.authorId&&provided.authorId!==actor.id) denied('Author identity must come from the authenticated account');
  if(provided.author&&provided.author!==before?.author&&provided.author!==actor.role) denied('Author role cannot be assigned by the client');
  if(provided.approvedById&&provided.approvedById!==before?.approvedById&&provided.approvedById!==actor.id) denied('Reviewer identity cannot be assigned by the client');
  if(provided.approvedBy&&provided.approvedBy!==before?.approvedBy&&provided.approvedBy!==actor.role) denied('Reviewer role cannot be assigned by the client');
}
function localeChanges(before:WorkspaceRecord|undefined,after:WorkspaceRecord,actor:Actor) {
    if (!isContent(after))
        return;
    const prior = before?.details?.editorialContent as {body?:Partial<Record<typeof LOCALES[number],string>>;seo?:Partial<Record<typeof LOCALES[number],unknown>>}|undefined;
    const next = after.details?.editorialContent as typeof prior;
    for (const lang of LOCALES)
        if ((before?.title[lang] !== after.title[lang] || before?.summary[lang] !== after.summary[lang] || (prior?.body?.[lang] || "") !== (next?.body?.[lang] || "") || !equal(prior?.seo?.[lang], next?.seo?.[lang])) && !actor.allowedLocales.includes(lang))
            denied('This content locale is outside your assigned scope');
}
function safeRecordHistory(before:WorkspaceRecord|undefined,after:WorkspaceRecord,actor:Actor,source:WorkspaceState) {
  const old=before?.history||[];
  for(const original of old) if(!after.history.some(candidate=>candidate.id===original.id&&equal(candidate,original))) {
    if(!canWorkspace(actor.role,'merge',after.collection)) denied('Historical activities are immutable');
    const operations=after.details?.crmMergeOperations as {id:string;state:string;importedActivityIds:string[]}[]|undefined;
    const previous=before?.details?.crmMergeOperations as {id:string;state:string;importedActivityIds:string[]}[]|undefined;
    // Only copied source activities may be removed by an independently checked unmerge.
    if(after.history.some(candidate=>candidate.id===original.id)||!operations?.some(operation=>operation.state==='undone'&&operation.importedActivityIds.includes(original.id)&&previous?.some(prior=>prior.id===operation.id&&prior.state==='merged'&&prior.importedActivityIds.includes(original.id)))) denied('Historical activities are immutable');
  }
  const appended=after.history.filter(event=>!old.some(previous=>previous.id===event.id));
  const editing=canWorkspace(actor.role,before?'edit':'create',after.collection)||isContent(after)&&canWorkspace(actor.role,'translate',after.collection);
  for(const event of appended) if(!editing&&!canWorkspace(actor.role,event.visibility==='public'?'reply':'note',after.collection)&&!['review','published','scheduled','approved'].includes(after.status)) denied();
  const importedIds=new Set(((after.details?.crmMergeOperations||[]) as {importedActivityIds?:string[]}[]).flatMap(operation=>operation.importedActivityIds||[]));
  return [...old.filter(item=>after.history.some(next=>next.id===item.id)),...appended.map(event=>{
    if(importedIds.has(event.id)&&canWorkspace(actor.role,'merge',after.collection)&&source.records.some(row=>readableRecord(actor,row)&&row.history.some(original=>equal(event,original))))return event;
    return {...event,actor:actor.role,at:new Date().toISOString()};
  })];
}
function authorizeRecord(before:WorkspaceRecord|undefined,after:WorkspaceRecord|undefined,actor:Actor,source:WorkspaceState):WorkspaceRecord|undefined {
    const storedBefore=before?source.records.find(record=>record.id===before.id)||before:undefined;
    if (storedBefore && !readableRecord(actor,storedBefore))
        denied();
    if (after)
        after = normalizeCrmAssignment(actor,before,after);
    if (!before && after && !readableRecord(actor,after))
        denied();
    if (before?.collection === "staff" || after?.collection === "staff")
        denied('Use the user administration endpoint to manage login identities');
    if (!after) {
        if (!before || !canWorkspace(actor.role,'archive',before.collection))
            denied();
        return void 0;
    }
    unchangedIdentity(after,before,actor);
    localeChanges(before,after,actor);
    assertGlossaryLocaleChanges(before,after,actor);
    assertPublicNoticeLocaleChanges(before,after,actor);
    if (after.demo && process.env.DEMO_MODE !== "true")
        denied('Demonstration data cannot be imported into a live workspace');
    const normalized=normalizeCommercial(after);
    const policyActor = { role: actor.role, id: actor.id, locale: actor.allowedLocales[0] || "fa", allowedLocales: actor.allowedLocales, qualityScope: actor.qualityScope, crmAccess: actor.crmAccess };
    if (!canChangeRecord(before,normalized,policyActor))
        denied();
    if (before) {
        if (before.requestId !== after.requestId) {
            if (before.collection !== "quotes")
                denied('Request origins are immutable');
            const linked=source.records.find(record=>record.requestId===after.requestId&&record.collection!=='quotes');
            if (after.requestId && (!linked || !readableRecord(actor,linked)))
                denied('A quote may reference only a permitted request');
        }
        if (!equal(before.quoteResponse,after.quoteResponse))
            denied('Customer proposal responses cannot be edited by staff');
        if (qualityRecord(before) !== qualityRecord(after))
            denied('Quality quarantine changes require the dedicated request command');
        if (!equal(before.publishedLocales,after.publishedLocales)) {
            if (!after.publishedLocales?.every(lang=>before.publishedLocales?.includes(lang)))
                denied('Use the publication command to change live languages');
        }
        const material=recordChanged(before,normalized);
        const metadataOnly=diffKeys(before,normalized,['updatedAt','history','status','approvedBy','approvedById','scheduledAt','publishedLocales']).length===0;
        if (material && before.status === "archived" && after.status === "archived" && !canWorkspace(actor.role,'edit',after.collection))
            denied();
        if (after.status === "approved" && before.status !== "approved") {
            if (!metadataOnly || before.status !== "review" || !canReviewSource(actor,before))
                denied('A different authorized reviewer must approve the unchanged revision');
            return { ...before, status: "approved", approvedBy: actor.role, approvedById: actor.id, updatedAt: new Date().toISOString(), history: safeRecordHistory(before,after,actor,source) };
        }
        if ((["published", "scheduled"].includes(after.status) || after.status === "proposal" && after.collection === "quotes") && after.status !== before.status) {
            if (!metadataOnly || !before.approvedById || before.authorId === before.approvedById)
                denied('The exact current revision requires independent approval');
            if (after.status === "proposal")
                denied('Use the quote issuance endpoint');
            if (after.status === "published")
                denied('Use the publication command to create an actual release');
        }
        if (material && (isContent(after) || ["quotes", "pricebooks"].includes(after.collection)) && !['draft','review','archived'].includes(after.status))
            denied('Edited approved content must become a new draft');
        if (after.status === "scheduled" && (!after.scheduledAt || Date.parse(after.scheduledAt) <= Date.now()))
            throw new HttpError(422, "validation", "Scheduled publication must be in the future");
        const changedAuthor=material||after.status==='review'&&before.status!=='review';
        return { ...normalized, createdAt: before.createdAt, demo: before.demo, author: changedAuthor ? actor.role : before.author, authorId: changedAuthor ? actor.id : before.authorId, approvedBy: changedAuthor ? void 0 : before.approvedBy, approvedById: changedAuthor ? void 0 : before.approvedById, publishedLocales: before.publishedLocales, history: safeRecordHistory(before,after,actor,source), updatedAt: new Date().toISOString() };
    }
    if (after.requestId) {
        const linked=source.records.find(record=>record.requestId===after.requestId&&record.collection!=='quotes');
        if (after.collection !== "quotes" || !linked || !readableRecord(actor,linked))
            denied('Client input cannot create a request origin');
    }
    if (after.quoteResponse || after.publishedLocales?.length)
        denied('A new record cannot claim a prior release or customer response');
    if (after.collection === "pricebooks" && !["draft", "review"].includes(after.status))
        denied("A new pricebook must start as a draft or enter independent review");
    if (['approved','published','scheduled','proposal','converted'].includes(after.status))
        denied('A new record must enter through its initial workflow state');
    return { ...normalized, author: actor.role, authorId: actor.id, approvedBy: void 0, approvedById: void 0, publishedLocales: [], history: safeRecordHistory(undefined,after,actor,source), demo: process.env.DEMO_MODE === "true" && after.demo, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function authorizePage(before:PageDraft|undefined,after:PageDraft|undefined,actor:Actor,source:WorkspaceState):PageDraft|undefined {
  assertSitePageMutation(actor,before,after);
  if(!after) return denied('Use the page lifecycle command to retain history and withdraw publication atomically');
  if(!actor.allowedLocales.includes(after.locale)) denied('This page locale is outside your assigned scope');
  unchangedIdentity(after,before,actor);
  if(!canChangePage(before,after,{role:actor.role,id:actor.id,locale:after.locale})) denied();
  if(!before&&actor.role==='translator'&&(after.status!=='draft'||!source.pages.some(page=>isPageTranslationStructure(page,after)))) denied('Translations must begin as an independent draft derived from an existing page structure');
  if(before&&before.locale!==after.locale) denied('Create a separate locale draft to change language');
  const material=!before||!equal(editableSnapshot(before),editableSnapshot(after));
  if(before&&after.status==='approved'&&before.status!=='approved') {
    if(material||!canReviewSource(actor,before,before.locale)) denied('A different reviewer must approve the unchanged page revision');
    return {...before,status:'approved',approvedBy:actor.role,approvedById:actor.id,version:before.version+1,updatedAt:new Date().toISOString()};
  }
  if(before&&['published','scheduled'].includes(after.status)&&after.status!==before.status&&(!before.approvedById||before.approvedById===before.authorId||material)) denied('The page revision must have independent approval');
  if(after.status==='published'&&before?.status!=='published') denied('Use the publication command to create an actual release');
  if(after.status==='scheduled'&&(!after.scheduledAt||Date.parse(after.scheduledAt)<=Date.now())) throw new HttpError(422,'validation','Scheduled publication must be in the future');
  const authorChanged=material||after.status==='review'&&before?.status!=='review';
  return {...after,author:authorChanged?actor.role:before?.author||actor.role,authorId:authorChanged?actor.id:before?.authorId||actor.id,approvedBy:authorChanged?undefined:before?.approvedBy,approvedById:authorChanged?undefined:before?.approvedById,version:(before?.version||0)+1,previous:before?{title:before.title,summary:before.summary,blocks:before.blocks,version:before.version}:undefined,updatedAt:new Date().toISOString()};
}
function planWorkspaceMutation(original:WorkspaceState,proposed:unknown,actor:Actor) {
    assertWorkspaceActor(actor);
    validateWorkspace(proposed);
    const visible=projectForActor(original,actor);
    const changes:WorkspaceChange[]=[];
    const result=structuredClone(original);
    for (const event of proposed.audit) {
        const previous=visible.audit.find(item=>item.id===event.id);
        if (previous && !equal(previous,event))
            denied('The audit ledger is immutable');
    }
    for (const bucket of ["records", "pages", "media", "forms", "aiJobs"] as const) {
        const shown=visible[bucket] as WorkspaceRow[], requested=proposed[bucket] as WorkspaceRow[], raw=original[bucket] as WorkspaceRow[];
        const shownMap=new Map(shown.map(row=>[row.id,row])), requestedMap=new Map(requested.map(row=>[row.id,row]));
        for (const entityId of new Set([...shownMap.keys(), ...requestedMap.keys()])) {
            const before=shownMap.get(entityId), proposedRow=requestedMap.get(entityId);
            if (equal(before,proposedRow))
                continue;
            const source=raw.find(row=>row.id===entityId);
            if (!before && source)
                denied('A hidden record cannot be replaced');
            let after:WorkspaceRow|undefined=proposedRow;
            if (bucket === "records") {
                after = authorizeRecord(before as WorkspaceRecord|undefined,proposedRow as WorkspaceRecord|undefined,actor,original);
                if (after)
                    after = preserveCrmProtectedFields(actor,source as WorkspaceRecord|undefined,after as WorkspaceRecord);
                if (source && after && actor.role === "scientificReviewer" && (source as WorkspaceRecord).collection === "tickets") {
                    const redacted=after as WorkspaceRecord, privateRecord=source as WorkspaceRecord;
                    after = { ...privateRecord, history: redacted.history, updatedAt: redacted.updatedAt };
                }
            }
            else if (bucket === "pages")
                after = authorizePage(before as PageDraft|undefined,proposedRow as PageDraft|undefined,actor,original);
            else {
                const module2 = bucket === "aiJobs" ? "ai" : bucket;
                if (!hasWorkspacePermission(actor, before ? after ? "edit" : "archive" : "create", module2))
                    denied();
                if (bucket === "forms" && after) {
                    const requestedForm=after as WorkspaceState['forms'][number];
                    const previous=before as WorkspaceState['forms'][number]|undefined;
                    if (!equal(requestedForm.responses,previous?.responses||[]))
                        denied('Collected form responses are immutable; use the request endpoint');
                    if(previous&&requestedForm.version!==previous.version)throw new HttpError(409,'SOURCE_CHANGED','The form changed after this draft was loaded. Reload explicitly before saving.');
                    if((requestedForm.status||'active')!==(previous?.status||'active'))denied('Use the form lifecycle command to archive or restore a form');
                    if(previous?.status==='archived')denied('Restore an archived form before editing it');
                    assertFormLanguageChanges(actor,previous,requestedForm);
                    after = { ...requestedForm, responses: (source as WorkspaceState['forms'][number]|undefined)?.responses || [], version: (previous?.version || 0) + 1,status:'active',updatedAt:new Date().toISOString() };
                }
                if(bucket==='forms'&&before&&!after)denied('Use the form lifecycle command to move a form to the recycle bin');
                if (bucket === "aiJobs" && after)
                    after = { ...after, authorId: actor.id, createdAt: (source as WorkspaceState['aiJobs'][number]|undefined)?.createdAt || new Date().toISOString() };
            }
            const action=before?(after?'updated':'deleted'):'created';
            const event=activity(actor,action,entityId);
            if (after && bucket === "records")
                (after as WorkspaceRecord).history = [...(after as WorkspaceRecord).history, event];
            changes.push({bucket,id:entityId,before:source,after,action,activity:event} as WorkspaceChange);
            const rows=result[bucket] as WorkspaceRow[];
            const index=rows.findIndex(row=>row.id===entityId);
            if (index >= 0) {
                if (after)
                    rows[index] = after;
                else
                    rows.splice(index,1);
            }
            else if (after)
                rows.push(after);
        }
    }
    if (!equal(visible.settings,proposed.settings)) {
        if (!hasWorkspacePermission(actor,'manage','settings'))
            denied();
        if (proposed.settings.apiUrl !== "/api/v1")
            throw new HttpError(422, "validation", "The production API URL is managed by deployment configuration");
        result.settings = { ...proposed.settings };
    }
    result.audit = [...changes.map(change=>change.activity).reverse(),...original.audit].slice(0,300);
    return { state: result, changes, original, settingsChanged: !equal(original.settings,result.settings) };
}
export { assertWorkspaceActor, canReviewSource, checksum, editableSnapshot, equal, hasWorkspacePermission, isContent, planWorkspaceMutation, projectForActor, qualityRecord, readableRecord, recordReviewSnapshot, serverActivity, stableJson };
