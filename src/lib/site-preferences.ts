"use client";

import { useMemo,useSyncExternalStore } from "react";
import {useInitialServerSite} from "@/lib/public-site-context";
import {apiClient,ApiError,demoMode} from "@/lib/api";
import {readServerSite,PUBLIC_SITE_EVENT,refreshServerSite,type PublicSiteSnapshot} from "@/lib/server-runtime";
import { company } from "@/data/catalog";
import { locales, translate, type Locale, type Localized } from "@/lib/i18n";
import { sitePaths } from "@/lib/routes";
import { readStore, writeStore } from "@/lib/storage";
import { defaultSiteContact,defaultSiteFooterDetails,footerTextFields,safeFooterSource,type SiteContactDetails,type SiteFooterDetails } from './site-preference-content';
import { isPublicPathVisible,type PublicVisibilitySnapshot } from './public-visibility';
import {parsePublicCopyOverrides,parsePublicSeoSettings,validPublicCopyOverrides,validPublicSeoSettings,type PublicCopyOverrides,type PublicSeoSettings} from './site-editorial-settings';

export interface SiteMenuItem { id: string; label: Localized; path: string; visible: boolean }
export interface SiteMenuGroup { id: string; label: Localized; visible: boolean; items: SiteMenuItem[] }
export interface SitePreferences {
  version: 1;
  brand: { name: Localized; tagline: Localized; logo: string };
  contact: SiteContactDetails;
  footerDetails: SiteFooterDetails;
  navigation: SiteMenuGroup[];
  footer: SiteMenuGroup[];
  uiText?: PublicCopyOverrides;
  seo?: PublicSeoSettings;
  updatedAt?: string;
}
export type MenuPlacement = "navigation" | "footer";
export type SitePreferenceMode = "menus" | "settings" | "all";
export type PreferenceIssue = "labels" | "route" | "phone" | "email" | "limit" | "logo" | "footer" | "editorial";
export const SITE_PREFERENCES_KEY = "idealmakoo.site-preferences.v1";
const DRAFT_KEY = "idealmakoo.site-preferences-draft.v1";
const EVENT = "idealmakoo:site-preferences";
export const MAX_MENU_GROUPS = 6;
export const MAX_MENU_ITEMS = 12;
export const publicMenuRoutes = sitePaths.filter(path => !["admin", "auth", "account"].some(prefix => path === prefix || path.startsWith(`${prefix}/`)));
const declared = new Set(publicMenuRoutes);
const words = (key: string): Localized => Object.fromEntries(locales.map(locale => [locale, translate(locale, key)])) as Localized;
const group = (id: string, title: string, entries: [string, string][]): SiteMenuGroup => ({
  id, label: words(title), visible: true,
  items: entries.map(([path, key], index) => ({ id: `${id}-${index}`, label: words(key), path, visible: true })),
});

export function createDefaultSitePreferences(): SitePreferences {
  return {
    version: 1,
    brand: { name: { ...company.name }, tagline: words("brandSub"), logo: company.logo },
    contact: defaultSiteContact(), footerDetails:defaultSiteFooterDetails(),
    navigation: [
      group("products", "products", [["products", "allProducts"], ["products/category/teeth", "teeth"], ["products/category/materials", "materials"], ["compare", "compare"], ["tools/shade-mould-matcher", "matcher"], ["technical-selection", "technical"]]),
      group("research", "research", [["research", "articles"], ["resources", "resources"], ["knowledge", "knowledge"], ["glossary", "glossary"], ["news", "news"], ["events", "events"]]),
      group("company", "company", [["about", "about"], ["manufacturing", "manufacturing"], ["quality", "quality"], ["global", "global"], ["sustainability", "sustainability"], ["careers", "careers"]]),
      group("cooperation", "cooperation", [["cooperation", "cooperation"], ["distributors", "distributors"], ["cooperation/distribution", "dealer"], ["cooperation/research", "researcher"], ["support", "support"], ["contact", "contact"]]),
    ],
    footer: [
      group("footer-products", "products", [["products/category/teeth", "teeth"], ["products/category/materials", "materials"], ["resources", "resources"], ["inquiry-list", "inquiry"]]),
      group("footer-company", "company", [["about", "about"], ["research", "articles"], ["cooperation", "cooperation"], ["careers", "careers"]]),
    ],
  };
}

