import { ProxyAgent } from "undici";

const filteredHosts = new Set(["api.telegram.org", "generativelanguage.googleapis.com"]);
let dispatcher: ProxyAgent | null | undefined;

function proxyDispatcher() {
  if (dispatcher !== undefined) return dispatcher;
  const endpoint = process.env.SELECTIVE_UPSTREAM_PROXY_URL || "";
  if (!endpoint) throw new Error("Selective provider proxy is not configured.");
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.hostname !== "xray" || url.port !== "10809" || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Selective provider proxy configuration is invalid.");
  dispatcher = new ProxyAgent(endpoint);
  return dispatcher;
}

export function filteredFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  let hostname = "";
  try { hostname = new URL(url).hostname.toLowerCase(); } catch { return fetch(input, init); }
  if (!filteredHosts.has(hostname)) return fetch(input, init);
  return fetch(input, { ...init, dispatcher: proxyDispatcher() } as RequestInit & { dispatcher: ProxyAgent });
}
