import {locales,type Locale} from './i18n';

export interface PublicNoticeLocale {
  enabled:boolean;
  startsAt:string|null;
  endsAt:string|null;
  actionPath:string;
  actionLabel:string;
}
export interface PublicNoticeDefinition {schemaVersion:1;locales:Partial<Record<Locale,PublicNoticeLocale>>}
export interface PublishedPublicNotice extends PublicNoticeLocale {schemaVersion:1}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const hasOnly=(value:Record<string,unknown>,keys:readonly string[])=>Object.keys(value).every(key=>keys.includes(key));
const instant=(value:unknown):value is string|null=>value===null||typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().replace('.000Z','Z')===value.replace('.000Z','Z');
/** Public, unlocalized site paths only; private and bearer-capability routes are forbidden. */
export function normalizeNoticePath(value:unknown):string|null {
  if(typeof value!=='string'||value.length>240||/[\s?#%\\\u0000-\u001f\u007f]/.test(value))return null;
  if(value==='')return '';
  const path=value.replace(/^\/+|\/+$/g,'');
  if(value.startsWith('//')||!/^[-a-z0-9_]+(?:\/[-a-z0-9_]+){0,5}$/i.test(path)||/^(?:fa|en|tr|ar|ru|api|admin|account|auth|_next|feedback|saved-share|content-previews|wishlist-shares|communication-preferences|communication-verification)(?:\/|$)/i.test(path))return null;
  return path;
}
function parseLocale(value:unknown,published=false):PublicNoticeLocale|null {
  if(!object(value)||!hasOnly(value,['enabled','startsAt','endsAt','actionPath','actionLabel',...(published?['schemaVersion']:[])])||typeof value.enabled!=='boolean'||!instant(value.startsAt)||!instant(value.endsAt)||typeof value.actionLabel!=='string'||value.actionLabel.length>120)return null;
  const path=normalizeNoticePath(value.actionPath);if(path===null||path!==value.actionPath||path&&!value.actionLabel.trim()||!path&&value.actionLabel!==''||value.startsAt&&value.endsAt&&Date.parse(value.endsAt)<=Date.parse(value.startsAt))return null;
  return{enabled:value.enabled,startsAt:value.startsAt,endsAt:value.endsAt,actionPath:path,actionLabel:value.actionLabel};
}
export function parsePublicNoticeDefinition(value:unknown):PublicNoticeDefinition|null {
  if(!object(value)||value.schemaVersion!==1||!hasOnly(value,['schemaVersion','locales'])||!object(value.locales)||!hasOnly(value.locales,locales))return null;
  const result:PublicNoticeDefinition={schemaVersion:1,locales:{}};
  for(const locale of locales)if(value.locales[locale]!==undefined){const parsed=parseLocale(value.locales[locale]);if(!parsed)return null;result.locales[locale]=parsed;}
  return result;
}
export function parsePublishedPublicNotice(value:unknown):PublishedPublicNotice|null {
  if(!object(value)||value.schemaVersion!==1)return null;
  const parsed=parseLocale(value,true);return parsed?{schemaVersion:1,...parsed}:null;
}
export function isPublicNoticeActive(value:unknown,at=Date.now()):boolean {
  const notice=parsePublishedPublicNotice(value);return !!notice&&Number.isFinite(at)&&notice.enabled&&(!notice.startsAt||Date.parse(notice.startsAt)<=at)&&(!notice.endsAt||Date.parse(notice.endsAt)>at);
}
export function publicNoticeRevisionKey(publication:{id:string;locale:string;version:number;publishedAt:string}):string {return `${publication.id}:${publication.locale}:${publication.version}:${publication.publishedAt}`;}
export function emptyNoticeLocale():PublicNoticeLocale {return{enabled:true,startsAt:null,endsAt:null,actionPath:'',actionLabel:''};}