/** Normalize safe public destinations. The server checks custom paths against published pages. */
export function normalizeMenuPath(value: string): string | null {
  const input = value.trim();
  if (/^[a-z][a-z\d+.-]*:/i.test(input) || input.startsWith("//") || /[\\#\s<>\u0000-\u001f]/.test(input) || /%/i.test(input.split("?")[0])) return null;
  const [rawPath, query, extra] = input.split("?");
  if (extra !== undefined || rawPath.split("/").some(part => part === "." || part === "..")) return null;
  let path = rawPath.replace(/^\/+|\/+$/g, "");
  path = path.replace(/^(fa|en|tr|ar|ru)(?:\/|$)/, "");
  if (!declared.has(path) && (!/^[a-z\d_-]+(?:\/[a-z\d_-]+){0,5}$/i.test(path) || path.length > 240 || /^(?:admin|auth|account|api|_next)(?:\/|$)/i.test(path))) return null;
  if (query !== undefined) {
    if (!(path === "page" || path.endsWith("/detail"))) return null;
    const params = new URLSearchParams(query);
    const id = params.get("id");
    if (params.size !== 1 || !id || !/^[a-z\d_-]{1,160}$/i.test(id)) return null;
    return `${path}?id=${encodeURIComponent(id)}`;
  }
  return path;
}

export function siteMenuHref(path: string, locale: Locale): string {
  const normalized = normalizeMenuPath(path);
  if (normalized === null) return `/${locale}/`;
  const [base, query] = normalized.split("?");
  return `/${locale}/${base ? `${base}/` : ""}${query ? `?${query}` : ""}`;
}

export function visibleMenuGroups(groups: SiteMenuGroup[],site?:PublicVisibilitySnapshot|null,locale?:Locale): SiteMenuGroup[] {
  return groups.filter(group => group.visible).map(group => ({ ...group, items: group.items.filter(item => {const path=normalizeMenuPath(item.path);return item.visible&&path!==null&&(!locale||isPublicPathVisible(site,locale,path.split('?')[0]));}) })).filter(group => group.items.length > 0);
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const completeLabel = (value: unknown): value is Localized => object(value) && locales.every(locale => typeof value[locale] === "string" && (value[locale] as string).trim().length > 0 && (value[locale] as string).length <= 100);
const textMap = (value: unknown, fallback: Localized, max: number): Localized => Object.fromEntries(locales.map(locale => [locale, object(value) && typeof value[locale] === "string" ? (value[locale] as string).trim().slice(0, max) : fallback[locale]])) as Localized;
const phoneValid = (value: string) => /^\+?[\d ()-]{7,26}$/.test(value) && /^\d{7,15}$/.test(value.replace(/\D/g, ""));
const emailValid = (value: string) => !value || (value.length <= 254 && /^[^\s@<>?&#]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/i.test(value));

/** Logo uploads are static raster data, never SVG/HTML or arbitrary remote URLs. */
export function normalizeLogoSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (/^\/media\/(?:official|brand)\/[a-z\d][a-z\d_-]*\.(?:png|jpe?g|webp|avif)$/i.test(source)) return source;
  if (/^\/api\/v1\/media\/[a-zA-Z0-9_-]+(?:\/(?:file|content))?$/.test(source)) return source;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z\d+/]+={0,2})$/.exec(source);
  if (!match || match[2].length % 4 !== 0) return null;
  const bytes = match[2].length * 3 / 4 - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  if (bytes < 12 || bytes > 512 * 1024) return null;
  try {
    const header = atob(match[2].slice(0, 40));
    const kind = match[1];
    const signature = kind === "png" ? header.startsWith("\x89PNG\r\n\x1a\n")
      : kind === "jpeg" ? header.charCodeAt(0) === 255 && header.charCodeAt(1) === 216 && header.charCodeAt(2) === 255
      : header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
    return signature ? source : null;
  } catch { return null; }
}

/** Each editor applies only the fields it exposes, preserving the other published section. */
export function scopeSitePreferences(value: SitePreferences, base: SitePreferences, mode: SitePreferenceMode): SitePreferences {
  if (mode === "menus") return { ...base, navigation: value.navigation, footer: value.footer };
  if (mode === "settings") return { ...base, brand: value.brand, contact: value.contact, footerDetails:value.footerDetails,uiText:value.uiText,seo:value.seo };
  return value;
}

export function validateSitePreferences(value: SitePreferences): PreferenceIssue[] {
  const issues = new Set<PreferenceIssue>();
  if(!validPublicCopyOverrides(value.uiText)||!validPublicSeoSettings(value.seo))issues.add("editorial");
  if (!completeLabel(value.brand.name)) issues.add("labels");
  if (normalizeLogoSource(value.brand.logo) === null) issues.add("logo");
  if (!phoneValid(value.contact.phone)) issues.add("phone");
  if (!emailValid(value.contact.email)) issues.add("email");
  for(const address of [value.contact.officeAddress,value.contact.factoryAddress])if(!object(address)||locales.some(locale=>typeof address[locale]!=='string'||address[locale].length>500))issues.add('labels');
  if(locales.some(locale=>value.contact.address[locale]!==value.contact.officeAddress[locale]))issues.add('labels');
  if(!value.footerDetails||safeFooterSource(value.footerDetails.sourceUrl)===null||footerTextFields.some(field=>!object(value.footerDetails[field])||locales.some(locale=>typeof value.footerDetails[field][locale]!=='string'||value.footerDetails[field][locale].length>500)))issues.add('footer');
  for (const groups of [value.navigation, value.footer]) {
    if (groups.length > MAX_MENU_GROUPS) issues.add("limit");
    for (const group of groups) {
      if (!completeLabel(group.label)) issues.add("labels");
      if (group.items.length > MAX_MENU_ITEMS) issues.add("limit");
      for (const item of group.items) {
        if (!completeLabel(item.label)) issues.add("labels");
        if (normalizeMenuPath(item.path) === null) issues.add("route");
      }
    }
  }
  return [...issues];
}

/** Malformed local preferences never add unsafe navigation or replace source contact data. */
export function parseSitePreferences(value: unknown): SitePreferences {
  const fallback = createDefaultSitePreferences();
  if (!object(value) || value.version !== 1) return fallback;
  const parseGroups = (input: unknown, defaults: SiteMenuGroup[]) => {
    if (!Array.isArray(input)) return defaults;
    const ids = new Set<string>();
    return input.filter(object).filter(item => completeLabel(item.label) && typeof item.id === "string").slice(0, MAX_MENU_GROUPS).flatMap(item => {
      const id = (item.id as string).replace(/[^a-z\d_-]/gi, "").slice(0, 70);
      if (!id || ids.has(id)) return [];
      ids.add(id);
      const itemIds = new Set<string>();
      const items: SiteMenuItem[] = Array.isArray(item.items) ? item.items.filter(object).flatMap((link, index) => {
        const path = typeof link.path === "string" ? normalizeMenuPath(link.path) : null;
        if (path === null || !completeLabel(link.label)) return [];
        const linkId = typeof link.id === "string" ? link.id.replace(/[^a-z\d_-]/gi, "").slice(0, 70) : `${id}-${index}`;
        if (!linkId || itemIds.has(linkId)) return [];
        itemIds.add(linkId);
        return [{ id: linkId, path, label: textMap(link.label, words("contact"), 100), visible: link.visible !== false }];
      }).slice(0, MAX_MENU_ITEMS) : [];
      return [{ id, label: textMap(item.label, words("menu"), 100), visible: item.visible !== false, items }];
    });
  };
  const brand = object(value.brand) ? value.brand : {};
  const contact = object(value.contact) ? value.contact : {};
  const officeAddress=textMap(contact.officeAddress??contact.address,fallback.contact.officeAddress,500);
  const footerDetails=object(value.footerDetails)?value.footerDetails:{};
  return {
    version: 1,
    brand: { name: completeLabel(brand.name) ? textMap(brand.name, fallback.brand.name, 100) : fallback.brand.name, tagline: textMap(brand.tagline, fallback.brand.tagline, 200), logo: normalizeLogoSource(brand.logo) || fallback.brand.logo },
    contact: { address:{...officeAddress},officeAddress,factoryAddress:textMap(contact.factoryAddress,fallback.contact.factoryAddress,500),phone: typeof contact.phone === "string" && phoneValid(contact.phone) ? contact.phone : fallback.contact.phone, email: typeof contact.email === "string" && emailValid(contact.email) ? contact.email : "" },
    footerDetails:{...Object.fromEntries(footerTextFields.map(field=>[field,textMap(footerDetails[field],fallback.footerDetails[field],500)])) as Pick<SiteFooterDetails,typeof footerTextFields[number]>,sourceUrl:safeFooterSource(footerDetails.sourceUrl)??fallback.footerDetails.sourceUrl},
    navigation: parseGroups(value.navigation, fallback.navigation), footer: parseGroups(value.footer, fallback.footer),
    uiText:parsePublicCopyOverrides(value.uiText),seo:parsePublicSeoSettings(value.seo),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
  };
}

const defaults = createDefaultSitePreferences();
// All consumers of the same immutable SSR/public snapshot must read the same
// object. Reparsing on provider mount forces synchronous external-store updates
// while React is still hydrating the navigation, footer and application shell.
// A new response is parsed independently even when its workspace version has
// not changed; timed publication visibility is not governed by that version.
const initialPreferenceCache = new WeakMap<PublicSiteSnapshot, SitePreferences>();
function initialPreferences(initial: PublicSiteSnapshot | null): SitePreferences {
  if (!initial) return defaults;
  const known = initialPreferenceCache.get(initial); if (known) return known;
  const parsed = parseSitePreferences(initial.preferences);
  initialPreferenceCache.set(initial, parsed); return parsed;
}
let cachedServer:unknown;
let cachedText: string | null | undefined;
let cached = defaults;
function snapshot(): SitePreferences {
  if (typeof window === "undefined") return defaults;
  if(!demoMode){const server=readServerSite();if(server===cachedServer)return cached;cachedServer=server;cached=initialPreferences(server);return cached;}
  try {
    const raw = localStorage.getItem(SITE_PREFERENCES_KEY);
    if (raw === cachedText) return cached;
    cachedText = raw;
    cached = raw ? parseSitePreferences(JSON.parse(raw)) : defaults;
    return cached;
  } catch { cachedText = undefined; cached = defaults; return defaults; }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === SITE_PREFERENCES_KEY || event.key === null) listener(); };
  const local = (event: Event) => { if ((event as CustomEvent).detail?.key === SITE_PREFERENCES_KEY) listener(); };
  window.addEventListener(PUBLIC_SITE_EVENT,listener);window.addEventListener(EVENT, listener); window.addEventListener("storage", storage); window.addEventListener("idealmakoo:store", local);
  return () => { window.removeEventListener(PUBLIC_SITE_EVENT,listener);window.removeEventListener(EVENT, listener); window.removeEventListener("storage", storage); window.removeEventListener("idealmakoo:store", local); };
}
export function useSitePreferences(){const initial=useInitialServerSite();const seeded=useMemo(()=>initialPreferences(initial),[initial]);return useSyncExternalStore(subscribe,()=>!demoMode&&!readServerSite()?seeded:snapshot(),()=>seeded);}
let serverDraft:SitePreferences|null=null;
export interface SitePreferencesRevision {draft:SitePreferences|null;published:SitePreferences|null;version:number}
function preferenceRevision(result:SitePreferencesRevision):SitePreferencesRevision {
 if(!Number.isSafeInteger(result.version)||result.version<1)throw new Error('Invalid site preference revision');
 const revision={draft:result.draft?parseSitePreferences(result.draft):null,published:result.published?parseSitePreferences(result.published):null,version:result.version};
 serverDraft=revision.draft?structuredClone(revision.draft):null;
 return revision;
}
/** Callers retain this exact revision alongside their draft. Loading another
 * editor must never replace the version used by an already-open editor. */
