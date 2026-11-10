/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */


import type { WorkspaceRecord, WorkspaceState } from '@/data/workspace-seed';
import type { MergeField, MergeOperation } from '@/components/workspace/crm-tools-logic';
import type { Actor } from './types';
import { HttpError } from "./types";
import { mergeFields, getMergeOperations, mergeCrmRecords, unmergeCrmRecords } from "@/components/workspace/crm-tools-logic";
import { equal, readableRecord } from "./workspace-policy";
import { canWorkspace } from "@/lib/auth";
import { id, isObject } from "./workspace-validation";
import { recordText } from "@/data/workspace-seed";
function fail(message:string):never {throw new HttpError(422,'crm_invariant',message);}
const snapshot=(record:WorkspaceRecord)=>Object.fromEntries([...mergeFields,'status','tags'].map(field=>[field,record[field as keyof WorkspaceRecord]]));
const fieldsEqual=(actual:WorkspaceRecord,expected:WorkspaceRecord)=>equal(snapshot(actual),snapshot(expected));
const protectedDetailKeys=['qualityQuarantined','publicRequestStatus','lastIssuedQuoteId','lastIssuedQuoteHash'];
function validateCrmChanges(original:WorkspaceState,proposed:WorkspaceState,actor:Actor) {
    const merges:MergeOperation[]=[], unmerges:MergeOperation[]=[];
    const originalMap=new Map(original.records.map(row=>[row.id,row]));
    for (const next of proposed.records) {
        const before=originalMap.get(next.id);
        if (equal(before,next))
            continue;
        for (const [previous, targetId] of [[before?.linkedId, next.linkedId], [before?.details?.parentId, next.details?.parentId]])
            if (targetId && previous !== targetId) {
                const target = proposed.records.find(record => record.id === targetId);
                if (!target || !(readableRecord)(actor, target))
                    throw new HttpError(422, "CRM_LINK_SCOPE", "The selected relationship target is unavailable in your current scope.");
            }
        if (before?.collection === "leads" && (before.status === "converted" || before.archivedFrom === "converted") && (next.linkedId !== before.linkedId || !['converted','archived','withdrawn'].includes(next.status)))
            throw new HttpError(409, "already_converted", "A converted lead must keep its linked opportunity and conversion history");
        for (const key of protectedDetailKeys)
            if (!equal(before?.details?.[key],next.details?.[key]))
                throw new HttpError(403, "server_field", "Request ownership, quarantine and issuance facts are server-managed");
        const oldOperations=before?getMergeOperations(before):[];
        const operations=getMergeOperations(next);
        if (next.details?.crmMergeOperations !== void 0 && !Array.isArray(next.details.crmMergeOperations))
            fail('Invalid merge operation history');
        if (oldOperations.some(previous=>!operations.some(operation=>operation.id===previous.id)))
            fail('Merge operation history cannot be erased');
        for (const operation of operations) {
            const previous=oldOperations.find(item=>item.id===operation.id);
            if (equal(previous,operation))
                continue;
            if (!canWorkspace(actor.role,'merge',next.collection))
                throw new HttpError(403, "forbidden", "Merge operations are not allowed");
            id(operation.id,'merge.id');
            if (operation.targetId !== next.id)
                fail('Merge target identity changed');
            const oldSource=originalMap.get(operation.sourceId), newSource=proposed.records.find(row=>row.id===operation.sourceId);
            if (!before || !oldSource || !newSource)
                fail('Both merge records must exist');
            if (!previous) {
                if (merges.length || unmerges.length)
                    fail('Submit one merge operation per transaction');
                if (operation.state !== "merged" || !equal(operation.beforeTarget,snapshot(before)) || operation.beforeSourceStatus !== oldSource.status || operation.beforeSourceArchivedFrom !== oldSource.archivedFrom)
                    fail('Merge snapshots do not match current server records');
                const choices:Partial<Record<MergeField,'target'|'source'>>={};
                for (const field of mergeFields) {
                    const chosen=operation.afterTarget[field];
                    if (equal(chosen,before[field]))
                        choices[field] = "target";
                    else if (equal(chosen,oldSource[field]))
                        choices[field] = "source";
                    else
                        fail('Merge field value is not from either source');
                }
                const expected=mergeCrmRecords(original.records,{targetId:next.id,sourceId:oldSource.id,choices,id:operation.id,at:operation.at,actor:operation.actor,message:recordText('Merge')});
                if (!expected.ok)
                    fail(expected.error);
                const expectedTarget=expected.value.records.find(row=>row.id===next.id)!, expectedSource=expected.value.records.find(row=>row.id===oldSource.id)!;
                if (!fieldsEqual(next,expectedTarget) || !fieldsEqual(newSource,expectedSource) || !equal(operation.importedActivityIds,expected.value.operation.importedActivityIds) || !equal(operation.afterTarget,expected.value.operation.afterTarget) || !equal(newSource.details?.crmMergeAlias,expectedSource.details?.crmMergeAlias))
                    fail('The merge mutation is inconsistent');
                merges.push(operation);
            }
            else {
                if (merges.length || unmerges.length)
                    fail('Submit one merge operation per transaction');
                if (previous.state !== "merged" || operation.state !== "undone" || !equal({...previous,state:undefined,undoneAt:undefined,retainedFields:undefined},{...operation,state:undefined,undoneAt:undefined,retainedFields:undefined}))
                    fail('Historical merge metadata is immutable');
                const expected=unmergeCrmRecords(original.records,next.id,operation.id,{at:operation.undoneAt||new Date().toISOString(),actor:actor.role,message:recordText('Unmerge')});
                if (!expected.ok)
                    fail(expected.error);
                const expectedTarget=expected.value.records.find(row=>row.id===next.id)!, expectedSource=expected.value.records.find(row=>row.id===oldSource.id)!;
                if (!fieldsEqual(next,expectedTarget) || !fieldsEqual(newSource,expectedSource) || !equal(operation.retainedFields,expected.value.retainedFields) || newSource.details?.crmMergeAlias)
                    fail('The unmerge mutation is inconsistent');
                unmerges.push(operation);
            }
        }
    }
    for (const next of proposed.records) {
        const before=originalMap.get(next.id);
        if (!equal(before?.details?.crmMergeAlias,next.details?.crmMergeAlias) && ![...merges,...unmerges].some(operation=>operation.sourceId===next.id))
            fail('Merge aliases require the corresponding complete merge command');
        if (next.collection === "leads" && (next.status === "converted" || next.archivedFrom === "converted")) {
            const conversion = (isObject)(next.details?.crmConversion) ? next.details.crmConversion : void 0;
            const qualified = conversion?.schemaVersion === 1 && typeof conversion.accountId === "string" && typeof conversion.contactId === "string";
            const withoutOpportunity = qualified && conversion.opportunityId === null && typeof conversion.reason === "string" && conversion.reason.length >= 10 && !next.linkedId;
            const linked = proposed.records.some(opportunity => opportunity.id === next.linkedId && opportunity.collection === "opportunities" && (opportunity.linkedId === next.id || qualified && conversion.opportunityId === opportunity.id));
            if (!withoutOpportunity && !linked)
                fail("Converted leads must retain their durable conversion outcome and opportunity relationship");
        }
    }
    const accounts=new Map(proposed.records.filter(row=>row.collection==='accounts'&&row.status!=='archived').map(row=>[row.id,row]));
    for (const account of accounts.values()) {
        let parent=account.details?.parentId;
        const seen=new Set([account.id]);
        while (parent) {
            if (typeof parent !== "string" || !accounts.has(parent))
                fail('The parent account does not exist');
            if (seen.has(parent))
                fail('Account hierarchies cannot contain cycles');
            seen.add(parent);
            parent = accounts.get(parent)!.details?.parentId;
        }
    }
    const imports=new Set<string>();
    for (const record of proposed.records) {
        const origin=isObject(record.details?.importOrigin)?record.details.importOrigin:undefined;
        const fingerprint=typeof record.details?.importFingerprint==='string'?record.details.importFingerprint:undefined;
        for (const key of [origin?.externalId ? `${record.collection}:external:${String(origin.externalId)}` : void 0, fingerprint ? `${record.collection}:fingerprint:${fingerprint}` : void 0])
            if (key) {
                if (imports.has(key))
                    fail('An imported external record cannot be duplicated');
                imports.add(key);
            }
    }
    return { merges, unmerges };
}
export { validateCrmChanges };
