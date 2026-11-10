import { roles, type FrontSession } from '@/lib/auth';
import { isLocale, type Locale } from '@/lib/i18n';
import { normalizeAvatarSource } from '@/lib/avatar';
import { writeStore } from '@/lib/storage';

export interface UserProfile {
  name: string;
  phone: string;
  contactEmail: string;
  organization: string;
  profession: string;
  bio: string;
  website: string;
  country: string;
  city: string;
  address: string;
  avatar: string | null;
}
export interface UserPreferences {
  theme: 'dark' | 'light' | 'system';
  language: Locale;
  timezone: string;
  motion: 'system' | 'reduced';
  effects: boolean;
  fontSize: 'standard' | 'large';
  density: 'comfortable' | 'compact';
  sidebar: 'expanded' | 'collapsed';
}
export interface UserSettings {
  version: 1;
  ownerId: string;
  profile: UserProfile;
  preferences: UserPreferences;
  revision: number;
  updatedAt: string;
}
export type UserSettingsSection = 'profile' | 'preferences';
export type UserSettingsIssue = `profile.${keyof UserProfile}` | `preferences.${keyof UserPreferences}` | 'profile' | 'preferences';
export type SaveSettingsResult = { ok: true; settings: UserSettings } | { ok: false; reason: 'session' | 'validation' | 'storage' | 'conflict'; issues?: UserSettingsIssue[] };
export const USER_PROFILE_LIMITS = Object.freeze({ name: 100, phone: 40, contactEmail: 254, organization: 120, profession: 100, bio: 600, website: 300, country: 80, city: 100, address: 400 });
export const USER_SESSION_KEY = 'idealmakoo.session.v1';
const MAX_SETTINGS_JSON_CHARS = 400_000;
const profileKeys = [...Object.keys(USER_PROFILE_LIMITS), 'avatar'] as (keyof UserProfile)[];
const preferenceKeys: (keyof UserPreferences)[] = ['theme', 'language', 'timezone', 'motion', 'effects', 'fontSize', 'density', 'sidebar'];

export function userSettingsKey(id: string): string { return `idealmakoo.user-settings.${encodeURIComponent(id)}.v1`; }
const legacyProfileKey = (id: string) => `idealmakoo.account.${id}.profile.v1`;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)));
const safeText = (value: string, multiline = false) => value.normalize('NFC').replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g : /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim();
const validEmail = (value: string) => value.length <= 254 && /^[^\s@<>"\[\](),;:\\]+@[^\s@<>"\[\](),;:\\]+\.[^\s@<>"\[\](),;:\\]+$/.test(value);
const normalizedDigits = (value: string) => value.replace(/[۰-۹]/g, char => String(char.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, char => String(char.charCodeAt(0) - 1632));
function validTimezone(value: string): boolean {
  if (!value || value.length > 80 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(0); return true; } catch { return false; }
}
function websiteValue(value: string): string | null {
  if (!value) return '';
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname || /[\s\u0000-\u001f]/.test(value)) return null;
    return url.href.length <= USER_PROFILE_LIMITS.website ? url.href : null;
  } catch { return null; }
}

