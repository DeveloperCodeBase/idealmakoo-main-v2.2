import type {PgRow} from './recovered-db-rows';
import type {WorkspaceRecord} from '../data/workspace-seed';
import type {FrontRequest} from '../types/frontend';
import type {Locale} from '../lib/i18n';
import type {CrmSampleCase} from '../types/crm-domain';
type SampleRow = PgRow<'crm_sample_cases',{carrier_evidence:CrmSampleCase['carrierEvidence'];evaluation:CrmSampleCase['evaluation']}>;
import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { parse } from "./http";
import { domainId, conversionSchema, sampleTransitionSchema, handoffTransitionSchema } from "./workspace-domain-schema";
import { transaction } from "./db";
import { domainContext, domainRecord, domainPermission, requireContact, prepareAccount, domainMarker, newDomainRecord, requiredProfile, prepareContact, readCrmDomain, domainRequest, prepareOpportunity, persistAccount, persistContact, persistOpportunity, domainEvent, domainSqlError, sampleNext, domainEvidence, retainDomainEvidence, handoffNext, financialVisible } from "./workspace-domain-core";
import { assert } from "./types";
import { randomUUID } from "node:crypto";
import { applyCrmDomainRecords, upsertRequestInWorkspace } from "./workspace";
import { checksum } from "./workspace-policy";
async function convertCrmLead(actor: Actor, id: string, body: unknown) {
    (parse)(domainId, id);
    const input = (parse)(conversionSchema, body);
    try {
        return await (transaction)(async (client) => {
            const current = await (domainContext)(client, actor, input.expectedVersion);
            actor = current.actor;
            const lead = await (domainRecord)(client, actor, id, "leads");
            (domainPermission)(actor, lead, "convert");
            (requireContact)(actor);
            (assert)(!(await client.query("SELECT lead_id FROM crm_lead_conversions WHERE lead_id=$1", [id])).rowCount, 409, "CRM_ALREADY_CONVERTED", "This lead already has a durable conversion outcome.");
            (assert)(!["converted", "withdrawn", "disqualified", "lost"].includes(lead.status), 409, "CRM_LEAD_STATE", "Restore an eligible lead before conversion.");
            const qualification = (await client.query("SELECT * FROM crm_lead_qualifications WHERE lead_id=$1", [id])).rows[0];
            (assert)(qualification && qualification.need_confirmed && qualification.contact_confirmed && qualification.authority_confirmed && qualification.timeframe_confirmed, 422, "CRM_QUALIFICATION_REQUIRED", "Save all four qualification confirmations before conversion.");
            const records: WorkspaceRecord[] = [], accountId = "id" in input.account ? input.account.id : (randomUUID)(), contactId = "id" in input.contact ? input.contact.id : (randomUUID)();
            let account: Awaited<ReturnType<typeof prepareAccount>> | undefined, contact: Awaited<ReturnType<typeof prepareContact>> | undefined;
            if ("create" in input.account) {
                account = await (prepareAccount)(client, actor, accountId, input.account.create);
                records.push((domainMarker)((newDomainRecord)(actor, "accounts", account.displayName, { id: accountId, organization: account.legalName, details: { parentId: account.parentAccountId || void 0 } }), "account"));
            }
            else
                await (requiredProfile)(client, actor, accountId, "account");
            const pendingAccounts = new Set(account ? [accountId] : []), today = new Date().toISOString().slice(0, 10);
            if ("create" in input.contact) {
                const value = input.contact.create;
                const affiliations = [...value.affiliations];
                if (!affiliations.some(item => item.accountId === accountId && item.validFrom <= today && (!item.validTo || item.validTo >= today)))
                    affiliations.push({ accountId, branchId: null, role: "Lead contact", validFrom: today, validTo: null });
                contact = await (prepareContact)(client, actor, contactId, { ...value, affiliations }, pendingAccounts);
                records.push((domainMarker)((newDomainRecord)(actor, "contacts", contact.displayName, { id: contactId, email: contact.endpoints.find(endpoint => endpoint.channel === "email" && endpoint.active)?.value || "" }), "contact"));
            }
            else {
                const existing = await (domainRecord)(client, actor, contactId, "contacts");
                await (requiredProfile)(client, actor, contactId, "contact");
                if (!(await client.query("SELECT id FROM crm_contact_affiliations WHERE contact_id=$1 AND account_id=$2 AND valid_from<=current_date AND (valid_to IS NULL OR valid_to>=current_date)", [contactId, accountId])).rowCount) {
                    (domainPermission)(actor, existing);
                    const view = await (readCrmDomain)(client, actor, existing, current.version);
                    (assert)(view.definition?.kind === "contact", 409, "CRM_PROFILE_REQUIRED", "Complete the selected contact profile.");
                    contact = await (prepareContact)(client, actor, contactId, { ...view.definition, affiliations: [...view.definition.affiliations, { accountId, branchId: null, role: "Lead contact", validFrom: today, validTo: null }] }, pendingAccounts);
                    records.push((domainMarker)(existing, "contact"));
                }
            }
            let opportunityId: string | null = null, prepared: Awaited<ReturnType<typeof prepareOpportunity>> | undefined, needKey: string | undefined;
            const origin = lead.requestId && await (domainRequest)(client, actor, lead.requestId) ? [lead.requestId] : [];
            if (input.opportunity.mode === "create") {
                opportunityId = (randomUUID)();
                needKey = input.opportunity.needKey;
                (assert)(!(await client.query("SELECT opportunity_id FROM crm_opportunity_details WHERE account_id=$1 AND need_key=$2", [accountId, needKey])).rowCount, 409, "CRM_DISTINCT_NEED", "This account already has that distinct need; link the existing opportunity.");
                const lang = actor.allowedLocales.find((locale): locale is Locale => ["fa", "en", "tr", "ar", "ru"].includes(locale));
                (assert)(lang, 403, "LOCALE_SCOPE", "An assigned language is required.");
                prepared = await (prepareOpportunity)(client, actor, opportunityId, { schemaVersion: 1, kind: "opportunity", locale: lang, accountId, contactIds: [contactId], requestIds: origin, items: [] }, pendingAccounts, new Set("create" in input.contact ? [contactId] : []));
                const first = input.opportunity.pipelineId ? (await client.query("SELECT s.stage_id FROM crm_pipelines p JOIN crm_pipeline_stages s ON s.revision_id=p.active_revision_id AND s.position=0 WHERE p.id=$1", [input.opportunity.pipelineId])).rows[0] : void 0;
                if (input.opportunity.pipelineId)
                    (assert)(first, 404, "PIPELINE_NOT_FOUND", "Select an approved pipeline.");
                const details = input.opportunity.pipelineId ? { pipeline: { schemaVersion: 1, pipelineId: input.opportunity.pipelineId, stageId: first!.stage_id, completedChecklistIds: [] } } : {};
                records.push((domainMarker)((newDomainRecord)(actor, "opportunities", input.opportunity.title, { id: opportunityId, linkedId: id, details }), "opportunity"));
            }
            else if (input.opportunity.mode === "link") {
                opportunityId = input.opportunity.id;
                const existing = await (domainRecord)(client, actor, opportunityId, "opportunities");
                (domainPermission)(actor, existing);
                const profile = (await client.query("SELECT account_id FROM crm_opportunity_details WHERE opportunity_id=$1", [opportunityId])).rows[0];
                (assert)(profile?.account_id === accountId, 422, "CRM_OPPORTUNITY_ACCOUNT", "Link an opportunity for the selected account.");
                const view = await (readCrmDomain)(client, actor, existing, current.version);
                (assert)(view.definition?.kind === "opportunity", 409, "CRM_OPPORTUNITY_REQUIRED", "Configure the selected opportunity first.");
                prepared = await (prepareOpportunity)(client, actor, opportunityId, { ...view.definition, accountId, contactIds: [...new Set([...view.definition.contactIds || [], contactId])], requestIds: [...new Set([...view.definition.requestIds, ...origin])] }, pendingAccounts, new Set("create" in input.contact ? [contactId] : []));
                records.push((domainMarker)(existing, "opportunity"));
            }
            const reason = input.opportunity.mode === "none" ? input.opportunity.reason : null;
            records.push((domainMarker)(lead, "lead", { status: "converted", linkedId: opportunityId || void 0, details: { ...lead.details, crmConversion: { schemaVersion: 1, accountId, contactId, opportunityId, reason } } }));
            return (applyCrmDomainRecords)(client, actor, records, "crm.lead.converted", async (connection) => {
                if (account)
                    await (persistAccount)(connection, accountId, account);
                if (contact)
                    await (persistContact)(connection, contactId, contact);
                if (opportunityId && prepared)
                    await (persistOpportunity)(connection, actor, opportunityId, prepared, needKey);
                await connection.query("INSERT INTO crm_lead_conversions(lead_id,opportunity_id,actor_id,account_id,contact_id,no_opportunity_reason) VALUES($1,$2,$3,$4,$5,$6)", [id, opportunityId, actor.id, accountId, contactId, reason]);
                await (domainEvent)(connection, actor, id, "crm.lead.converted", { accountId, contactId, opportunityId, reasonHash: reason ? (checksum)(reason) : null });
            });
        });
    }
    catch (error) {
        (domainSqlError)(error);
    }
}
const validPast = (value: string) => Date.parse(value) <= Date.now() + 5 * 6e4;
async function createSampleQualityReferral(client: PoolClient, actor: Actor, sampleId: string, request: NonNullable<Awaited<ReturnType<typeof domainRequest>>>, evaluation: NonNullable<CrmSampleCase['evaluation']>) { const original = request.data; (assert)(original.productIds?.length && evaluation.batch, 422, "CRM_QUALITY_DETAILS", "Quality referral requires the original sample product and its batch."); const id = "IM-REQ-" + (randomUUID)(), createdAt = new Date().toISOString(); const value: FrontRequest = { id, kind: "quality_complaint", name: original.name, email: original.email, organization: original.organization, message: evaluation.feedback, productIds: original.productIds, batch: evaluation.batch, status: "received", createdAt, ownerId: request.owner_id || "guest", locale: request.locale, version: 1, messages: [], sharedQuotes: [], attachmentIds: [] }; await client.query("INSERT INTO requests(id,owner_id,guest_token_hash,kind,locale,data,quality_quarantined,sla,consent_snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb,true,$7::jsonb,$8::jsonb)", [id, request.owner_id, request.guest_token_hash, "quality_complaint", request.locale, JSON.stringify(value), JSON.stringify({ policy: "pending-quality-routing" }), JSON.stringify({ purpose: "quality_follow_up", sourceRequestId: request.id, sourceSampleId: sampleId, recordedAt: createdAt })]); await (upsertRequestInWorkspace)(client, { ...value, qualityQuarantined: true }, { bumpVersion: false }); await (domainEvent)(client, actor, sampleId, "crm.sample.quality_referred", { requestId: id, sourceRequestId: request.id }); return id; }
async function transitionCrmSample(actor: Actor, id: string, body: unknown) {
    (parse)(domainId, id);
    const input = (parse)(sampleTransitionSchema, body);
    try {
        return await (transaction)(async (client) => {
            actor = (await (domainContext)(client, actor, input.expectedVersion)).actor;
            const record = await (domainRecord)(client, actor, id, "samples");
            (domainPermission)(actor, record, "stage");
            const before = (await client.query<SampleRow>("SELECT * FROM crm_sample_cases WHERE sample_id=$1 FOR UPDATE", [id])).rows[0];
            (assert)(before, 409, "CRM_SAMPLE_REQUIRED", "Configure the sample before moving it.");
            await (domainRecord)(client, actor, before.opportunity_id, "opportunities");
            const request = await (domainRequest)(client, actor, before.request_id);
            (assert)(request, 404, "CRM_REQUEST_SCOPE", "The original sample request is outside your current scope.");
            (assert)(sampleNext[before.status].includes(input.to), 409, "CRM_SAMPLE_TRANSITION", "Move to the next evidenced sample stage.");
            (assert)((input.to === "shipped" || input.carrierEvidence === void 0) && (input.to === "received" || input.receivedAt === void 0) && (input.to === "evaluated" || input.evaluation === void 0), 422, "CRM_SAMPLE_FIELDS", "Supply evidence only for the requested transition.");
            let carrier = before.carrier_evidence, received = before.received_at?.toISOString() || null, evaluation = before.evaluation;
            if (input.to === "shipped") {
                (assert)(input.carrierEvidence && validPast(input.carrierEvidence.shippedAt), 422, "CRM_CARRIER_REQUIRED", "Provide the carrier, tracking reference, actual shipping time and evidence.");
                await (domainEvidence)(client, actor, input.carrierEvidence.evidenceAssetId, before.request_id, id);
                carrier = input.carrierEvidence;
            }
            if (input.to === "received") {
                (assert)(input.receivedAt && carrier && Date.parse(input.receivedAt) >= Date.parse(carrier.shippedAt) && validPast(input.receivedAt), 422, "CRM_RECEIPT_TIME", "Receipt must be at or after shipment and cannot be in the future.");
                received = input.receivedAt;
            }
            if (input.to === "evaluated") {
                (assert)(input.evaluation && received && Date.parse(input.evaluation.evaluatedAt) >= Date.parse(received) && validPast(input.evaluation.evaluatedAt), 422, "CRM_EVALUATION_REQUIRED", "Record feedback and its actual evaluation time after receipt.");
                evaluation = { ...input.evaluation, batch: input.evaluation.batch || null };
                if (evaluation.outcome === "quality_concern")
                    (assert)(evaluation.batch, 422, "CRM_QUALITY_DETAILS", "A quality concern requires the batch number.");
            }
            const next = (domainMarker)(record, "sample", { status: input.to });
            return (applyCrmDomainRecords)(client, actor, [next], "crm.sample.transitioned", async (connection) => {
                let qualityId = before.quality_request_id;
                if (evaluation?.outcome === "quality_concern" && !qualityId)
                    qualityId = await createSampleQualityReferral(connection, actor, id, request, evaluation);
                await connection.query("UPDATE crm_sample_cases SET status=$2,carrier_evidence=$3::jsonb,evidence_asset_id=$4,received_at=$5,evaluation=$6::jsonb,quality_request_id=$7,updated_at=now() WHERE sample_id=$1", [id, input.to, carrier ? JSON.stringify(carrier) : null, carrier?.evidenceAssetId || null, received, evaluation ? JSON.stringify(evaluation) : null, qualityId]);
                if (carrier)
                    await (retainDomainEvidence)(connection, id, carrier.evidenceAssetId);
                await (domainEvent)(connection, actor, id, "crm.sample.transitioned", { from: before.status, to: input.to, evidenceAssetId: carrier?.evidenceAssetId || null, evaluationHash: evaluation ? (checksum)(evaluation) : null });
            });
        });
    }
    catch (error) {
        (domainSqlError)(error);
    }
}
async function transitionCrmHandoff(actor: Actor, id: string, body: unknown) {
    (parse)(domainId, id);
    const input = (parse)(handoffTransitionSchema, body);
    try {
        return await (transaction)(async (client) => {
            actor = (await (domainContext)(client, actor, input.expectedVersion)).actor;
            const record = await (domainRecord)(client, actor, id, "handoffs");
            (domainPermission)(actor, record, "stage");
            const before = (await client.query<PgRow<'crm_order_handoffs'>>("SELECT * FROM crm_order_handoffs WHERE handoff_id=$1 FOR UPDATE", [id])).rows[0];
            (assert)(before, 409, "CRM_HANDOFF_REQUIRED", "Configure the manual handoff before moving it.");
            await (domainRecord)(client, actor, before.opportunity_id, "opportunities");
            (assert)(handoffNext[before.status].includes(input.to), 409, "CRM_HANDOFF_TRANSITION", "This manual handoff transition is unavailable.");
            if (before.quote_id) {
                (assert)((financialVisible)(actor), 403, "CRM_FINANCIAL_REQUIRED", "A quote-linked handoff requires current financial permission.");
                const quote = (await client.query("SELECT request_id FROM quote_snapshots WHERE id=$1", [before.quote_id])).rows[0];
                (assert)(quote && await (domainRequest)(client, actor, quote.request_id), 404, "CRM_QUOTE_SCOPE", "The issued quote request is outside your current scope.");
            }
            if (before.status === "uncertain")
                (assert)(input.reconciliation && input.reconciliation.outcome === (input.to === "ready" ? "confirmed_absent" : "confirmed_received") && input.evidenceAssetId, 422, "CRM_RECONCILIATION_REQUIRED", "Resolve the uncertain external outcome with explicit evidence before retrying or acknowledging.");
            else
                (assert)(input.reconciliation === void 0, 422, "CRM_RECONCILIATION_STATE", "Reconciliation applies only to an uncertain attempt.");
            if (["submitted", "acknowledged"].includes(input.to))
                (assert)(input.evidenceAssetId && input.externalReference, 422, "CRM_HANDOFF_EVIDENCE", "Supply the external reference and actual submission or acknowledgment evidence.");
            if (input.evidenceAssetId)
                await (domainEvidence)(client, actor, input.evidenceAssetId, void 0, id);
            const evidence = input.evidenceAssetId || before.last_evidence_asset_id, externalReference = input.externalReference || before.external_reference, externalStatus = input.externalStatus || before.external_status, attempt = before.attempt + (input.to === "submitted" ? 1 : 0);
            return (applyCrmDomainRecords)(client, actor, [(domainMarker)(record, "handoff", { status: input.to })], "crm.handoff.transitioned", async (connection) => {
                await connection.query("UPDATE crm_order_handoffs SET status=$2,external_status=$3,external_reference=$4,last_evidence_asset_id=$5,attempt=$6,last_note=$7,updated_at=now() WHERE handoff_id=$1", [id, input.to, externalStatus, externalReference, evidence, attempt, input.note]);
                if (evidence)
                    await (retainDomainEvidence)(connection, id, evidence);
                await (domainEvent)(connection, actor, id, "crm.handoff.transitioned", { from: before.status, to: input.to, attempt, evidenceAssetId: evidence, externalStatus, externalReferenceHash: externalReference ? (checksum)(externalReference) : null, noteHash: (checksum)(input.note), reconciliation: input.reconciliation ? { outcome: input.reconciliation.outcome, reasonHash: (checksum)(input.reconciliation.reason) } : null });
            });
        });
    }
    catch (error) {
        (domainSqlError)(error);
    }
}
export { convertCrmLead, transitionCrmHandoff, transitionCrmSample };
