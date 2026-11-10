import type {ContentLocale} from '@/data/catalog';

export const glossaryLocales = ['fa', 'en', 'tr', 'ar', 'ru'] as const;
export interface GlossaryDefinition {schemaVersion: 1; aliases: Partial<Record<ContentLocale, string[]>>;}
export interface PublishedGlossary {schemaVersion: 1; aliases: string[];}
export interface GlossaryPublicationSource {
  id: string; slug: string; kind: string; locale: ContentLocale; title: string; summary: string;
  body?: string; publishedAt: string; version: number; glossary?: PublishedGlossary;
}
export interface GlossaryTerm {
  id: string; slug: string; locale: ContentLocale; title: string; definition: string; body: string;
  aliases: string[]; publishedAt: string; version: number;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));
const fold = (value: string, locale: ContentLocale) => value.normalize('NFC').toLocaleLowerCase(locale);
function aliases(value: unknown, locale: ContentLocale): string[] | null {
  if (!Array.isArray(value) || value.length > 12) return null;
  const result: string[] = [], seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || item.length < 2 || item.length > 100 || item !== item.trim() || /[\u0000-\u001f\u007f]/u.test(item)) return null;
    const identity = fold(item, locale);
    if (seen.has(identity)) return null;
    seen.add(identity); result.push(item);
  }
  return result;
}
export function parseGlossaryDefinition(value: unknown): GlossaryDefinition | null {
  if (!object(value) || !exactKeys(value, ['schemaVersion', 'aliases']) || value.schemaVersion !== 1 || !object(value.aliases) || !exactKeys(value.aliases, glossaryLocales)) return null;
  const result: GlossaryDefinition = {schemaVersion: 1, aliases: {}};
  for (const locale of glossaryLocales) {
    if (!Object.hasOwn(value.aliases, locale)) continue;
    const parsed = aliases(value.aliases[locale], locale);
    if (!parsed) return null;
    result.aliases[locale] = parsed;
  }
  return result;
}
export function parsePublishedGlossary(value: unknown, locale: ContentLocale = 'en'): PublishedGlossary | null {
  if (!object(value) || !exactKeys(value, ['schemaVersion', 'aliases']) || value.schemaVersion !== 1) return null;
  const parsed = aliases(value.aliases, locale);
  return parsed ? {schemaVersion: 1, aliases: parsed} : null;
}
export function glossaryFromPublications(publications: readonly GlossaryPublicationSource[], locale: ContentLocale): GlossaryTerm[] {
  const byId = new Map<string, GlossaryTerm>();
  for (const publication of publications) {
    if (publication.kind !== 'glossary' || publication.locale !== locale || !publication.id || !publication.title?.trim() || publication.title.length > 100 || !publication.summary?.trim() || publication.summary.length > 10000 || !Number.isFinite(Date.parse(publication.publishedAt)) || !Number.isInteger(publication.version) || publication.version < 1) continue;
    const slug = publication.slug.replace(/^glossary\//, '');
    if (!/^[a-z0-9][a-z0-9_-]{0,159}$/.test(slug)) continue;
    const metadata = publication.glossary === undefined ? {schemaVersion: 1 as const, aliases: []} : parsePublishedGlossary(publication.glossary, locale);
    if (!metadata) continue;
    const term: GlossaryTerm = {id: publication.id, slug, locale, title: publication.title.trim(), definition: publication.summary.trim(), body: publication.body || '', aliases: metadata.aliases, publishedAt: publication.publishedAt, version: publication.version};
    const previous = byId.get(term.id);
    if (!previous || Date.parse(term.publishedAt) > Date.parse(previous.publishedAt) || (term.publishedAt === previous.publishedAt && term.version > previous.version)) byId.set(term.id, term);
  }
  const collator = new Intl.Collator(locale, {numeric: true, sensitivity: 'base'});
  return [...byId.values()].sort((a, b) => collator.compare(a.title, b.title) || a.id.localeCompare(b.id));
}
interface TrieNode {children: Map<string, TrieNode>; term?: GlossaryTerm;}
export interface GlossaryMatcher {locale: ContentLocale; root: TrieNode; maxLength: number;}
export type GlossaryPart = {type: 'text'; text: string} | {type: 'term'; text: string; term: GlossaryTerm};
/** Literal matching only. Editorial aliases never become a regular expression. */
export function createGlossaryMatcher(terms: readonly GlossaryTerm[], locale: ContentLocale): GlossaryMatcher {
  const matcher: GlossaryMatcher = {locale, root: {children: new Map()}, maxLength: 0};
  const names = new Map<string, GlossaryTerm | null>();
  for (const term of terms.slice(0, 2000)) {
    if (term.locale !== locale) continue;
    for (const name of [term.title, ...term.aliases]) {
      if (name.length < 2 || name.length > 100) continue;
      const normalized = fold(name, locale);
      if (!names.has(normalized)) names.set(normalized, term);
      else if (names.get(normalized)?.id !== term.id) names.set(normalized, null);
    }
  }
  let remaining = 60000;
  for (const [name, term] of names) {
    if (!term) continue;
    const units = [...name];
    if (units.length > remaining) continue;
    remaining -= units.length;
    let node = matcher.root;
    for (const unit of units) {
      let next = node.children.get(unit);
      if (!next) {next = {children: new Map()}; node.children.set(unit, next);}
      node = next;
    }
    node.term = term;
    matcher.maxLength = Math.max(matcher.maxLength, units.length);
  }
  return matcher;
}
const word = (value: string | undefined) => !!value && /[\p{L}\p{M}\p{N}\p{Pc}\u200c\u200d]/u.test(value);
export function splitGlossaryText(text: string, matcher: GlossaryMatcher, maxMatches = 8): GlossaryPart[] {
  const limit = Math.max(0, Math.min(24, Math.floor(maxMatches)));
  if (!text || !matcher.maxLength || !limit) return [{type: 'text', text}];
  const source = text.slice(0, 50000);
  const units: {value: string; start: number; end: number; first: boolean; last: boolean}[] = [];
  const segmenter = new Intl.Segmenter(matcher.locale, {granularity: 'grapheme'});
  for (const segment of segmenter.segment(source)) {
    const normalized = [...fold(segment.segment, matcher.locale)];
    normalized.forEach((value, i) => units.push({value, start: segment.index, end: segment.index + segment.segment.length, first: i === 0, last: i === normalized.length - 1}));
  }
  const result: GlossaryPart[] = [], seen = new Set<string>();
  let cursor = 0, count = 0;
  for (let start = 0; start < units.length && count < limit; start++) {
    if (!units[start].first || (start > 0 && word(units[start - 1].value))) continue;
    let node = matcher.root, selected: {end: number; term: GlossaryTerm} | undefined;
    for (let end = start; end < units.length && end - start < matcher.maxLength; end++) {
      const next = node.children.get(units[end].value);
      if (!next) break;
      node = next;
      if (node.term && !seen.has(node.term.id) && units[end].last && !word(units[end + 1]?.value)) selected = {end, term: node.term};
    }
    if (!selected) continue;
    const from = units[start].start, to = units[selected.end].end;
    if (from > cursor) result.push({type: 'text', text: text.slice(cursor, from)});
    result.push({type: 'term', text: text.slice(from, to), term: selected.term});
    seen.add(selected.term.id); count++; cursor = to; start = selected.end;
  }
  if (cursor < text.length || !result.length) result.push({type: 'text', text: text.slice(cursor)});
  return result;
}
