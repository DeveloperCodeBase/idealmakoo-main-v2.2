import {recordProviderUsage,type ProviderAcceptance} from './provider-usage';
import {bindNotificationTemplate} from './notification-templates';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */
type OutboxRow={id:string;kind:string;payload:Record<string,unknown>;attempts:number;lock_token:string};

import type { Actor } from './types';
import type { NotificationPayload } from './notification-policy';
import type { SendNotificationMail } from './notification-email';
import { transaction, query, audit } from "./db";
import { randomUUID } from "node:crypto";
import { assert, HttpError } from "./types";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config";
import { createConnection } from "node:net";
import { processAiJob } from "./ai";
import { sendEmailNotification } from "./notification-email";
import { sendChannelNotification } from "./notification-providers";
import { prepareNotificationDelivery, completeDigestMembers, completeActivityReminderDelivery, resolveNotificationRecipient } from "./notification-policy";
import { parse } from "./http";
import { z } from "zod";
import { authorizeManualBoundNotification, authorizeManualNotification } from "./crm-audience";
import { encrypt, hash } from "./crypto";
async function claimOutbox():Promise<OutboxRow|null>{return transaction(async client=>{
  const row=(await client.query<OutboxRow>("SELECT * FROM outbox WHERE state='pending' AND available_at<=now() ORDER BY available_at,id FOR UPDATE SKIP LOCKED LIMIT 1")).rows[0];if(!row)return null;const lock=randomUUID();await client.query("UPDATE outbox SET state='running',attempts=attempts+1,locked_at=now(),lock_token=$2 WHERE id=$1",[row.id,lock]);return{...row,attempts:row.attempts+1,lock_token:lock};});}
