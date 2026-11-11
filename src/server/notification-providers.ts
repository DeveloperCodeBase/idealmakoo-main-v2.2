import {fitNotificationMessage,smsMeasure,publicNotificationImage} from './notification-format';
import type {ProviderAcceptance} from './provider-usage';
import type {NotificationPayload} from './notification-policy';
import type {BindingReference} from './communication-channels';
interface ChannelProviderResponse {ok?:unknown;return?:{status?:unknown};entries?:Array<{messageid?:unknown;message?:unknown;cost?:unknown}>;result?:{message_id?:unknown;chat?:{id?:unknown};type?:unknown;id?:unknown;status?:unknown;can_post_messages?:unknown;user?:{is_bot?:unknown;id?:unknown}};Entries?:{tokens?:Array<{token?:string;status?:unknown}>;request_id?:unknown}}

/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

import { assert, HttpError } from "./types";
import { config } from "./config";
import { transaction } from "./db";
import { bindingContext, bindingPreferenceToken } from "./communication-channels";
import { filteredFetch } from "./selective-proxy";
async function boundedJson(response: Response) : Promise<ChannelProviderResponse> {
    (assert)(response.body, 502, "DELIVERY_UNCERTAIN", "The provider response has no body.");
    const reader = response.body.getReader(), buffers = [];
    let bytes = 0;
    while (true) {
        const part = await reader.read();
        if (part.done)
            break;
        bytes += part.value.byteLength;
        if (bytes > 65536) {
            await reader.cancel();
            throw new HttpError(502, "DELIVERY_UNCERTAIN", "The provider response exceeds the safe size.");
        }
        buffers.push(part.value);
    }
    try {
        const value = JSON.parse(Buffer.concat(buffers).toString("utf8"));
        (assert)(value && typeof value === "object" && !Array.isArray(value), 502, "DELIVERY_UNCERTAIN", "The provider response is invalid.");
        return value;
    }
    catch (error) {
        if (error instanceof HttpError)
            throw error;
        throw new HttpError(502, "DELIVERY_UNCERTAIN", "The provider response is invalid.");
    }
}
function localLink(value: unknown) { const path = String(value || "/"); (assert)(/^\/(?!\/)/.test(path) && !/[\\\x00-\x20\x7f]/.test(path) && !/%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/i.test(path), 422, "NOTIFICATION_LINK", "Use a safe local message link."); return (config)().siteUrl + path; }
async function preferenceLink(id: string, payload: NotificationPayload) { const ref = payload.channelBinding as BindingReference | undefined; (assert)(ref?.bindingId, 409, "RECIPIENT_UNVERIFIED", "Marketing requires a verified channel."); return (transaction)(async (client) => { const context = await (bindingContext)(client, ref.bindingId); (assert)(context?.available && context.row.verified_at && context.row.endpoint_version === ref.endpointVersion && context.row.endpoint_hash === ref.valueHash && context.to === payload.to, 409, "RECIPIENT_MISMATCH", "The channel changed before sending."); const raw = await (bindingPreferenceToken)(client, context, "preferences", id); return `${(config)().siteUrl}/${context.recipient.locale}/communication-preferences/${raw}/`; }); }
async function sendChannelNotification(id: string, channel: string, payload: NotificationPayload, marketing: boolean, network = filteredFetch) : Promise<ProviderAcceptance> {
    (assert)(process.env.NOTIFICATIONS_MODE === "live", 503, "NOTIFICATIONS_DISABLED", "External notification delivery is disabled.");
    const preferenceUrl = marketing ? await preferenceLink(id, payload) : null;
    const title = String(payload.title || "Ideal Makoo"), body = String(payload.body || ""), href = payload.href ? payload.purpose === "channel-verification" ? String(payload.href) : localLink(payload.href) : "";
    let message = [title, body, href, preferenceUrl].filter(Boolean).join("\n");
    if (channel === "sms") {
        (assert)(process.env.KAVENEGAR_API_KEY, 503, "SMS_NOT_CONFIGURED", "Configure Kavenegar first.");
        const to = String(payload.to || "");
        (assert)(/^\+[1-9]\d{9,14}$/.test(to), 422, "RECIPIENT", "Use an international telephone number.");
        const otp = payload.otp === true, template = process.env.KAVENEGAR_OTP_TEMPLATE || "";
        if (otp)
            (assert)(/^[A-Za-z0-9_-]{1,100}$/.test(template) && /^\d{6}$/.test(String(payload.code)), 503, "SMS_NOT_CONFIGURED", "Configure the approved OTP template.");
        else
            (assert)(process.env.KAVENEGAR_SENDER, 503, "SMS_NOT_CONFIGURED", "Configure the Kavenegar sender.");
        if(!otp){const max=Math.max(1,Math.min(10,Number(process.env.SMS_MAX_SEGMENTS)||6));message=fitNotificationMessage(title,body,[href,preferenceUrl||""],max,value=>smsMeasure(value).segments);}
        (assert)(otp || [...message].length <= 2e3, 422, "MESSAGE_TOO_LONG", "The SMS exceeds the channel limit.");
        const form2 = new URLSearchParams(otp ? { receptor: to.replace(/^\+/, "00"), template, token: String(payload.code), type: "sms" } : { receptor: to.replace(/^\+/, "00"), sender: process.env.KAVENEGAR_SENDER!, message });
        const response2 = await network(`https://api.kavenegar.com/v1/${encodeURIComponent(process.env.KAVENEGAR_API_KEY)}/${otp ? "verify/lookup" : "sms/send"}.json`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form2, redirect: "error", signal: AbortSignal.timeout(3e4) }), data2 = await boundedJson(response2), returned = data2.return;
        if (typeof returned?.status === "number" && returned.status !== 200)
            throw new HttpError(502, "SMS_REJECTED", "Kavenegar rejected the recipient.");
        const entries2 = data2.entries, entry = Array.isArray(entries2) ? entries2[0] : void 0;
        (assert)(response2.ok && returned?.status === 200 && entry && (typeof entry.messageid === "number" && Number.isSafeInteger(entry.messageid) && entry.messageid > 0 || typeof entry.messageid === "string" && /^\d+$/.test(entry.messageid)), 502, "DELIVERY_UNCERTAIN", "Kavenegar did not confirm recipient acceptance.");
        const units=typeof entry.message==='string'?smsMeasure(entry.message).segments:otp?null:smsMeasure(message).segments;
        const actualCost=typeof entry.cost==='number'&&Number.isFinite(entry.cost)&&entry.cost>=0?entry.cost:null;
        const tariff=Number(process.env.SMS_ESTIMATED_SEGMENT_COST_IRR||NaN);
        return {provider:'kavenegar',providerId:String(entry.messageid),usage:{units,currency:'IRR',actualCost,estimatedCost:units&&Number.isFinite(tariff)&&tariff>=0?units*tariff:null}};
    }
    if (channel === "telegram") {
        (assert)(process.env.TELEGRAM_BOT_TOKEN, 503, "TELEGRAM_NOT_CONFIGURED", "Configure the Telegram bot first.");
        const to = String(payload.to || "");
        (assert)(/^[1-9]\d{0,15}$/.test(to) || payload.publicTelegramChannel === true && /^-[1-9]\d{0,18}$/.test(to), 422, "RECIPIENT", "A verified private Telegram conversation is required.");
        const photo=await publicNotificationImage(payload.imageUrl);
        message=fitNotificationMessage(title,body,[href,preferenceUrl||''],photo?1024:4096,value=>value.length);
        (assert)(message.length >= 1 && message.length <= (photo?1024:4096), 422, "MESSAGE_TOO_LONG", "The Telegram message exceeds the channel limit.");
        if (payload.publicTelegramChannel === true) {
            const botId = process.env.TELEGRAM_BOT_TOKEN.split(":")[0];
            (assert)(/^[1-9]\d{0,15}$/.test(botId), 503, "TELEGRAM_NOT_CONFIGURED", "Configure a valid Telegram bot token.");
            const endpoint = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/`, options: RequestInit = { redirect: "error", signal: AbortSignal.timeout(3e4) };
            const chatResponse = await network(endpoint + "getChat?" + new URLSearchParams({ chat_id: to }), options), chat = await boundedJson(chatResponse), chatResult = chat.result;
            (assert)(chatResponse.ok && chat.ok === true && chatResult?.type === "channel" && String(chatResult.id) === to, 409, "TELEGRAM_CHANNEL_PERMISSION", "The configured destination is not an available official channel.");
            const memberResponse = await network(endpoint + "getChatMember?" + new URLSearchParams({ chat_id: to, user_id: botId }), options), member = await boundedJson(memberResponse), result3 = member.result;
            (assert)(memberResponse.ok && member.ok === true && result3?.status === "administrator" && result3.can_post_messages === true && result3.user?.is_bot === true && String(result3.user.id) === botId, 409, "TELEGRAM_CHANNEL_PERMISSION", "The bot lacks current permission to publish in this channel.");
        }
        const response2 = await network(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${photo?"sendPhoto":"sendMessage"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({chat_id:to,...photo?{photo,caption:message}:{text:message,link_preview_options:{is_disabled:true}},...href?{reply_markup:{inline_keyboard:[[{text:({fa:'مشاهده محتوا',ar:'عرض المحتوى',tr:'İçeriği görüntüle',ru:'Открыть'} as Record<string,string>)[String(payload.locale)]||'View content',url:href}]]}}:{}}), redirect: "error", signal: AbortSignal.timeout(3e4) }), data2 = await boundedJson(response2);
        if (data2.ok === false)
            throw new HttpError(502, "TELEGRAM_REJECTED", "Telegram rejected the message.");
        const result2 = data2.result;
        (assert)(response2.ok && data2.ok === true && Number.isSafeInteger(result2?.message_id) && String(result2?.chat?.id) === to, 502, "DELIVERY_UNCERTAIN", "Telegram did not confirm acceptance for this conversation.");
        return {provider:'telegram',providerId:String(result2!.message_id),usage:{units:1,currency:null,actualCost:null,estimatedCost:null}};
    }
    (assert)(process.env.NAJVA_API_KEY && !/[\r\n]/.test(process.env.NAJVA_API_KEY), 503, "PUSH_NOT_CONFIGURED", "Configure the Najva API key.");
    (assert)(/^[1-9]\d{0,14}$/.test(process.env.NAJVA_WEBSITE_ID || ""), 503, "PUSH_NOT_CONFIGURED", "Configure the Najva website ID.");
    (assert)(!process.env.NAJVA_API_URL || process.env.NAJVA_API_URL === "https://push.najva.com/v1/send/token/", 503, "PUSH_NOT_CONFIGURED", "Use the documented Najva token dispatch endpoint.");
    const token = String(payload.to || "");
    (assert)(/^[a-f0-9-]{36}$/i.test(token), 422, "RECIPIENT", "A verified Najva device token is required.");
    (assert)(title.length <= 200 && body.length <= 1e3, 422, "MESSAGE_TOO_LONG", "The push message exceeds the channel limit.");
    const click = preferenceUrl || href || (config)().siteUrl + "/";
    (assert)(new URL(click).origin === (config)().siteUrl, 422, "NOTIFICATION_LINK", "The notification must open this site.");
    const form = new FormData;
    form.set("website_id", process.env.NAJVA_WEBSITE_ID!);
    form.append("tokens[]", token);
    form.set("message.title", title);
    form.set("message.body", body);
    form.set("message.notification_click.click_url", click);
    form.set("ttl", payload.purpose === "channel-verification" ? "1" : "24");
    const response = await network("https://push.najva.com/v1/send/token/", { method: "POST", headers: {apiKey: process.env.NAJVA_API_KEY}, body: form, redirect: "error", signal: AbortSignal.timeout(3e4) }), data = await boundedJson(response), entries = data.Entries, result = entries?.tokens?.find(item => item.token?.toLowerCase() === token.toLowerCase());
    if (result?.status === "InvalidToken")
        throw new HttpError(502, "PUSH_REJECTED", "Najva rejected the device token.");
    (assert)(response.ok && result?.status === "Scheduled" && typeof entries?.request_id === "string" && entries.request_id.length > 0, 502, "DELIVERY_UNCERTAIN", "Najva did not confirm acceptance for this device.");
    return { provider: "najva", providerId: entries.request_id };
}
export { sendChannelNotification };
