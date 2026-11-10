import { apiClient, demoMode } from '@/lib/api';

/** Public server snapshots live only in memory. Private workspace state is never copied here. */
export interface PublicSiteSnapshot { observedAt?:string; publications: unknown[]; forms: unknown[]; preferences: unknown; content: unknown; version: number; hiddenProducts?:string[]; hiddenProductLocales?:Record<string,string[]>;hiddenArticleLocales?:Record<string,string[]>;hiddenPageLocales?:Record<string,string[]> }
let publicSite: PublicSiteSnapshot | null = null;
let currentRequest: Promise<PublicSiteSnapshot | null> | null = null;
export const PUBLIC_SITE_EVENT = 'idealmakoo:server-site';
export function readServerSite() { return publicSite; }
export function seedServerSite(snapshot:PublicSiteSnapshot){if(typeof window==='undefined')return;if(publicSite&&publicSite.version>snapshot.version)return;publicSite=snapshot;window.dispatchEvent(new Event(PUBLIC_SITE_EVENT));}
export async function refreshServerSite(): Promise<PublicSiteSnapshot | null> {
 if (demoMode || typeof window === 'undefined') return null;
 if (currentRequest) return currentRequest;
 currentRequest = apiClient.request<PublicSiteSnapshot>('/site').then(snapshot => {
  if (!Array.isArray(snapshot.publications) || !Array.isArray(snapshot.forms)) throw new Error('Invalid public site snapshot');
  publicSite = snapshot;
  window.dispatchEvent(new Event(PUBLIC_SITE_EVENT));
  return snapshot;
 }).finally(() => { currentRequest = null; });
 return currentRequest;
}
export function subscribeServerSite(listener: () => void) {
 window.addEventListener(PUBLIC_SITE_EVENT, listener);
 return () => window.removeEventListener(PUBLIC_SITE_EVENT, listener);
}
