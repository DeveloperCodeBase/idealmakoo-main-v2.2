/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */



import { query, closeDb } from "../src/server/db";
query("SELECT 1 FROM worker_heartbeats WHERE name='main' AND heartbeat_at>now()-interval '60 seconds'").then(result=>{if(!result.rowCount)process.exitCode=1;}).catch(()=>{process.exitCode=1;}).finally(closeDb);
