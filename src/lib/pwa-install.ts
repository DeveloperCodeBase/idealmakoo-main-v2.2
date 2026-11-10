/** The browser can offer installation before the user opens the install guide.
 * Retain that one-use event across client navigation, never in persistent storage. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
}
interface InstallState {canInstall: boolean; installed: boolean}
const initialState: InstallState = {canInstall: false, installed: false};
let state = initialState;
let pendingPrompt: InstallPromptEvent | null = null;
let promptLocale: string | null = null;
const subscribers = new Set<() => void>();

function publish(installed = state.installed) {
  const canInstall = !!pendingPrompt && !installed;
  if (state.installed === installed && state.canInstall === canInstall) return;
  state = {canInstall, installed};
  subscribers.forEach(listener => listener());
}

export const readPwaInstallState = () => state;
export const initialPwaInstallState = () => initialState;
export function subscribePwaInstall(listener: () => void) {
  subscribers.add(listener);
  return () => {subscribers.delete(listener);};
}

export function syncPwaInstallLocale(locale: string) {
  if (pendingPrompt && promptLocale !== locale) {
    pendingPrompt = null;
    promptLocale = null;
    publish();
  }
}

export function bindPwaInstallation(browser: Window) {
  const displayMode = browser.matchMedia('(display-mode: standalone)');
  const isStandalone = () => displayMode.matches || (browser.navigator as Navigator & {standalone?: boolean}).standalone === true;
  publish(state.installed || isStandalone());
  const capture = (event: Event) => {
    const prompt = event as InstallPromptEvent;
    if (typeof prompt.prompt !== 'function' || !prompt.userChoice || typeof prompt.userChoice.then !== 'function') return;
    event.preventDefault();
    pendingPrompt = prompt;
    promptLocale = browser.location.pathname.split('/')[1] || null;
    publish();
  };
  const installed = () => {pendingPrompt = null; promptLocale = null; publish(true);};
  const displayChanged = () => {if (isStandalone()) installed();};
  browser.addEventListener('beforeinstallprompt', capture);
  browser.addEventListener('appinstalled', installed);
  displayMode.addEventListener('change', displayChanged);
  return () => {
    browser.removeEventListener('beforeinstallprompt', capture);
    browser.removeEventListener('appinstalled', installed);
    displayMode.removeEventListener('change', displayChanged);
  };
}

/** Must be called directly from the install button's user gesture. The browser
 * only permits a retained prompt once, including when it is dismissed. */
export async function requestPwaInstallation(locale?: string) {
  if (locale) syncPwaInstallLocale(locale);
  const event = pendingPrompt;
  if (!event || state.installed) return null;
  pendingPrompt = null;
  promptLocale = null;
  publish();
  await event.prompt();
  return event.userChoice;
}
