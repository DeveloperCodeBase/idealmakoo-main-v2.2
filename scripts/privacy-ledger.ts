/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { initializePrivacyLedger, privacyLedgerStatus, assertPrivacyReady, reconcilePrivacyLedger } from "../src/server/privacy";
import { readFile } from "node:fs/promises";
import { readPrivacyAnchor, readPrivacyLedger, assertLedgerContains } from "../src/server/privacy-ledger";
import { closeDb } from "../src/server/db";
const args = process.argv.slice(2), command = args.shift();
async function main() {
    if (process.env.PRIVACY_RESTORE_DATABASE) {
        if (!/^idealmakoo_drill_[a-z0-9_]+$/.test(process.env.PRIVACY_RESTORE_DATABASE))
            throw new Error("Database override is restricted to this restore script\u2019s isolated drill database names.");
        const url = new URL(process.env.DATABASE_URL || "");
        url.pathname = "/" + process.env.PRIVACY_RESTORE_DATABASE;
        process.env.DATABASE_URL = url.toString();
    }
    if (command === "initialize") {
        if (args.some(value => value !== "--adopt-existing"))
            throw new Error("Use initialize [--adopt-existing].");
        process.stdout.write(JSON.stringify(await (initializePrivacyLedger)(args.includes("--adopt-existing"))) + "\n");
    }
    else if (command === "status" || command === "head") {
        if (args.length)
            throw new Error("status and head take no arguments.");
        const status = await (privacyLedgerStatus)();
        if (command === "head") {
            if (!status.ready)
                throw new Error("Reconcile the current erasure ledger before taking a normal backup.");
            process.stdout.write(JSON.stringify({ format: status.format, fingerprint: status.fingerprint, sequence: status.sequence, hash: status.hash }) + "\n");
        }
        else
            process.stdout.write(JSON.stringify(status) + "\n");
    }
    else if (command === "ready") {
        if (args.length)
            throw new Error("ready takes no arguments.");
        await (assertPrivacyReady)();
    }
    else if (command === "replay" || command === "verify-anchor") {
        if (args.length !== 0 && !(args.length === 2 && args[0] === "--anchor"))
            throw new Error("Use replay [--anchor file|-].");
        let anchor;
        if (args[1] === "-") {
            const input = JSON.parse(await (readFile)("/dev/stdin", "utf8"));
            if (!input || input.format !== 1 || typeof input.fingerprint !== "string" || !Number.isSafeInteger(input.sequence) || typeof input.hash !== "string")
                throw new Error("Invalid privacy anchor.");
            anchor = input;
        }
        else if (args[1])
            anchor = await (readPrivacyAnchor)(args[1]);
        if (command === "verify-anchor") {
            if (!anchor)
                throw new Error("A required backup anchor was not supplied.");
            const ledger = await (readPrivacyLedger)();
            (assertLedgerContains)(ledger, anchor);
            process.stdout.write(JSON.stringify(ledger.head) + "\n");
        }
        else
            process.stdout.write(JSON.stringify(await (reconcilePrivacyLedger)(anchor)) + "\n");
    }
    else
        throw new Error("Usage: node --import tsx scripts/privacy-ledger.ts initialize [--adopt-existing] | status | head | ready | replay [--anchor file|-] | verify-anchor --anchor file|-");
}
async function run() {
    try {
        await main();
    }
    catch (error) {
        process.stderr.write(JSON.stringify({ event: "privacy_ledger_failed", code: (error as {code?:string}).code || "PRIVACY_OPERATION_FAILED", message: error instanceof Error ? error.message : "Privacy operation failed" }) + "\n");
        process.exitCode = 1;
    }
    finally {
        await (closeDb)();
    }
}
void run();