async function scanAsset(id:string){const row=(await query('SELECT * FROM assets WHERE id=$1 AND deleted_at IS NULL',[id])).rows[0];if(!row||row.scan_status==='clean'||row.scan_status==='blocked')return{provider:'clamav',providerId:id};assert(process.env.CLAMAV_HOST,503,'SCANNER_UNAVAILABLE','Antivirus is not configured. The attachment remains quarantined.');
  assert(/^(public|private)\/[a-f0-9-]+\.[a-z0-9]+$/.test(row.storage_key),422,'STORAGE_KEY','Invalid stored file path.');const bytes=await readFile(join(config().storageDir,row.storage_key));
  const response=await new Promise<string>((resolve,reject)=>{const socket=createConnection({host:process.env.CLAMAV_HOST!,port:Number(process.env.CLAMAV_PORT)||3310});let output='';socket.setTimeout(Math.max(10000,Math.min(300000,Number(process.env.CLAMAV_TIMEOUT_MS)||120000)));socket.on('timeout',()=>{socket.destroy();reject(new Error('SCANNER_TIMEOUT'));});socket.on('error',reject);socket.on('data',chunk=>{output+=chunk.toString();if(output.length>2000){socket.destroy();reject(new Error('SCANNER_PROTOCOL'));}});socket.on('end',()=>resolve(output));socket.on('connect',()=>{socket.write('zINSTREAM\0');for(let offset=0;offset<bytes.length;offset+=65536){const part=bytes.subarray(offset,offset+65536);const size=Buffer.alloc(4);size.writeUInt32BE(part.length);socket.write(size);socket.write(part);}socket.write(Buffer.alloc(4));});});
  const clean=/stream: OK\0?$/.test(response);const blocked=/ FOUND\0?$/.test(response);assert(clean||blocked,502,'SCANNER_FAILED','The scanner did not return a definitive result.');await query('UPDATE assets SET scan_status=$2 WHERE id=$1',[id,clean?'clean':'blocked']);await audit(null,'asset.scanned','asset',id,{clean});return{provider:'clamav',providerId:id};
}
async function providerJson(url:string,body:unknown,headers:Record<string,string>={}){const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok){await response.body?.cancel();throw new HttpError(502,'DELIVERY_REJECTED','The notification provider did not confirm delivery.');}return response.json() as Promise<Record<string,unknown>>;}
async function dispatch(row:OutboxRow, payload:NotificationPayload, marketing:boolean, sendMail?:SendNotificationMail, network?: typeof fetch) : Promise<ProviderAcceptance> {
    if (row.kind === "scan")
        return scanAsset(String(row.payload.assetId));
    if (row.kind === "ai-media") {
        await processAiJob(String(row.payload.jobId));
        return { provider: "openrouter", providerId: String(row.payload.jobId) };
    }
    assert(process.env.NOTIFICATIONS_MODE==='live',503,'NOTIFICATIONS_DISABLED','External notification delivery is disabled.');
    if (row.kind === "email") {
        return sendEmailNotification(row.id,payload,marketing,sendMail);
    }
    if (row.kind === "sms" || row.kind === "telegram" || row.kind === "push")
        return (sendChannelNotification)(row.id, row.kind, payload, marketing, network);
    throw new HttpError(422, "JOB_KIND", "Unsupported job kind.");
}
/** Authorization, policy, inbox insertion and acceptance commit under one lock. */
async function deliverInApp(row:OutboxRow){
    return transaction(async client=>{
        const prepared=await prepareNotificationDelivery(row,new Date(),client);
        if(prepared.action==='handled')return;
        const payload=prepared.payload;
        assert(typeof payload.userId==='string',422,'RECIPIENT','An internal recipient is required.');
        await client.query('INSERT INTO notifications(id,user_id,title,body,href,dedupe_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(dedupe_key) DO NOTHING',[randomUUID(),payload.userId,String(payload.title||''),String(payload.body||''),payload.href||null,'outbox:'+row.id]);
        const changed=await client.query("UPDATE outbox SET state='delivered',completed_at=now(),last_error=NULL WHERE id=$1 AND lock_token=$2 AND state='running' RETURNING id",[row.id,row.lock_token]);
        assert(changed.rowCount===1,409,'DELIVERY_LEASE','The internal delivery lease changed.');
        await client.query("INSERT INTO delivery_events(outbox_id,provider,status) VALUES($1,'in-app','accepted')",[row.id]);
        await completeDigestMembers(client,row.id,'delivered','in-app');
        await completeActivityReminderDelivery(client,row.id,'delivered');
    });
}
async function deliverOutbox(row:OutboxRow,dependencies: {sendMail?:SendNotificationMail;fetch?:typeof fetch} = {}){
    try {
        if(row.kind==='in-app')return await deliverInApp(row);
        const prepared=await prepareNotificationDelivery(row);
        if (prepared.action === "handled")
            return;
        const result = await dispatch(row, prepared.payload, prepared.marketing, dependencies.sendMail, dependencies.fetch);
        await (transaction)(async (client) => {
            const changed=await client.query("UPDATE outbox SET state='delivered',completed_at=now(),last_error=NULL WHERE id=$1 AND lock_token=$2 AND state='running' RETURNING id",[row.id,row.lock_token]);
            if (changed.rowCount) {
                await recordProviderUsage(client,row,prepared.payload,result);
                await client.query('INSERT INTO delivery_events(outbox_id,provider,status,provider_id) VALUES($1,$2,$3,$4)',[row.id,result.provider,'accepted',result.providerId||null]);
                await completeDigestMembers(client,row.id,'delivered',result.provider);
                await (completeActivityReminderDelivery)(client, row.id, "delivered");
            }
        });
    }
    catch (error) {
        const code=error instanceof HttpError?error.code:'DELIVERY_UNCERTAIN';
        const disabled=['NOTIFICATIONS_DISABLED','SMTP_NOT_CONFIGURED','SMS_NOT_CONFIGURED','TELEGRAM_NOT_CONFIGURED','PUSH_NOT_CONFIGURED','NOT_CONFIGURED','DKIM_NOT_CONFIGURED','UNSUBSCRIBE_HTTPS_REQUIRED','NOTIFICATION_POLICY_INVALID'].includes(code);
        const retrySafe=row.kind==='scan'||row.kind==='in-app'||disabled;
        const cancelled=['CONSENT_REVOKED','CONSENT_REQUIRED','RECIPIENT_MISMATCH','RECIPIENT_UNVERIFIED','MARKETING_CHANNEL_UNSUPPORTED','MARKETING_TOPIC','RECIPIENT_CHANNEL_UNAVAILABLE'].includes(code);
        const rejected = ["SMS_REJECTED", "TELEGRAM_REJECTED", "TELEGRAM_CHANNEL_PERMISSION", "PUSH_REJECTED", "MESSAGE_TOO_LONG", "NOTIFICATION_LINK", "RECIPIENT"].includes(code);
        const state = cancelled ? "cancelled" : rejected ? "failed" : retrySafe && row.attempts < 8 ? "pending" : retrySafe ? "failed" : "uncertain";
        const delay=disabled?300:Math.min(3600,2**Math.min(row.attempts,10)*10);
        await (transaction)(async (client) => {
            const changed=await client.query('UPDATE outbox SET state=$3,last_error=$4,available_at=now()+($5*interval \'1 second\'),lock_token=NULL WHERE id=$1 AND lock_token=$2 AND state=\'running\' RETURNING id',[row.id,row.lock_token,state,code,delay]);
            if (!changed.rowCount)
                return;
            await client.query('INSERT INTO delivery_events(outbox_id,provider,status,detail) VALUES($1,$2,$3,$4)',[row.id,row.kind,state,code]);
            if (state !== "pending") {
                await completeDigestMembers(client,row.id,state,row.kind,code);
                await (completeActivityReminderDelivery)(client, row.id, state);
            }
            if (row.kind === "scan" && state === "failed")
                await client.query("UPDATE assets SET scan_status='error' WHERE id=$1 AND scan_status='pending'",[row.payload.assetId]);
        });
    }
}
async function recoverStaleOutbox(){
    await (transaction)(async (client) => {
        const stale=(await client.query<{id:string;kind:string;state:string}>("UPDATE outbox SET state=CASE WHEN kind IN ('scan','in-app') THEN 'pending' ELSE 'uncertain' END,lock_token=NULL,last_error='LEASE_EXPIRED' WHERE state='running' AND locked_at<now()-interval '10 minutes' RETURNING id,kind,state")).rows;
        for (const row of stale) {
            await client.query('INSERT INTO delivery_events(outbox_id,provider,status,detail) VALUES($1,$2,$3,$4)',[row.id,row.kind,row.state,'LEASE_EXPIRED']);
            if (row.state === "uncertain") {
                await completeDigestMembers(client,row.id,'uncertain',row.kind,'LEASE_EXPIRED');
                await (completeActivityReminderDelivery)(client, row.id, "uncertain");
            }
        }
    });
    await query("UPDATE ai_jobs SET status='uncertain',error='Worker lease expired during provider submission.' WHERE status='running' AND updated_at<now()-interval '10 minutes'");
}
async function enqueueNotification(actor:Actor,body:unknown){
    assert(actor.mfaVerified&&['superAdmin','admin','business','support'].includes(actor.role),403,'FORBIDDEN','You cannot create notification deliveries.');
    const input = (parse)(z.object({ channel: z.enum(['email','sms','telegram','push','in-app']), to: z.string().min(1).max(254).optional(), title: z.string().max(200).default('Ideal Makoo'), body: z.string().min(1).max(10000), purpose: z.enum(['transactional','marketing']).default('transactional'), topic: z.enum(['requests','products','research','events','content']).optional(), userId: z.string().min(1).max(100).optional(), recipientId: z.string().uuid().optional(), bindingId: z.string().uuid().optional(), requestId: z.string().max(100).optional(), href: z.string().max(300).optional() }).strict(), body);
    (assert)(!input.href || /^\/(?!\/)/.test(input.href) && !/[\\\x00-\x20\x7f]/.test(input.href) && !/%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/i.test(input.href), 422, "LINK", "Use a safe local link.");
    assert(input.purpose==='marketing'?input.topic!=='requests':!input.topic||input.topic==='requests',422,'NOTIFICATION_TOPIC','Use a topic matching the notification purpose.');
    if (input.channel === "sms" || input.channel === "telegram" || input.channel === "push") {
        (assert)(input.to === void 0, 422, "RECIPIENT", "Select a verified saved channel; arbitrary destinations cannot be submitted.");
        const channel = input.channel, topic = input.topic || (input.purpose === "marketing" ? "products" : "requests");
        const limits = channel === "sms" ? [120, 400] : channel === "telegram" ? [200, 2200] : [100, 300];
        (assert)([...input.title].length <= limits[0] && [...input.body].length <= limits[1], 422, "MESSAGE_TOO_LONG", "Shorten the title or body to the selected channel limit.");
        return (transaction)(async (client) => {
            const authorized = await (authorizeManualBoundNotification)(client, actor, { ...input, topic }), { captureBoundEndpoints, bindingContext } = await import("./communication-channels"), { enqueueBoundNotification } = await import("./binding-notifications");
            let reference = (await captureBoundEndpoints(client, authorized.account.recipientId, [channel], topic))[0];
            if (input.bindingId) {
                const context = await bindingContext(client, input.bindingId);
                (assert)(context && context.row.recipient_id === authorized.account.recipientId && context.row.channel === channel && context.row.endpoint_hash, 404, "RECIPIENT_NOT_FOUND", "The selected verified channel is unavailable.");
                reference = { channel, bindingId: context.row.id, endpointVersion: context.row.endpoint_version, valueHash: context.row.endpoint_hash };
            }
            (assert)(reference, 409, "CONSENT_REQUIRED", "The recipient must verify this channel and enable its topic first.");
            const id2 = await enqueueBoundNotification(client, authorized.account.recipientId, reference, { topic, purpose: input.purpose, title: input.title, body: input.body, href: input.href || "/" + authorized.account.locale + "/", senderId: authorized.senderId, senderRequestId: authorized.senderRequestId, senderLocale: authorized.senderLocale }, "manual:" + randomUUID());
            (assert)(id2, 409, "CONFLICT", "The notification was already queued.");
            await (audit)(authorized.actor.id, "notification.queued", "outbox", id2, { channel, topic, recipientId: authorized.account.recipientId }, client);
            return { id: id2, status: "pending" };
        });
    }
    (assert)(input.recipientId === void 0 && input.bindingId === void 0, 422, "RECIPIENT", "Select an account for email or in-app notifications.");
    const id=randomUUID();
    await (transaction)(async (client) => { const authorized = await (authorizeManualNotification)(client, actor, { ...input, topic: input.topic || (input.purpose === "marketing" ? "products" : "requests") }), endpoint=await resolveNotificationRecipient(input.channel,input,client), payload = (encrypt)(JSON.stringify({ ...input, ...endpoint, senderId: authorized.senderId, senderRequestId: authorized.senderRequestId, senderLocale: authorized.senderLocale, subject: input.title, text: input.body })); await client.query("INSERT INTO outbox(id,kind,payload,dedupe_key,account_id) VALUES($1,$2,$3::jsonb,$4,$5)", [id, input.channel, JSON.stringify({encrypted:payload}), "manual:" + id, input.userId]); if(input.purpose==='transactional')await bindNotificationTemplate(client,id,{key:'transactional_message'}); await (audit)(authorized.actor.id, "notification.queued", "outbox", id, { channel: input.channel, topic: endpoint.topic, recipientHash: hash(endpoint.to) }, client); });
    return { id, status: "pending" };
}
export { claimOutbox, deliverOutbox, enqueueNotification, recoverStaleOutbox };
