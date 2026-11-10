import type {PrivacySubject} from './privacy-ledger';
import type {PrivacyBlocker} from './privacy';
type DependencyReference={schema:string;table:string;parent_schema:string;parent_table:string;delete_action:string;columns:{local:string;remote:string}[]};
type DependencyNode={schema:string;table:string;path:string[];predicate:(alias:string)=>string};
type DependencyEdge={reference:DependencyReference;predicate:(alias:string)=>string};
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { assert } from "./types";
const quote = (name: string) => '"' + name.replaceAll('"', '""') + '"';
const safeParents = ["users", "workspace_entities", "sessions", "auth_challenges", "user_settings", "notifications", "notification_preferences", "consent_events", "communication_recipients", "crm_contact_profiles", "crm_contact_endpoints", "crm_endpoint_challenges", "crm_endpoint_preferences", "communication_preference_tokens", "communication_bindings", "communication_binding_challenges", "wishlists", "wishlist_items", "wishlist_shares", "inquiry_merge_receipts", "content_comments", "content_likes", "content_reports"];
const manualAccountLeaves = new Set(["notifications", "notification_preferences", "consent_events"]);
function allowedEdge(reference: DependencyReference, schema: string) {
    if (reference.schema !== schema)
        return false;
    const pairs = reference.columns.map(column => column.local + "=" + column.remote).sort().join(",");
    if (reference.parent_table === "users" && ["sessions", "auth_challenges", "user_settings", "notifications", "notification_preferences", "consent_events", "communication_recipients", "wishlists", "inquiry_merge_receipts", "content_comments", "content_likes", "content_reports"].includes(reference.table))
        return pairs === "user_id=id";
    if (reference.parent_table === "wishlists" && ["wishlist_items", "wishlist_shares"].includes(reference.table))
        return pairs === "wishlist_id=id";
    if (reference.parent_table === "workspace_entities" && reference.table === "crm_contact_profiles")
        return pairs === "document_bucket=bucket,record_id=id";
    if (reference.parent_table === "crm_contact_profiles" && ["communication_recipients", "crm_contact_endpoints"].includes(reference.table))
        return pairs === "contact_id=record_id";
    if (reference.parent_table === "communication_recipients" && ["crm_contact_endpoints", "communication_preference_tokens", "communication_bindings"].includes(reference.table))
        return pairs === "recipient_id=id";
    if (reference.parent_table === "communication_bindings" && ["communication_binding_challenges", "communication_preference_tokens"].includes(reference.table))
        return pairs === "binding_id=id";
    if (reference.parent_table === "crm_contact_endpoints" && reference.table === "communication_bindings")
        return pairs === "source_endpoint_id=id";
    return reference.parent_table === "crm_contact_endpoints" && ["crm_endpoint_challenges", "crm_endpoint_preferences", "communication_preference_tokens"].includes(reference.table) && pairs === "endpoint_id=id";
}
async function privacyDependencyBlockers(client: PoolClient, subject: PrivacySubject) : Promise<PrivacyBlocker[]> {
    const schema = (await client.query("SELECT current_schema() AS name")).rows[0].name;
    const references = (await client.query<DependencyReference>(`SELECT n.nspname AS schema,c.relname AS table,pn.nspname AS parent_schema,p.relname AS parent_table,f.confdeltype AS delete_action,
    jsonb_agg(jsonb_build_object('local',a.attname,'remote',r.attname) ORDER BY keys.ordinality) AS columns
    FROM pg_constraint f JOIN pg_class c ON c.oid=f.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_class p ON p.oid=f.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
    JOIN LATERAL unnest(f.conkey,f.confkey) WITH ORDINALITY AS keys(local_num,remote_num,ordinality) ON true
    JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum=keys.local_num JOIN pg_attribute r ON r.attrelid=p.oid AND r.attnum=keys.remote_num
    WHERE f.contype='f' AND pn.nspname=current_schema() AND p.relname=ANY($1::text[])
    GROUP BY f.oid,n.nspname,c.relname,pn.nspname,p.relname,f.confdeltype`, [safeParents])).rows;
    const table = subject.type === "user" ? "users" : "workspace_entities";
    const nodes: DependencyNode[] = [{ schema, table, path: [table], predicate: (alias: string) => alias + ".id=$1" + (subject.type === "crm-contact" ? " AND " + alias + ".bucket='records' AND " + alias + ".collection='contacts'" : "") }];
    const edges: DependencyEdge[] = [];
    for (let index = 0; index < nodes.length; index++) {
        (assert)(nodes.length <= 64, 503, "PRIVACY_REFERENCE_GRAPH", "The identity dependency graph needs an operator-reviewed retention plan.");
        const node = nodes[index];
        for (const reference of references.filter(row => row.parent_schema === node.schema && row.parent_table === node.table)) {
            const parentAlias = "privacy_parent_" + index, predicate = (alias: string) => `EXISTS(SELECT 1 FROM ${quote(node.schema)}.${quote(node.table)} ${parentAlias} WHERE (${node.predicate(parentAlias)}) AND ${reference.columns.map(pair => alias + "." + quote(pair.local) + "=" + parentAlias + "." + quote(pair.remote)).join(" AND ")})`;
            edges.push({ reference, predicate });
            const manual = subject.type === "user" && node.table === "users" && manualAccountLeaves.has(reference.table);
            if (allowedEdge(reference, schema) && (reference.delete_action === "c" || manual) && !node.path.includes(reference.table))
                nodes.push({ schema: reference.schema, table: reference.table, path: [...node.path, reference.table], predicate });
        }
    }
    const groups = new Map<string,{reference:DependencyReference;predicates:string[]}>();
    for (const edge of edges) {
        const { reference } = edge, key = reference.schema + "." + reference.table, covered = nodes.filter(node => node.schema === reference.schema && node.table === reference.table).map(node => "(" + node.predicate("retained_child") + ")");
        const predicate = "(" + edge.predicate("retained_child") + ")" + (covered.length ? " AND NOT (" + covered.join(" OR ") + ")" : "");
        const group = groups.get(key) || { reference, predicates: [] };
        group.predicates.push(predicate);
        groups.set(key, group);
    }
    const blockers = [];
    for (const { reference, predicates } of groups.values()) {
        const count = Number((await client.query(`SELECT count(*)::text AS count FROM ${quote(reference.schema)}.${quote(reference.table)} retained_child WHERE ${predicates.map(value => "(" + value + ")").join(" OR ")}`, [subject.id])).rows[0].count);
        if (count)
            blockers.push({ code: "DEPENDENCY_" + reference.table.toUpperCase(), description: "Retained " + reference.table + " records reference this subject or an identity child. No automatic disposition is defined.", count });
    }
    return blockers;
}
async function privacyCopiedTextBlockers(client: PoolClient, subject: PrivacySubject, needles: string[]) : Promise<PrivacyBlocker[]> {
    if (!needles.length)
        return [];
    const rows = (await client.query<{schema:string;table:string;columns:string[]}>(`SELECT n.nspname AS schema,c.relname AS table,array_agg(a.attname::text ORDER BY a.attnum) AS columns
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
    JOIN pg_type t ON t.oid=a.atttypid WHERE n.nspname=current_schema() AND c.relkind='r' AND t.typname IN ('text','varchar','bpchar','json','jsonb')
      AND c.relname NOT IN ('schema_migrations','privacy_ledger_state','privacy_tombstones')
      AND a.attname!~*'(password|token|secret|signature|hash|encrypted|(^|_)id$)'
    GROUP BY n.nspname,c.relname ORDER BY c.relname`)).rows;
    (assert)(rows.length <= 500, 503, "PRIVACY_REFERENCE_GRAPH", "The retained content directory needs an operator-reviewed erasure plan.");
    const blockers = [];
    for (const row of rows) {
        let excluded = "false";
        if (subject.type === "user") {
            if (row.table === "users")
                excluded = "source.id=$1";
            if (["sessions", "auth_challenges", "user_settings", "notification_preferences", "notifications", "consent_events", "communication_recipients", "wishlists", "inquiry_merge_receipts", "content_comments", "content_likes", "content_reports"].includes(row.table))
                excluded = "source.user_id=$1";
            if (["wishlist_items", "wishlist_shares"].includes(row.table))
                excluded = "source.wishlist_id IN (SELECT id FROM wishlists WHERE user_id=$1)";
            if (["communication_bindings", "communication_preference_tokens"].includes(row.table))
                excluded = "source.recipient_id IN (SELECT id FROM communication_recipients WHERE subject_type='user' AND user_id=$1)";
            if (row.table === "communication_binding_challenges")
                excluded = "source.binding_id IN (SELECT b.id FROM communication_bindings b JOIN communication_recipients r ON r.id=b.recipient_id WHERE r.subject_type='user' AND r.user_id=$1)";
        }
        else {
            if (row.table === "workspace_entities")
                excluded = "source.bucket='records' AND source.collection='contacts' AND source.id=$1";
            if (row.table === "crm_contact_profiles")
                excluded = "source.record_id=$1";
            if (["communication_recipients", "crm_contact_endpoints"].includes(row.table))
                excluded = "source.contact_id=$1";
            if (row.table === "crm_endpoint_challenges")
                excluded = "source.endpoint_id IN (SELECT id FROM crm_contact_endpoints WHERE contact_id=$1)";
            if (row.table === "crm_endpoint_preferences")
                excluded = "source.endpoint_id IN (SELECT id FROM crm_contact_endpoints WHERE contact_id=$1)";
            if (["communication_bindings", "communication_preference_tokens"].includes(row.table))
                excluded = "source.recipient_id IN (SELECT id FROM communication_recipients WHERE subject_type='crm-contact' AND contact_id=$1)";
            if (row.table === "communication_binding_challenges")
                excluded = "source.binding_id IN (SELECT b.id FROM communication_bindings b JOIN communication_recipients r ON r.id=b.recipient_id WHERE r.subject_type='crm-contact' AND r.contact_id=$1)";
        }
        const result = (await client.query(`WITH bounded AS (SELECT concat_ws(chr(10),${row.columns.map(column => "source." + quote(column) + "::text").join(",")}) AS value FROM ${quote(row.schema)}.${quote(row.table)} source WHERE NOT coalesce((${excluded}),false) AND $1::text IS NOT NULL LIMIT 10001)
      SELECT count(*)::text AS checked,count(*) FILTER(WHERE EXISTS(SELECT 1 FROM unnest($2::text[]) needle WHERE position(needle IN lower(value))>0))::text AS matched FROM bounded`, [subject.id, needles])).rows[0];
        if (Number(result.checked) > 1e4)
            blockers.push({ code: "TEXT_REVIEW_LIMIT_" + row.table.toUpperCase(), description: "Retained " + row.table + " content exceeds the 10,000-row online inspection bound. An operator-reviewed retention operation is required.", count: Number(result.checked) });
        else if (Number(result.matched))
            blockers.push({ code: "RETAINED_TEXT_" + row.table.toUpperCase(), description: "Retained " + row.table + " content contains copied subject values. Its explicit retention disposition must be reviewed.", count: Number(result.matched) });
    }
    return blockers;
}
export { privacyCopiedTextBlockers, privacyDependencyBlockers };