function profileField(key: keyof UserProfile, value: unknown, truncate = false): UserProfile[typeof key] | undefined {
  if (key === 'avatar') return value === null ? null : normalizeAvatarSource(value) ?? undefined;
  if (typeof value !== 'string') return undefined;
  let text = safeText(value, key === 'bio' || key === 'address');
  if (text.length > USER_PROFILE_LIMITS[key]) {
    if (!truncate) return undefined;
    text = text.slice(0, USER_PROFILE_LIMITS[key]).trim();
  }
  if (key === 'name' && text.length < 2) return undefined;
  if (key === 'phone' && text) {
    const phone = normalizedDigits(text);
    if (!/^[+\d\s().\-\/#xextEXT]+$/.test(phone) || (phone.match(/\d/g)?.length || 0) < 5) return undefined;
  }
  if (key === 'contactEmail' && text && !validEmail(text)) return undefined;
  if (key === 'website') return websiteValue(text) ?? undefined;
  return text;
}
function preferenceField(key: keyof UserPreferences, value: unknown): UserPreferences[typeof key] | undefined {
  if (key === 'effects') return typeof value === 'boolean' ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const choices: Partial<Record<keyof UserPreferences, readonly string[]>> = { theme: ['dark', 'light', 'system'], motion: ['system', 'reduced'], fontSize: ['standard', 'large'], density: ['comfortable', 'compact'], sidebar: ['expanded', 'collapsed'] };
  if (key === 'language') return isLocale(value) ? value : undefined;
  if (key === 'timezone') return validTimezone(value) ? value : undefined;
  return choices[key]?.includes(value) ? value as UserPreferences[typeof key] : undefined;
}

export function defaultUserSettings(session: FrontSession, locale: Locale): UserSettings {
  const name = typeof session.name === 'string' ? safeText(session.name).slice(0, USER_PROFILE_LIMITS.name) : '';
  const email = typeof session.email === 'string' && !session.email.endsWith('.invalid') && validEmail(session.email) ? session.email : '';
  return {
    version: 1, ownerId: session.id,
    profile: { name, phone: '', contactEmail: email, organization: '', profession: '', bio: '', website: '', country: '', city: '', address: '', avatar: null },
    preferences: { theme: 'dark', language: locale, timezone: 'Asia/Tehran', motion: 'system', effects: true, fontSize: 'standard', density: 'comfortable', sidebar: 'expanded' },
    revision: 0, updatedAt: '',
  };
}

/** Decode only the caller's schema. Unknown fields cannot become account roles,
 * login addresses or company-wide settings. A corrupt field falls back by field,
 * so one invalid avatar does not erase an otherwise valid profile. */
export function parseUserSettings(value: unknown, session: FrontSession, locale: Locale): UserSettings {
  const settings = defaultUserSettings(session, locale);
  if (!record(value) || value.version !== 1 || value.ownerId !== session.id || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0) return settings;
  settings.revision = value.revision as number;
  settings.updatedAt = typeof value.updatedAt === 'string' && value.updatedAt.length <= 40 && Number.isFinite(Date.parse(value.updatedAt)) ? value.updatedAt : '';
  if (record(value.profile)) for (const key of profileKeys) {
    const normalized = profileField(key, value.profile[key], true);
    if (normalized !== undefined) (settings.profile as unknown as Record<string, unknown>)[key] = normalized;
  }
  if (record(value.preferences)) for (const key of preferenceKeys) {
    const normalized = preferenceField(key, value.preferences[key]);
    if (normalized !== undefined) (settings.preferences as unknown as Record<string, unknown>)[key] = normalized;
  }
  return settings;
}

export function validateUserSettingsPatch<S extends UserSettingsSection>(section: S, patch: Partial<UserSettings[S]>): UserSettingsIssue[] {
  if (!['profile', 'preferences'].includes(section) || !record(patch)) return [section === 'preferences' ? 'preferences' : 'profile'];
  const keys = section === 'profile' ? profileKeys : preferenceKeys;
  const issues: UserSettingsIssue[] = [];
  for (const key of Reflect.ownKeys(patch)) {
    const descriptor = Object.getOwnPropertyDescriptor(patch, key);
    if (typeof key !== 'string' || !keys.includes(key as never) || !descriptor || !('value' in descriptor)) { issues.push(section); continue; }
    const normalized = section === 'profile' ? profileField(key as keyof UserProfile, descriptor.value) : preferenceField(key as keyof UserPreferences, descriptor.value);
    if (normalized === undefined) issues.push(`${section}.${key}` as UserSettingsIssue);
  }
  return [...new Set(issues)];
}

function parseJson(raw: string | null): unknown {
  if (!raw || raw.length > MAX_SETTINGS_JSON_CHARS) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}
function validSession(value: unknown): value is FrontSession {
  return record(value) && typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 320 && !/[\u0000-\u001f\u007f]/.test(value.id) && typeof value.name === 'string' && typeof value.email === 'string' && value.email.length <= 254 && validEmail(value.email) && typeof value.role === 'string' && roles.includes(value.role as FrontSession['role']) && typeof value.demo === 'boolean';
}
function ownsCurrentSession(session: FrontSession): boolean {
  if (!validSession(session)) return false;
  const current = parseJson(window.localStorage.getItem(USER_SESSION_KEY));
  return validSession(current) && current.id === session.id && current.role === session.role && current.email.trim().toLowerCase() === session.email.trim().toLowerCase() && current.demo === session.demo;
}
function readSnapshot(session: FrontSession, locale: Locale): { raw: string | null; legacyRaw: string | null; settings: UserSettings } {
  const raw = window.localStorage.getItem(userSettingsKey(session.id));
  if (raw !== null) return { raw, legacyRaw: null, settings: parseUserSettings(parseJson(raw), session, locale) };
  // Migration is lazy and scoped to the authenticated owner's old key. Reads do
  // not mutate storage; the next deliberate save persists the upgraded record.
  const legacyRaw = window.localStorage.getItem(legacyProfileKey(session.id)), legacy = parseJson(legacyRaw);
  const settings = defaultUserSettings(session, locale);
  if (record(legacy)) {
    for (const key of profileKeys) {
      const normalized = profileField(key, legacy[key], true);
      if (normalized !== undefined) (settings.profile as unknown as Record<string, unknown>)[key] = normalized;
    }
    for (const key of ['language', 'timezone'] as const) {
      const normalized = preferenceField(key, legacy[key]);
      if (normalized !== undefined) (settings.preferences as unknown as Record<string, unknown>)[key] = normalized;
    }
  }
  return { raw, legacyRaw, settings };
}

/** Frontend repository. The production adapter must use authenticated /me routes
 * and an atomic If-Match/version check on its own server. Browser storage guards
 * model the same ownership boundary; they are not a backend authorization layer. */
export function readUserSettings(session: FrontSession, locale: Locale): UserSettings {
  const fallback = defaultUserSettings(session, locale);
  if (typeof window === 'undefined') return fallback;
  try { return ownsCurrentSession(session) ? readSnapshot(session, locale).settings : fallback; } catch { return fallback; }
}

export function updateOwnUserSettings<S extends UserSettingsSection>(session: FrontSession, section: S, patch: Partial<UserSettings[S]>, expectedRevision: number): SaveSettingsResult {
  if (typeof window === 'undefined') return { ok: false, reason: 'storage' };
  try {
    if (!ownsCurrentSession(session)) return { ok: false, reason: 'session' };
    const locale = typeof document !== 'undefined' && isLocale(document.documentElement.lang) ? document.documentElement.lang : 'fa';
    const current = readSnapshot(session, locale), settings = current.settings;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== settings.revision || settings.revision >= Number.MAX_SAFE_INTEGER) return { ok: false, reason: 'conflict' };
    const issues = validateUserSettingsPatch(section, patch);
    if (issues.length) return { ok: false, reason: 'validation', issues };
    const next = structuredClone(settings);
    for (const [key, value] of Object.entries(patch)) {
      const normalized = section === 'profile' ? profileField(key as keyof UserProfile, value) : preferenceField(key as keyof UserPreferences, value);
      (next[section] as unknown as Record<string, unknown>)[key] = normalized;
    }
    // Recheck the live actor and the entire snapshot after validation, not the
    // component's captured role or another tab's earlier revision.
    if (!ownsCurrentSession(session)) return { ok: false, reason: 'session' };
    if (window.localStorage.getItem(userSettingsKey(session.id)) !== current.raw || (current.raw === null && window.localStorage.getItem(legacyProfileKey(session.id)) !== current.legacyRaw)) return { ok: false, reason: 'conflict' };
    if (JSON.stringify(next[section]) === JSON.stringify(settings[section])) return { ok: true, settings };
    next.revision += 1;
    next.updatedAt = new Date().toISOString();
    return writeStore(userSettingsKey(session.id), next) ? { ok: true, settings: next } : { ok: false, reason: 'storage' };
  } catch { return { ok: false, reason: 'storage' }; }
}
