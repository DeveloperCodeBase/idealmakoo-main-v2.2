import type { PoolClient } from 'pg';
import type {WorkspaceChange} from './workspace-policy';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { assert } from "./types";
import { equal } from "./workspace-policy";
async function assertCrmDomainChanges(client: PoolClient, changes:WorkspaceChange[], domainCommand = false) {
    for (const change of changes) {
        if (change.bucket !== "records")
            continue;
        const before = change.before, after = change.after;
        if (!after)
            continue;
        if (!domainCommand) {
            for (const key of ["crmDomain", "crmConversion"])
                (assert)((equal)(before?.details?.[key], after.details?.[key]), 403, "CRM_DOMAIN_COMMAND", "Use the typed CRM command to change domain configuration or conversion evidence.");
            if (after.collection === "leads" && after.status === "converted" && before?.status !== "converted")
                (assert)(false, 403, "CRM_CONVERSION_COMMAND", "Use the qualified lead conversion command.");
            const changingMerge = !(equal)(before?.details?.crmMergeOperations, after.details?.crmMergeOperations);
            if (before?.details?.crmDomain && ["accounts", "contacts"].includes(after.collection) && !changingMerge)
                for (const key of ["title", "organization", "email"] as const)
                    (assert)((equal)(before[key], after[key]), 403, "CRM_PROFILE_COMMAND", "Edit the structured account or contact profile in the domain panel.");
            if (before?.collection === "accounts" && before.details?.crmDomain)
                (assert)((equal)(before.details?.parentId, after.details?.parentId), 403, "CRM_PROFILE_COMMAND", "Use the structured account command to change its parent.");
            if (before?.details?.crmDomain && ["samples", "handoffs"].includes(after.collection) && before.status !== after.status) {
                const row = after.collection === "samples" ? (await client.query("SELECT status FROM crm_sample_cases WHERE sample_id=$1", [after.id])).rows[0] : (await client.query("SELECT status FROM crm_order_handoffs WHERE handoff_id=$1", [after.id])).rows[0];
                (assert)(after.status === "archived" || before.status === "archived" && after.status === row?.status, 403, "CRM_TRANSITION_COMMAND", "Use the evidence-checked lifecycle transition command.");
            }
        }
    }
}
export { assertCrmDomainChanges };
