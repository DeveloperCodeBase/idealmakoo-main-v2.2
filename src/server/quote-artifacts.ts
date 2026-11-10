import type {SharedQuote} from '../types/frontend';
type QuoteFileMetadata={sha256:string;byte_count:number;origin:'issued'|'legacy-rendered';created_at:Date};
export type QuoteFileRow=QuoteFileMetadata & {quote_id:string;pdf_bytes:Buffer};
type QuoteArtifactProjection={snapshot:SharedQuote;file_sha256?:string|null;file_byte_count?:number|null;file_origin?:'issued'|'legacy-rendered'|null;file_created_at?:Date|null};
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { createHash } from "node:crypto";
import { assert } from "./types";
import { audit } from "./db";
const QUOTE_PDF_MAX_BYTES = 4 * 1024 * 1024;
const quoteArtifactProjectionSql = "q.*,f.sha256 AS file_sha256,f.byte_count AS file_byte_count,f.origin AS file_origin,f.created_at AS file_created_at";
const digest = (bytes: Buffer) => (createHash)("sha256").update(bytes).digest("hex");
function metadata(artifact: QuoteFileMetadata) { return { fileSha256: artifact.sha256, fileByteCount: artifact.byte_count, fileOrigin: artifact.origin, fileCreatedAt: artifact.created_at.toISOString() }; }
function quoteArtifactDto(row: QuoteArtifactProjection) : SharedQuote {
    if (!row.file_sha256) {
        (assert)(!row.snapshot.fileSha256, 503, "QUOTE_ARTIFACT_MISSING", "The issued PDF artifact is missing. Restore its verified database backup before download.");
        return row.snapshot;
    }
    (assert)(row.file_byte_count && row.file_origin && row.file_created_at, 503, "QUOTE_ARTIFACT_INTEGRITY", "The quotation file metadata is incomplete.");
    const value = metadata({ sha256: row.file_sha256, byte_count: row.file_byte_count, origin: row.file_origin, created_at: row.file_created_at });
    if (row.snapshot.fileSha256)
        (assert)(row.snapshot.fileSha256 === value.fileSha256 && row.snapshot.fileByteCount === value.fileByteCount && row.snapshot.fileOrigin === value.fileOrigin && row.snapshot.fileCreatedAt === value.fileCreatedAt, 503, "QUOTE_ARTIFACT_INTEGRITY", "The stored PDF metadata does not match its issued snapshot.");
    return { ...row.snapshot, ...value };
}
async function immutablePdf(snapshot: SharedQuote) { (assert)(snapshot.customerSnapshot?.name && snapshot.sellerSnapshot?.name && snapshot.locale, 409, "QUOTE_LEGACY_PARTIES_MISSING", "This historical quotation lacks frozen party identities. Create a reviewed new issuance; the old commercial snapshot is retained."); const { renderQuotePdf } = await import("./quote-pdf"); const bytes = await renderQuotePdf(snapshot, { name: snapshot.customerSnapshot.name, organization: snapshot.customerSnapshot.organization, locale: snapshot.locale }); (assert)(bytes.length >= 5 && bytes.length <= QUOTE_PDF_MAX_BYTES && bytes.subarray(0, 5).toString() === "%PDF-", 413, "QUOTE_PDF_SIZE", "A quotation PDF must be a valid artifact no larger than4MiB."); return bytes; }
async function prepareIssuedQuoteArtifact(snapshot: SharedQuote) { const bytes = await immutablePdf(snapshot); return { bytes, snapshot: { ...snapshot, fileSha256: digest(bytes), fileByteCount: bytes.length, fileCreatedAt: snapshot.issuedAt, fileOrigin: "issued" as const } }; }
async function persistIssuedQuoteArtifact(client: PoolClient, snapshot: SharedQuote, bytes: Buffer) {
    (assert)(snapshot.fileOrigin === "issued" && snapshot.fileSha256 === digest(bytes) && snapshot.fileByteCount === bytes.length && bytes.length <= QUOTE_PDF_MAX_BYTES, 503, "QUOTE_ARTIFACT_INTEGRITY", "The prepared quotation PDF metadata is invalid.");
    await client.query("INSERT INTO quote_revision_files(quote_id,pdf_bytes,sha256,byte_count,origin,created_at) VALUES($1,$2,$3,$4,'issued',$5)", [snapshot.id, bytes, snapshot.fileSha256, bytes.length, snapshot.fileCreatedAt]);
    const row = (await client.query(`INSERT INTO crm_quote_envelopes(record_id,request_id,current_revision_id)
    VALUES($1,$2,$3) ON CONFLICT(record_id) DO UPDATE SET current_revision_id=EXCLUDED.current_revision_id,version=crm_quote_envelopes.version+1,updated_at=clock_timestamp()
    WHERE crm_quote_envelopes.request_id=EXCLUDED.request_id RETURNING *`, [snapshot.recordId, snapshot.requestId, snapshot.id])).rows[0];
    (assert)(row, 409, "QUOTE_ENVELOPE_IDENTITY", "This quote envelope belongs to another request.");
    return { recordId: row.record_id, requestId: row.request_id, currentRevisionId: row.current_revision_id, version: row.version, updatedAt: row.updated_at.toISOString() };
}
function verifyArtifact(row: QuoteFileRow, snapshot: SharedQuote) { (assert)(Buffer.isBuffer(row.pdf_bytes) && row.pdf_bytes.length >= 5 && row.pdf_bytes.length <= QUOTE_PDF_MAX_BYTES && row.pdf_bytes.length === row.byte_count && digest(row.pdf_bytes) === row.sha256 && row.pdf_bytes.subarray(0, 5).toString() === "%PDF-", 503, "QUOTE_ARTIFACT_INTEGRITY", "The stored quotation PDF failed byte-count or checksum verification."); quoteArtifactDto({ snapshot, file_sha256: row.sha256, file_byte_count: row.byte_count, file_origin: row.origin, file_created_at: row.created_at }); return row; }
async function getOrCreateQuoteArtifact(client: PoolClient, snapshot: SharedQuote, actorId: string | null) {
    const existing = (await client.query("SELECT * FROM quote_revision_files WHERE quote_id=$1", [snapshot.id])).rows[0];
    if (existing)
        return { artifact: verifyArtifact(existing, snapshot), created: false };
    (assert)(!snapshot.fileSha256, 503, "QUOTE_ARTIFACT_MISSING", "The original issued PDF is missing. Restore it from a verified database backup; it will not be regenerated.");
    const bytes = await immutablePdf(snapshot), createdAt = new Date;
    const stored = (await client.query("INSERT INTO quote_revision_files(quote_id,pdf_bytes,sha256,byte_count,origin,created_at) VALUES($1,$2,$3,$4,'legacy-rendered',$5) RETURNING *", [snapshot.id, bytes, digest(bytes), bytes.length, createdAt])).rows[0];
    await (audit)(actorId, "quote.pdf.legacy_materialized", "quote", snapshot.id, { requestId: snapshot.requestId, sha256: stored.sha256, bytes: stored.byte_count, origin: stored.origin }, client);
    await client.query("UPDATE requests SET version=version+1,updated_at=now() WHERE id=$1", [snapshot.requestId]);
    return { artifact: verifyArtifact(stored, snapshot), created: true };
}
export { QUOTE_PDF_MAX_BYTES, getOrCreateQuoteArtifact, persistIssuedQuoteArtifact, prepareIssuedQuoteArtifact, quoteArtifactDto, quoteArtifactProjectionSql };
