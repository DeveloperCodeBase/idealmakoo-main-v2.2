import {applicationVersion,releaseVersion} from '../src/server/release';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */



import { query, closeDb } from "../src/server/db";
import { config } from "../src/server/config";
import { assertPrivacyReady } from "../src/server/privacy";
import { cleanupStorageReservations } from "../src/server/storage";
import { cleanupContentCollaboration } from "../src/server/content-collaboration";
import { recoverStaleOutbox, claimOutbox, deliverOutbox } from "../src/server/notifications";
import { runScheduledWorkspacePublications } from "../src/server/workspace";
import { enqueueDueActivityReminders, runCrmAutomations } from "../src/server/automation";
import { runPublicationNotificationFanout } from "../src/server/notification-publications";
import { runResourceNotificationFanout } from "../src/server/notification-resources";
import { flushNotificationDigests } from "../src/server/notification-policy";
import { pollVideoJobs } from "../src/server/ai";
import { runCrmTaskReminders } from "../src/server/crm-operations";
import { runCompanyCertificateAlerts } from "../src/server/company-certificates";
import { runCrmCampaigns } from "../src/server/crm-campaigns";
import { runCrmTransfers } from "../src/server/crm-transfers";
import { runKnowledgeIngestion } from "../src/server/knowledge";
import { runOperationalMonitoring } from "../src/server/operations-monitoring";
import { reconcileMediaProcessing, runMediaProcessing } from "../src/server/media-processing";
import { setTimeout as delay } from "node:timers/promises";
let stopping=false;
for (const event of ["SIGTERM", "SIGINT"])
    process.on(event,()=>{stopping=true;});
async function heartbeat(){await query("INSERT INTO worker_heartbeats(name,heartbeat_at,details) VALUES('main',now(),$1::jsonb) ON CONFLICT(name) DO UPDATE SET heartbeat_at=now(),details=EXCLUDED.details",[JSON.stringify({version:releaseVersion(),applicationVersion,state:stopping?'stopping':'running'})]);}
async function main(){
    config();
    await (assertPrivacyReady)();
    await heartbeat();
    const timer=setInterval(()=>{void heartbeat().catch(()=>console.error(JSON.stringify({event:'worker_heartbeat_failed'})));},15000);
    let maintenance=0;
    try {
        while (!stopping) {
            try {
                await (assertPrivacyReady)();
                if (Date.now() - maintenance > 3e4) {
                    maintenance = Date.now();
                    await (cleanupStorageReservations)();
                    await (cleanupContentCollaboration)();
                    await recoverStaleOutbox();
                    await runScheduledWorkspacePublications();
                    await enqueueDueActivityReminders();
                    await runCompanyCertificateAlerts();
                    await (runPublicationNotificationFanout)();
                    await runResourceNotificationFanout();
                    await flushNotificationDigests();
                    await pollVideoJobs();
                    await query('DELETE FROM rate_limits WHERE reset_at<now()-interval \'1 day\'');
                    await query('DELETE FROM auth_challenges WHERE expires_at<now()-interval \'7 days\'');
                    await query('DELETE FROM customer_otp_challenges WHERE expires_at<now()-interval \'24 hours\'');
                    await query('DELETE FROM sessions WHERE expires_at<now()-interval \'30 days\'');
                }
                await runCrmAutomations();
                await (runCrmTaskReminders)();
                await (runCrmCampaigns)();
                await (runCrmTransfers)();
                await (runKnowledgeIngestion)();
                await (runOperationalMonitoring)();
                await (reconcileMediaProcessing)();
                await (runMediaProcessing)();
                const job=await claimOutbox();
                if (job)
                    await deliverOutbox(job);
                else
                    await delay(1000);
            }
            catch (error) {
                console.error(JSON.stringify({event:'worker_tick_failed',code:(error as {code?:string}).code||'JOB_ERROR'}));
                await delay(3000);
            }
        }
    }
    finally {
        clearInterval(timer);
        await closeDb();
    }
}
main().catch(()=>{console.error('Worker initialization failed. Check server configuration.');process.exitCode=1;}).finally(closeDb);
