import type {InquiryLine} from '@/types/frontend';
import type {Locale} from '@/lib/i18n';
export const GUEST_INQUIRY_KEY='idealmakoo.guest-inquiry.v1';
export interface GuestInquiry {schemaVersion:1;id:string;locale:Locale;items:InquiryLine[];createdAt:string;userId?:string}
const locales=['fa','en','tr','ar','ru'];
export function parseGuestInquiry(raw:unknown,now=Date.now()):GuestInquiry|null{
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
 const value=raw as Record<string,unknown>;
 if(value.schemaVersion!==1||typeof value.id!=='string'||!/^[a-f0-9-]{36}$/i.test(value.id)||!locales.includes(String(value.locale))||typeof value.createdAt!=='string'||!Number.isFinite(Date.parse(value.createdAt))||Date.parse(value.createdAt)>now+60_000||Date.parse(value.createdAt)<now-24*60*60_000||!Array.isArray(value.items)||value.items.length>500||value.userId!==undefined&&typeof value.userId!=='string')return null;
 const items:InquiryLine[]=[];
 for(const row of value.items){if(!row||typeof row!=='object'||Array.isArray(row))return null;const item=row as Record<string,unknown>;if(typeof item.productId!=='string'||item.productId.length>160||!Number.isInteger(item.quantity)||Number(item.quantity)<1||Number(item.quantity)>100000||Object.keys(item).some(key=>!['productId','quantity','shade','mould','note','variantId','sku','unit'].includes(key)))return null;const next:InquiryLine={productId:item.productId,quantity:Number(item.quantity)};for(const key of ['shade','mould','note','variantId','sku','unit'] as const){if(item[key]!==undefined){if(typeof item[key]!=='string'||item[key].length>(key==='note'?1000:240))return null;next[key]=item[key];}}items.push(next);}
 return {schemaVersion:1,id:value.id,locale:value.locale as Locale,createdAt:value.createdAt,items,...(value.userId?{userId:value.userId as string}:{})};
}
export function readGuestInquiry():GuestInquiry|null{try{return parseGuestInquiry(JSON.parse(sessionStorage.getItem(GUEST_INQUIRY_KEY)||'null'));}catch{return null;}}
export function writeGuestInquiry(value:GuestInquiry|null):boolean{try{if(value)sessionStorage.setItem(GUEST_INQUIRY_KEY,JSON.stringify(value));else sessionStorage.removeItem(GUEST_INQUIRY_KEY);return true;}catch{return false;}}