export async function loadSitePreferencesRevision():Promise<SitePreferencesRevision>{
 if(demoMode)return {draft:readSitePreferencesDraft(),published:snapshot(),version:1};
 return preferenceRevision(await apiClient.request<SitePreferencesRevision>('/site-preferences'));
}
export async function loadSitePreferencesDraft():Promise<SitePreferences|null>{
 return (await loadSitePreferencesRevision()).draft;
}
export function readSitePreferencesDraft(): SitePreferences | null {if(!demoMode)return serverDraft;const value=readStore<unknown>(DRAFT_KEY,null);return value?parseSitePreferences(value):null;}
export async function saveSitePreferencesDraft(value:SitePreferences,mode:SitePreferenceMode='all',expectedVersion?:number):Promise<boolean>{
 if(validateSitePreferences(value).length)return false;
 if(demoMode)return writeStore(DRAFT_KEY,parseSitePreferences(value));
 await writeSitePreferencesRevision(value,mode,false,expectedVersion);return true;
}
export async function applySitePreferences(value:SitePreferences,mode:SitePreferenceMode='all',expectedVersion?:number):Promise<SitePreferences|null>{
 if(validateSitePreferences(value).length)return null;
 if(demoMode){const next={...parseSitePreferences(value),updatedAt:new Date().toISOString()};if(!writeStore(SITE_PREFERENCES_KEY,next))return null;window.dispatchEvent(new CustomEvent(EVENT));return next;}
 const result=await writeSitePreferencesRevision(value,mode,true,expectedVersion);await refreshServerSite();return result.published;
}
export async function writeSitePreferencesRevision(value:SitePreferences,mode:SitePreferenceMode,publish:boolean,expectedVersion?:number):Promise<SitePreferencesRevision>{
 if(validateSitePreferences(value).length)throw new Error('Invalid site preferences');
 if(!Number.isSafeInteger(expectedVersion)||!expectedVersion||expectedVersion<1)throw new ApiError({type:'about:blank',title:'Saved version required',status:428,code:'VERSION_REQUIRED',detail:'Load the saved preference revision before writing this draft.'});
 if(demoMode){
  const published=publish?await applySitePreferences(value,mode):snapshot();
  if(!await saveSitePreferencesDraft(value,mode)||publish&&!published)throw new Error('Site preferences could not be saved');
  return {draft:parseSitePreferences(value),published,version:expectedVersion+1};
 }
 return preferenceRevision(await apiClient.request<SitePreferencesRevision>('/site-preferences',{method:'PUT',body:JSON.stringify({value,mode,publish,expectedVersion})}));
}
