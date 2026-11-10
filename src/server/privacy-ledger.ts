
export type PrivacySubject = z.infer<typeof privacySubjectSchema>;
type LedgerIdentity = z.infer<typeof identitySchema>;
export type PrivacyEntryBody = z.infer<typeof entryBodySchema>;
export type PrivacyEntry = z.infer<typeof entrySchema>;
export type PrivacyHead = { format: 1; fingerprint: string; sequence: number; hash: string };
export type PrivacyLedger = { readonly entries: readonly PrivacyEntry[]; readonly head: PrivacyHead };
export type PrivacyErasureInput = Pick<PrivacyEntryBody, 'subject' | 'requestId' | 'actorId' | 'approverId'>;
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { z } from "zod";
import { createHash, createPrivateKey, createPublicKey, verify, generateKeyPairSync, sign } from "node:crypto";
import { assert, HttpError } from "./types";
import { isAbsolute, resolve, join } from "node:path";
import { mkdir, lstat, realpath, open, readdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
const EMPTY_LEDGER_HASH = "0".repeat(64);
const privacySubjectSchema = z.object({ type: z.enum(["user", "crm-contact"]), id: z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/) }).strict();
const digest = (value: string | Buffer) => (createHash)("sha256").update(value).digest("hex");
const identitySchema = z.object({ format: z.literal(1), publicKey: z.string().min(30).max(1e3), privateKey: z.string().min(30).max(1e3), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const entryBodySchema = z.object({ format: z.literal(1), sequence: z.number().int().positive(), previousHash: z.string().regex(/^[a-f0-9]{64}$/), at: z.string().datetime(), subject: privacySubjectSchema, requestId: z.string().uuid(), scope: z.literal("structured-subject-erasure"), actorId: z.string().min(1).max(160), approverId: z.string().min(1).max(160) }).strict();
const entrySchema = entryBodySchema.extend({ hash: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).max(128) }).strict();
let verifiedCache: {path: string; stamp: string; ledger: PrivacyLedger} | undefined;
function privacyLedgerDirectory() { const value = process.env.PRIVACY_LEDGER_DIR; (assert)(value && (isAbsolute)(value), 503, "PRIVACY_LEDGER_UNAVAILABLE", "Configure a separate durable absolute PRIVACY_LEDGER_DIR before erasure or recovery."); const path = (resolve)(value), storage = (resolve)(process.env.STORAGE_DIR || (join)(process.cwd(), "storage")); (assert)(path !== storage && !path.startsWith(storage + "/"), 503, "PRIVACY_LEDGER_LOCATION", "The erasure ledger must be outside normal application storage."); return path; }
async function directory(create = false) {
    const path = privacyLedgerDirectory();
    if (create)
        await (mkdir)(path, { recursive: true, mode: 448 });
    const stat = await (lstat)(path);
    (assert)(stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 63) === 0, 503, "PRIVACY_LEDGER_PERMISSIONS", "Use a private real directory with mode 700 for the erasure ledger.");
    (assert)(await (realpath)(path) === path, 503, "PRIVACY_LEDGER_LOCATION", "The erasure ledger directory must not traverse symlinks.");
    return path;
}
async function privateFile(path: string, max: number) {
    const handle = await (open)(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = await handle.stat();
        (assert)(stat.isFile() && stat.nlink === 1 && (stat.mode & 63) === 0 && stat.size <= max, 503, "PRIVACY_LEDGER_FILE", "Ledger files must be bounded private regular files without links.");
        return await handle.readFile("utf8");
    }
    finally {
        await handle.close();
    }
}
async function identityAt(path: string): Promise<LedgerIdentity> { const parsed = identitySchema.safeParse(JSON.parse(await privateFile((join)(path, "identity.json"), 8192))); (assert)(parsed.success, 503, "PRIVACY_LEDGER_IDENTITY", "The erasure ledger identity is invalid."); const identity = parsed.data; const privateKey = (createPrivateKey)({ key: Buffer.from(identity.privateKey, "base64"), format: "der", type: "pkcs8" }), publicKey = (createPublicKey)({ key: Buffer.from(identity.publicKey, "base64"), format: "der", type: "spki" }); (assert)(privateKey.asymmetricKeyType === "ed25519" && publicKey.asymmetricKeyType === "ed25519", 503, "PRIVACY_LEDGER_IDENTITY", "The ledger requires an Ed25519 identity."); (assert)((createPublicKey)(privateKey).export({ format: "der", type: "spki" }).equals(Buffer.from(identity.publicKey, "base64")) && digest(Buffer.from(identity.publicKey, "base64")) === identity.fingerprint, 503, "PRIVACY_LEDGER_IDENTITY", "The ledger key pair does not match its fingerprint."); return identity; }
function bodyOf(entry: PrivacyEntry) { const { hash: _hash, signature: _signature, ...body } = entry; return entryBodySchema.parse(body); }
function verifyEntries(journal: string, identity: LedgerIdentity): PrivacyLedger {
    (assert)(!journal || journal.endsWith("\n"), 503, "PRIVACY_LEDGER_TRUNCATED", "The external erasure ledger has a partial entry; recovery is blocked.");
    const entries: PrivacyEntry[] = [], subjects = new Set<string>(), publicKey = (createPublicKey)({ key: Buffer.from(identity.publicKey, "base64"), format: "der", type: "spki" });
    let previous = EMPTY_LEDGER_HASH;
    for (const line of journal.split("\n").filter(Boolean)) {
        (assert)(line.length <= 8192, 503, "PRIVACY_LEDGER_ENTRY", "A ledger entry is oversized.");
        const parsed = entrySchema.safeParse(JSON.parse(line));
        (assert)(parsed.success, 503, "PRIVACY_LEDGER_ENTRY", "An external erasure entry is invalid.");
        const entry = parsed.data, serialized = JSON.stringify(bodyOf(entry));
        (assert)(entry.sequence === entries.length + 1 && entry.previousHash === previous && entry.hash === digest(serialized) && (verify)(null, Buffer.from(entry.hash, "hex"), publicKey, Buffer.from(entry.signature, "base64")), 503, "PRIVACY_LEDGER_SIGNATURE", "The external erasure chain failed integrity verification.");
        const subject = entry.subject.type + ":" + entry.subject.id;
        (assert)(!subjects.has(subject), 503, "PRIVACY_LEDGER_DUPLICATE", "The ledger contains conflicting repeated subject erasures.");
        subjects.add(subject);
        entries.push(entry);
        previous = entry.hash;
    }
    return { entries, head: { format: 1, fingerprint: identity.fingerprint, sequence: entries.length, hash: previous } };
}
async function fileStamp(path: string) { const files = await Promise.all(["identity.json", "erasures.jsonl"].map(name => (lstat)((join)(path, name), { bigint: true }))); return files.map(stat => [stat.dev, stat.ino, stat.mode, stat.uid, stat.gid, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(":")).join("|"); }
async function readPrivacyLedger(): Promise<PrivacyLedger> {
    try {
        const path = await directory(), stamp = await fileStamp(path);
        if (verifiedCache?.path === path && verifiedCache.stamp === stamp)
            return verifiedCache.ledger;
        const identity = await identityAt(path), ledger = verifyEntries(await privateFile((join)(path, "erasures.jsonl"), 32 * 1024 * 1024), identity);
        (assert)(await fileStamp(path) === stamp, 503, "PRIVACY_LEDGER_CHANGED", "The external ledger changed during verification; retry after the erasure transaction completes.");
        for (const entry of ledger.entries) {
            Object.freeze(entry.subject);
            Object.freeze(entry);
        }
        Object.freeze(ledger.entries);
        Object.freeze(ledger.head);
        Object.freeze(ledger);
        verifiedCache = { path, stamp, ledger };
        return ledger;
    }
    catch (error) {
        verifiedCache = void 0;
        if ((error as NodeJS.ErrnoException).code === "ENOENT")
            (assert)(false, 503, "PRIVACY_LEDGER_MISSING", "The external erasure ledger is missing. Restore its latest independent copy; do not initialize a replacement.");
        if (error instanceof HttpError)
            throw error;
        throw new HttpError(503, "PRIVACY_LEDGER_INVALID", "The external erasure ledger cannot be verified. Restore its latest independently verified copy before continuing.");
    }
}
async function initializePrivacyLedgerFiles() {
    const path = await directory(true), existing = await (readdir)(path);
    if (existing.length) {
        (assert)(existing.includes("identity.json") && existing.includes("erasures.jsonl"), 503, "PRIVACY_LEDGER_PARTIAL", "A partial ledger initialization requires operator review.");
        return readPrivacyLedger();
    }
    const pair = (generateKeyPairSync)("ed25519"), publicKey = pair.publicKey.export({ format: "der", type: "spki" }), identity = { format: 1, publicKey: publicKey.toString("base64"), privateKey: pair.privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"), fingerprint: digest(publicKey) };
    for (const [name, contents] of [["identity.json", JSON.stringify(identity) + "\n"], ["erasures.jsonl", ""]]) {
        const file = await (open)((join)(path, name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 384);
        try {
            await file.writeFile(contents);
            await file.sync();
        }
        finally {
            await file.close();
        }
    }
    const dir = await (open)(path, constants.O_RDONLY | constants.O_DIRECTORY);
    try {
        await dir.sync();
    }
    finally {
        await dir.close();
    }
    return readPrivacyLedger();
}
function assertLedgerContains(ledger: PrivacyLedger, anchor: PrivacyHead) { (assert)(anchor.format === 1 && anchor.fingerprint === ledger.head.fingerprint && Number.isSafeInteger(anchor.sequence) && anchor.sequence >= 0 && anchor.sequence <= ledger.head.sequence, 503, "PRIVACY_LEDGER_ROLLBACK", "The current external ledger does not contain the required backup/database identity and sequence."); const expected = anchor.sequence ? ledger.entries[anchor.sequence - 1].hash : EMPTY_LEDGER_HASH; (assert)(expected === anchor.hash, 503, "PRIVACY_LEDGER_ROLLBACK", "The current external ledger does not contain the required backup/database chain head."); }
async function appendPrivacyErasure(ledger: PrivacyLedger, input: PrivacyErasureInput) {
    const current = await readPrivacyLedger();
    assertLedgerContains(current, ledger.head);
    (assert)(current.head.sequence === ledger.head.sequence, 409, "PRIVACY_LEDGER_CHANGED", "Another erasure advanced the ledger; retry the approved request.");
    const existing = current.entries.find(entry2 => entry2.subject.type === input.subject.type && entry2.subject.id === input.subject.id);
    if (existing)
        return existing;
    const path = await directory(), identity = await identityAt(path), body = entryBodySchema.parse({ format: 1, sequence: current.head.sequence + 1, previousHash: current.head.hash, at: new Date().toISOString(), ...input, scope: "structured-subject-erasure" }), hash = digest(JSON.stringify(body));
    const key = (createPrivateKey)({ key: Buffer.from(identity.privateKey, "base64"), format: "der", type: "pkcs8" }), entry = { ...body, hash, signature: (sign)(null, Buffer.from(hash, "hex"), key).toString("base64") };
    const encoded = JSON.stringify(entry) + "\n", file = await (open)((join)(path, "erasures.jsonl"), constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
    try {
        const stat = await file.stat();
        (assert)(stat.isFile() && stat.nlink === 1 && (stat.mode & 63) === 0, 503, "PRIVACY_LEDGER_PERMISSIONS", "Invalid ledger file permissions.");
        (assert)(stat.size + Buffer.byteLength(encoded) <= 32 * 1024 * 1024, 503, "PRIVACY_LEDGER_CAPACITY", "The ledger reached its reviewed online size; arrange a validated archival upgrade before more erasures.");
        await file.writeFile(encoded);
        await file.sync();
    }
    finally {
        await file.close();
    }
    return entry;
}
async function readPrivacyAnchor(path: string) { const input = JSON.parse(await (readFile)(path, "utf8")); const parsed = z.object({ format: z.literal(1), fingerprint: z.string().regex(/^[a-f0-9]{64}$/), sequence: z.number().int().nonnegative(), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().safeParse(input); (assert)(parsed.success, 503, "PRIVACY_BACKUP_ANCHOR", "The backup privacy anchor is invalid."); return parsed.data; }
export { EMPTY_LEDGER_HASH, appendPrivacyErasure, assertLedgerContains, initializePrivacyLedgerFiles, privacyLedgerDirectory, privacySubjectSchema, readPrivacyAnchor, readPrivacyLedger };
