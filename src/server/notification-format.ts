import {assert} from './types';
import {config} from './config';
import {query} from './db';
import {assetUsageAllowed} from './asset-usage';
const gsm=new Set([..."@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ ÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"]);
const extended=new Set([...'^{}\\[~]|€\f']);
/** GSM extension characters use two septets; non-GSM content uses UTF-16 units.
 * Segment count is an estimate. A provider's billed amount remains authoritative. */
export function smsMeasure(text:string){
  const ascii=[...text].every(char=>gsm.has(char)||extended.has(char));
  const units=ascii?[...text].reduce((sum,char)=>sum+(extended.has(char)?2:1),0):text.length;
  const single=ascii?160:70,concatenated=ascii?153:67;
  return {encoding:ascii?'GSM-7':'UCS-2',units,segments:units<=single?1:Math.ceil(units/concatenated)};
}
export function fitNotificationMessage(title:string,body:string,links:string[],limit:number,measure:(value:string)=>number=value=>[...value].length){
  const suffix=links.filter(Boolean).join('\n'),heading=[...title].slice(0,160).join('');
  let content=[heading,body].filter(Boolean).join('\n');
  const assemble=()=>[content,suffix].filter(Boolean).join('\n');
  assert(measure(suffix)<=limit,422,'MESSAGE_TOO_LONG','The mandatory message links exceed the channel limit.');
  if(measure(assemble())>limit){
    const chars=[...content];let low=0,high=chars.length;
    while(low<high){const mid=Math.ceil((low+high)/2),candidate=[chars.slice(0,mid).join('')+'…',suffix].filter(Boolean).join('\n');if(measure(candidate)<=limit)low=mid;else high=mid-1;}
    content=low?chars.slice(0,low).join('')+'…':'';
  }
  assert(measure(assemble())<=limit,422,'MESSAGE_TOO_LONG','The message exceeds the channel limit.');return assemble();
}
export function safeNotificationLink(value:unknown){
  const path=String(value||'/');assert(/^\/(?!\/)/.test(path)&&!/[\\\x00-\x20\x7f]/.test(path)&&!/%(?:0[0-9a-f]|1[0-9a-f]|5c|7f)/i.test(path),422,'NOTIFICATION_LINK','Use a safe local link.');
  return config().siteUrl+path;
}
export async function publicNotificationImage(value:unknown):Promise<string|undefined>{
  if(typeof value!=='string'||!value)return undefined;
  let path=value;
  if(/^https?:/.test(value)){const url=new URL(value);if(url.origin!==config().siteUrl)return undefined;path=url.pathname;}
  if(/[?#\\\x00-\x20\x7f]/.test(path)||path.includes('..'))return undefined;
  if(/^\/media\/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp)$/i.test(path))return safeNotificationLink(path);
  const asset=/^\/api\/v1\/media\/([a-f0-9-]{36})\/content\/?$/.exec(path);
  if(asset&&(await query("SELECT 1 FROM assets WHERE id=$1 AND visibility='public' AND deleted_at IS NULL AND scan_status='clean' AND mime_type IN ('image/jpeg','image/png','image/webp')",[asset[1]])).rowCount&&await assetUsageAllowed(asset[1]))return safeNotificationLink(path);
  return undefined;
}
export const escapeMail=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
export function notificationHtml(input:{title:string;body:string;locale:string;link?:string;image?:string;unsubscribe?:{url:string;label:string}}){
  const rtl=['fa','ar'].includes(input.locale),button=({fa:'مشاهده در وب‌سایت',en:'View on the website',tr:'Web sitesinde görüntüle',ar:'عرض على الموقع',ru:'Открыть на сайте'} as Record<string,string>)[input.locale]||'View on the website';
  const e=escapeMail;return `<!doctype html><html lang="${e(input.locale)}" dir="${rtl?'rtl':'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#162338"><table role="presentation" width="100%"><tr><td style="padding:24px"><table role="presentation" width="100%" style="max-width:620px;margin:auto;background:white;border-radius:16px"><tr><td style="padding:28px;direction:${rtl?'rtl':'ltr'};text-align:${rtl?'right':'left'}"><p style="color:#087c99;font-weight:bold">Ideal Makoo · ایده‌آل ماکو</p>${input.image?`<img src="${e(input.image)}" alt="${e(input.title)}" width="560" style="max-width:100%;height:auto;border-radius:12px">`:''}<h1 style="font-size:24px;line-height:1.6">${e(input.title)}</h1><p style="white-space:pre-wrap;line-height:1.9">${e(input.body)}</p>${input.link?`<p><a href="${e(input.link)}" style="display:inline-block;padding:12px 20px;background:#087c99;color:white;border-radius:8px;text-decoration:none">${e(button)}</a></p><p dir="ltr" style="font-size:12px;overflow-wrap:anywhere"><a href="${e(input.link)}">${e(input.link)}</a></p>`:''}${input.unsubscribe?`<p style="border-top:1px solid #ddd;padding-top:20px;font-size:12px"><a href="${e(input.unsubscribe.url)}">${e(input.unsubscribe.label)}</a></p>`:''}</td></tr></table></td></tr></table></body></html>`;
}
