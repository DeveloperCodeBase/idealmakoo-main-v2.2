import type { UserPreferences } from '@/lib/user-settings';

/** Shared between the HTML/CSS layer and canvas hosts; never contains profile data. */
export const DISPLAY_PREFERENCES_EVENT = 'idealmakoo:display-preferences';

/** Runs before paint. Only allow-listed display values reach DOM attributes. */
export const DISPLAY_BOOTSTRAP_SCRIPT = `try{const d=document.documentElement;let t=localStorage.getItem('idealmakoo.theme')==='light'?'light':'dark';const s=JSON.parse(localStorage.getItem('idealmakoo.session.v1')||'null');if(s&&typeof s.id==='string'&&s.id){t='dark';const u=JSON.parse(localStorage.getItem('idealmakoo.user-settings.'+encodeURIComponent(s.id)+'.v1')||'null');if(u&&u.version===1&&u.ownerId===s.id&&u.preferences){const p=u.preferences;if(['dark','light','system'].includes(p.theme))t=p.theme;if(['system','reduced'].includes(p.motion))d.dataset.motion=p.motion;if(typeof p.effects==='boolean')d.dataset.effects=p.effects?'on':'off';if(['standard','large'].includes(p.fontSize))d.dataset.fontSize=p.fontSize;if(['comfortable','compact'].includes(p.density))d.dataset.density=p.density;}}if(t==='system')t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';d.dataset.theme=t;d.style.colorScheme=t;}catch(e){}`;

export function resolveDisplayTheme(theme: UserPreferences['theme'], systemDark: boolean): 'dark' | 'light' {
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
}

export function effectiveReducedMotion(preference: UserPreferences['motion'], systemReduced: boolean): boolean {
  return preference === 'reduced' || systemReduced;
}

export function isReducedMotion(systemReduced = false): boolean {
  return effectiveReducedMotion(typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced' ? 'reduced' : 'system', systemReduced);
}

export function surfaceEffectsEnabled(): boolean {
  return typeof document === 'undefined' || document.documentElement.dataset.effects !== 'off';
}

export function currentDisplayTimeZone(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const value = document.documentElement.dataset.timezone;
  if (!value) return undefined;
  try { new Intl.DateTimeFormat('en', { timeZone: value }); return value; } catch { return undefined; }
}

export function applyDisplayPreferences(preferences: UserPreferences, systemDark: boolean): 'dark' | 'light' {
  const theme = resolveDisplayTheme(preferences.theme, systemDark);
  if (typeof document === 'undefined') return theme;
  const values = { theme, motion: preferences.motion, effects: preferences.effects ? 'on' : 'off', fontSize: preferences.fontSize, density: preferences.density, timezone: preferences.timezone };
  let changed = false;
  for (const [key, value] of Object.entries(values)) {
    if (document.documentElement.dataset[key] !== value) { document.documentElement.dataset[key] = value; changed = true; }
  }
  document.documentElement.style.colorScheme = theme;
  if (changed) window.dispatchEvent(new Event(DISPLAY_PREFERENCES_EVENT));
  return theme;
}
