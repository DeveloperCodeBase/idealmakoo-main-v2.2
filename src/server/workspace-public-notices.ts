import type {WorkspaceRecord,LocalPublication} from '../data/workspace-seed';
import {locales,type Locale} from '../lib/i18n';
import {parsePublicNoticeDefinition,isPublicNoticeActive,type PublishedPublicNotice} from '../lib/public-notices';
import {HttpError,type Actor} from './types';

export function validatePublicNoticeRecord(record:Pick<WorkspaceRecord,'collection'|'title'|'summary'|'details'>):void {
  if(record.details?.publicNotice===undefined)return;
  if(record.collection!=='news'||!parsePublicNoticeDefinition(record.details.publicNotice))throw new HttpError(422,'PUBLIC_NOTICE_SCHEMA','Use the bounded public-notice definition on a news record, with a valid UTC time range and a public site destination.');
  for(const locale of locales)if(record.title[locale].length>160||record.summary[locale].length>600)throw new HttpError(422,'PUBLIC_NOTICE_CONTENT','Notice titles are limited to 160 characters and their message to 600 characters per language.');
}
export function assertPublicNoticeLocaleChanges(before:WorkspaceRecord|undefined,after:WorkspaceRecord,actor:Actor):void {
  if(before?.details?.publicNotice===undefined&&after.details?.publicNotice===undefined)return;
  const prior=parsePublicNoticeDefinition(before?.details?.publicNotice??{schemaVersion:1,locales:{}}),next=parsePublicNoticeDefinition(after.details?.publicNotice??{schemaVersion:1,locales:{}});
  if(after.collection!=='news'||!prior||!next)throw new HttpError(422,'PUBLIC_NOTICE_SCHEMA','The notice language definition is invalid.');
  if(after.status==='archived'&&before?.status!=='archived')assertPublicNoticeRemoval(before??after,actor);
  for(const locale of locales)if(JSON.stringify(prior.locales[locale]??null)!==JSON.stringify(next.locales[locale]??null)&&!actor.allowedLocales.includes(locale))throw new HttpError(403,'CONTENT_LOCALE','This public-notice language is outside the current content grant.');
}
export function assertPublicNoticeRemoval(record:WorkspaceRecord,actor:Actor):void {
  if(record.details?.publicNotice===undefined)return;
  const definition=parsePublicNoticeDefinition(record.details.publicNotice);
  if(!definition)throw new HttpError(422,'PUBLIC_NOTICE_SCHEMA','The notice language definition is invalid.');
  for(const locale of locales)if((definition.locales[locale]||record.title[locale].trim()||record.summary[locale].trim()||record.publishedLocales?.includes(locale))&&!actor.allowedLocales.includes(locale))throw new HttpError(403,'CONTENT_LOCALE','Archiving or deleting a notice requires authority over all of its content languages.');
}
export function publicNoticeForPublication(record:WorkspaceRecord,locale:Locale):PublishedPublicNotice|undefined {
  if(record.details?.publicNotice===undefined)return;
  validatePublicNoticeRecord(record);
  const notice=parsePublicNoticeDefinition(record.details.publicNotice)?.locales[locale];
  if(!notice||!record.title[locale].trim()||!record.summary[locale].trim())throw new HttpError(422,'PUBLIC_NOTICE_CONTENT','The selected language needs its own notice definition, title and message before review or publication.');
  return{schemaVersion:1,...notice};
}
/** Called after the current release/source join. Inactive or malformed notice
 * revisions cannot escape through the public API, SSR, search or RAG corpus. */
export function publicNoticePublicationVisible(publication:LocalPublication,at=Date.now()):boolean {
  return publication.publicNotice===undefined||publication.kind==='news'&&isPublicNoticeActive(publication.publicNotice,at);
}
