/** Keep account deep links through sign-in without accepting external redirects. */
export function safeAccountReturn(value: unknown, locale: string): string {
  if (typeof value !== 'string' || value.length > 1200 || !['fa','en','tr','ar','ru'].includes(locale)) return '';
  if (!value.startsWith(`/${locale}/account`) || /[\\\s\u0000-\u001f\u007f]/.test(value)) return '';
  try {
    const url = new URL(value, 'https://account.invalid');
    if (url.origin !== 'https://account.invalid' || url.hash || !new RegExp(`^/${locale}/account(?:/(profile|preferences|organizations|requests|quick-matrix|saved|notifications|security))?/?$`).test(url.pathname)) return '';
    const params = new URLSearchParams();
    for (const [key, token] of url.searchParams) {
      if (params.has(key)) return '';
      if (key === 'invite' && /\/organizations\/?$/.test(url.pathname) && /^[A-Za-z0-9_-]{20,200}$/.test(token)) params.set(key,token);
      else if (key === 'verify' && /\/security\/?$/.test(url.pathname) && /^[A-Za-z0-9_-]{20,200}$/.test(token)) params.set(key,token);
      else if (key === 'id' && /\/requests\/?$/.test(url.pathname) && /^[A-Za-z0-9_-]{1,160}$/.test(token)) params.set(key,token);
      else return '';
    }
    return url.pathname.replace(/\/?$/, '/') + (params.size ? '?' + params.toString() : '');
  } catch { return ''; }
}

export function withAccountReturn(path: string, returnTo: string): string {
  return returnTo ? `${path}?returnTo=${encodeURIComponent(returnTo)}` : path;
}
