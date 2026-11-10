import type { Actor } from './types';
import type { PoolClient } from 'pg';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { assert } from "./types";
import { randomUUID } from "node:crypto";
import { transaction } from "./db";
async function reserveAi(actor: Actor | null, visitor: string, mode: string, model: string, reserve: string, providerName = process.env.AI_PROVIDER === "google" ? "google" : "openrouter", client?: PoolClient) {
    (assert)(/^\d+(?:\.\d{1,6})?$/.test(reserve) && Number(reserve) > 0, 503, "AI_BUDGET_CONFIG", "Configure a positive maximum request reservation.");
    const daily = process.env.AI_DAILY_BUDGET_USD || "5", monthly = process.env.AI_MONTHLY_BUDGET_USD || "100";
    (assert)(/^\d+(?:\.\d{1,6})?$/.test(daily) && /^\d+(?:\.\d{1,6})?$/.test(monthly), 503, "AI_BUDGET_CONFIG", "AI budgets must use decimal USD values.");
    const run = async (connection: PoolClient) => {
        await connection.query("SELECT pg_advisory_xact_lock(917264832)");
        const usage = (await connection.query(`SELECT COALESCE(sum(COALESCE(actual_usd,reserved_usd)) FILTER(WHERE created_at>=date_trunc('day',now())),0)::text AS daily,
      COALESCE(sum(COALESCE(actual_usd,reserved_usd)),0)::text AS monthly FROM ai_usage WHERE created_at>=date_trunc('month',now()) AND state IN ('reserved','complete','uncertain')`)).rows[0];
        const allowed = (await connection.query("SELECT ($1::numeric+$2::numeric<=$3::numeric AND $4::numeric+$2::numeric<=$5::numeric) AS ok", [usage.daily, reserve, daily, usage.monthly, monthly])).rows[0].ok;
        (assert)(allowed, 429, "QUOTA", "The configured AI budget has been reserved or used.");
        const id = (randomUUID)();
        await connection.query("INSERT INTO ai_usage(id,actor_id,visitor_hash,mode,provider,model,state,reserved_usd) VALUES($1,$2,$3,$4,$5,$6,'reserved',$7)", [id, actor?.id || null, visitor, mode, providerName, model, reserve]);
        return id;
    };
    return client ? run(client) : (transaction)(run);
}
export { reserveAi };
