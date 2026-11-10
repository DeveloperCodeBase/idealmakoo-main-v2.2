import type {WorkspaceRecord} from '../data/workspace-seed';
import type {Locale} from '../lib/i18n';
import type {Actor} from './types';
import {HttpError} from './types';
import {glossaryLocales,parseGlossaryDefinition,type PublishedGlossary,type GlossaryDefinition} from '../lib/glossary';

/** The canonical locale projection is part of the ordinary immutable CMS revision. */
export function glossaryForPublication(record:WorkspaceRecord,locale:Locale):PublishedGlossary|undefined {
  if(record.collection!=='glossary')return undefined;
  const definition:GlossaryDefinition|null=record.details?.glossary===undefined?{schemaVersion:1 as const,aliases:{}}:parseGlossaryDefinition(record.details.glossary);
  if(!definition)throw new HttpError(422,'GLOSSARY_SCHEMA','Use the structured glossary alias definition.');
  if(!record.title[locale].trim()||record.title[locale].length>100||!record.summary[locale].trim()||record.summary[locale].length>10000)throw new HttpError(422,'GLOSSARY_CONTENT','A published term needs a title of at most 100 characters and a definition of at most 10000 characters in its selected language.');
  return{schemaVersion:1,aliases:[...(definition.aliases[locale]||[])]};
}
export function validateGlossaryRecord(record:Pick<WorkspaceRecord,'collection'|'title'|'summary'|'details'>):void {
  if(record.details?.glossary!==undefined&&(record.collection!=='glossary'||!parseGlossaryDefinition(record.details.glossary)))throw new HttpError(422,'GLOSSARY_SCHEMA','Only glossary records may contain a structured glossary alias definition.');
  if(record.collection==='glossary')for(const locale of glossaryLocales)if(record.title[locale].length>100||record.summary[locale].length>10000)throw new HttpError(422,'GLOSSARY_CONTENT','A term title is limited to 100 characters and its definition to 10000 characters per language.');
}
export function assertGlossaryLocaleChanges(before:WorkspaceRecord|undefined,after:WorkspaceRecord,actor:Actor):void {
  if(after.collection!=='glossary')return;
  const previous:GlossaryDefinition|null=before?.details?.glossary===undefined?{schemaVersion:1 as const,aliases:{}}:parseGlossaryDefinition(before.details.glossary);
  const next:GlossaryDefinition|null=after.details?.glossary===undefined?{schemaVersion:1 as const,aliases:{}}:parseGlossaryDefinition(after.details.glossary);
  if(!previous||!next)throw new HttpError(422,'GLOSSARY_SCHEMA','Use the structured glossary alias definition.');
  for(const locale of glossaryLocales)if(JSON.stringify(previous.aliases[locale]||[])!==JSON.stringify(next.aliases[locale]||[])&&!actor.allowedLocales.includes(locale))throw new HttpError(403,'CONTENT_LOCALE','A glossary alias language is outside the current content grant.');
}
