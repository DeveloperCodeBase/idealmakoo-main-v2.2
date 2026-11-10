/* Reconstructed from the project runtime cache and retained source. Validation is recorded in the release report. */

export interface NajvaCspEnvironment { [name: string]: string | undefined; NAJVA_SCRIPT_ORIGINS?: string; NAJVA_CONNECT_ORIGINS?: string }
function najvaOrigins(value?: string): string[] | null {
    if (!value?.trim())
        return [];
    if (value.length > 2048)
        return null;
    const items = value.trim().split(/[\s,]+/);
    if (items.length > 8)
        return null;
    const result = new Set<string>();
    for (const item of items) {
        let url;
        try {
            url = new URL(item);
        }
        catch {
            return null;
        }
        if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*najva\.com$/.test(url.hostname))
            return null;
        result.add(url.origin);
    }
    return [...result].sort();
}
function najvaCspConfiguration(environment: NajvaCspEnvironment) { const scriptOrigins = najvaOrigins(environment.NAJVA_SCRIPT_ORIGINS), connectOrigins = najvaOrigins(environment.NAJVA_CONNECT_ORIGINS); return scriptOrigins && connectOrigins ? { valid: true, scriptOrigins, connectOrigins } : { valid: false, scriptOrigins: [], connectOrigins: [] }; }
/** The proxy supplies a fresh 192-bit nonce; caller-supplied header values are never used. */
function contentSecurityPolicy(environment: NajvaCspEnvironment = {}, allowNajva = false, nonce?: string) {
    if (nonce !== undefined && !/^[A-Za-z0-9+/]{32}$/.test(nonce))
        throw new Error('Invalid document security nonce.');
    const configured = najvaCspConfiguration(environment);
    const scripts = allowNajva && configured.valid ? configured.scriptOrigins : [];
    const connections = allowNajva && configured.valid ? configured.connectOrigins : [];
    return [
        "default-src 'self'", "base-uri 'self'", "object-src 'none'",
        "frame-ancestors 'self'", "form-action 'self'",
        ["script-src 'self'", ...(nonce ? [`'nonce-${nonce}'`, "'strict-dynamic'"] : []),
            ...(environment.NODE_ENV === 'development' ? ["'unsafe-eval'"] : []), ...scripts].join(' '),
        "script-src-attr 'none'",
        // React and the preserved site design intentionally use inline styles.
        "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:",
        "font-src 'self' data:", ["connect-src 'self'", ...connections].join(' '),
        "media-src 'self' blob: https:", "frame-src 'self' blob:", "worker-src 'self'",
    ].join('; ');
}
/** Workers cannot inherit an HTML nonce. Their imports stay on explicit origins. */
function workerContentSecurityPolicy(environment: NajvaCspEnvironment = {}, allowNajva = false) {
    const configured = najvaCspConfiguration(environment);
    const scripts = allowNajva && configured.valid ? configured.scriptOrigins : [];
    const connections = allowNajva && configured.valid ? configured.connectOrigins : [];
    return ["default-src 'none'", "base-uri 'none'", "object-src 'none'",
        ["script-src 'self'", ...scripts].join(' '),
        ["connect-src 'self'", ...connections].join(' '),
        "img-src 'self' https:", "worker-src 'self'"].join('; ');
}
const BASE_CONTENT_SECURITY_POLICY = contentSecurityPolicy();
export { BASE_CONTENT_SECURITY_POLICY, contentSecurityPolicy, workerContentSecurityPolicy, najvaCspConfiguration };
