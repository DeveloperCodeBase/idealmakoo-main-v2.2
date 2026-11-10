import {safeNotificationLink,publicNotificationImage,notificationHtml} from './notification-format';
/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */
export type MailAcceptance={accepted?:unknown[];messageId?:string};

export type SendNotificationMail=(message:SendMailOptions)=>Promise<MailAcceptance>;

import type { SendMailOptions } from 'nodemailer';
import type { NotificationPayload } from './notification-policy';
import { assert, HttpError } from "./types";
import { createPrivateKey } from "node:crypto";
import { marketingUnsubscribe } from "./notification-policy";
import { config } from "./config";
import nodemailer from "nodemailer";
function notificationDkim(){
  const mode=process.env.SMTP_DKIM_MODE||'off';
  assert(['off','application','gateway'].includes(mode),503,'DKIM_NOT_CONFIGURED','Choose an explicit DKIM signing mode.');
  if(mode!=='application')return undefined;
  const domain=process.env.SMTP_DKIM_DOMAIN||'',selector=process.env.SMTP_DKIM_SELECTOR||'',encoded=process.env.SMTP_DKIM_PRIVATE_KEY_B64||'';
  assert(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(domain)&&/^[a-zA-Z0-9_-]{1,63}$/.test(selector)&&/^[A-Za-z0-9+/=]+$/.test(encoded),503,'DKIM_NOT_CONFIGURED','Configure the DKIM domain, selector and private key.');
  const privateKey=Buffer.from(encoded,'base64');
  try{const key=createPrivateKey(privateKey);assert(key.asymmetricKeyType==='rsa'&&(key.asymmetricKeyDetails?.modulusLength||0)>=2048,503,'DKIM_NOT_CONFIGURED','Use a valid RSA DKIM key of at least 2048 bits.');}
  catch(error){if(error instanceof HttpError)throw error;throw new HttpError(503,'DKIM_NOT_CONFIGURED','The DKIM key is invalid.');}
  const fromDomain=(process.env.SMTP_FROM||'').match(/@([A-Za-z0-9.-]+)>?\s*$/)?.[1]?.toLowerCase();
  assert(fromDomain===domain.toLowerCase(),503,'DKIM_NOT_CONFIGURED','The DKIM domain must match the configured sender domain.');
  return{domainName:domain,keySelector:selector,privateKey,hashAlgo:'sha256' as const,headerFieldNames:'from:to:subject:date:message-id:mime-version:content-type:content-transfer-encoding:list-unsubscribe:list-unsubscribe-post',cacheDir:false as const};
}
async function sendEmailNotification(id:string,payload:NotificationPayload,marketing:boolean,sendMail?:SendNotificationMail){
    assert(process.env.NOTIFICATIONS_MODE==='live',503,'NOTIFICATIONS_DISABLED','External notification delivery is disabled.');
    assert(process.env.SMTP_HOST&&process.env.SMTP_FROM,503,'SMTP_NOT_CONFIGURED','Configure SMTP before sending email.');
    assert(typeof payload.to==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.to),422,'RECIPIENT','A valid recipient is required.');
    const dkim=notificationDkim();
    if (marketing)
        assert(dkim||process.env.SMTP_DKIM_MODE==='gateway',503,'DKIM_NOT_CONFIGURED','Marketing email requires DKIM signing covering both unsubscribe headers.');
    const unsubscribe = marketing ? payload.contactEndpoint ? await (await import("./contact-notifications")).contactMarketingUnsubscribe(id, payload) : await marketingUnsubscribe(id,String(payload.userId||''),payload.to) : void 0;
    assert(!payload.to.endsWith('@identity.invalid'),422,'RECIPIENT','A verified real email address is required.');
    const link=payload.href?safeNotificationLink(payload.href):undefined,image=await publicNotificationImage(payload.imageUrl),title=String(payload.subject||payload.title||'Ideal Makoo'),body=String(payload.text||payload.body||'');
    const message:SendMailOptions={from:process.env.SMTP_FROM,to:payload.to,subject:String(payload.subject||payload.title||'Ideal Makoo').replace(/[\r\n]/g,' ').slice(0,200),html:notificationHtml({title,body,locale:String(payload.locale||'fa'),link,image,unsubscribe}),text:body+(link?'\n\n'+link:'')+(unsubscribe?'\n\n'+unsubscribe.label+': '+unsubscribe.url:''),messageId:`<${id}@${new URL(config().siteUrl).hostname}>`,disableFileAccess:true,disableUrlAccess:true,...(unsubscribe?{headers:unsubscribe.headers}:{}),...(dkim?{dkim}:{})};
    const transport=sendMail?null:nodemailer.createTransport({host:process.env.SMTP_HOST,port:Number(process.env.SMTP_PORT)||587,secure:process.env.SMTP_SECURE==='true',requireTLS:process.env.SMTP_SECURE!=='true',auth:process.env.SMTP_USER?{user:process.env.SMTP_USER,pass:process.env.SMTP_PASSWORD}:undefined,connectionTimeout:20000,socketTimeout:30000,tls:{rejectUnauthorized:true}});
    const result=await(sendMail?sendMail(message):transport!.sendMail(message));
    assert(result.accepted?.length,502,'DELIVERY_REJECTED','The SMTP service did not accept a recipient.');
    return { provider: "smtp", providerId: result.messageId };
}
export { notificationDkim, sendEmailNotification };
