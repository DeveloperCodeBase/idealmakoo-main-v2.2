/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { query, closeDb } from "../src/server/db";
import { recordRecoveryEvidence } from "../src/server/operations-monitoring";
async function main() {
    if (process.env.MIGRATION_DATABASE_URL)
        process.env.DATABASE_URL = process.env.MIGRATION_DATABASE_URL;
    let bytes = Buffer.alloc(0);
    for await (const value of process.stdin) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        if (bytes.length + chunk.length > 16384)
            throw new Error("RECOVERY_EVIDENCE_SIZE");
        bytes = Buffer.concat([bytes, chunk]);
    }
    const available = (await (query)("SELECT to_regclass('ops_recovery_evidence') IS NOT NULL AS available")).rows[0]?.available;
    if (!available) {
        console.log(JSON.stringify({ recorded: false, reason: "MONITORING_SCHEMA_UNAVAILABLE" }));
        return;
    }
    const allowed = (await (query)("SELECT has_table_privilege(current_user,to_regclass('schema_migrations'),'SELECT') AND has_table_privilege(current_user,to_regclass('ops_recovery_evidence'),'INSERT') AS allowed")).rows[0]?.allowed;
    if (!allowed)
        throw new Error("RECOVERY_OPERATOR_ROLE_REQUIRED");
    const result = await (recordRecoveryEvidence)(JSON.parse(bytes.toString("utf8")));
    console.log(JSON.stringify({ recorded: true, ...result }));
}
main().catch(error => { console.error(JSON.stringify({ recorded: false, code: typeof error?.code === "string" && /^[A-Z0-9_]{3,80}$/.test(error.code) ? error.code : "RECOVERY_EVIDENCE_FAILED" })); process.exitCode = 1; }).finally(closeDb);
