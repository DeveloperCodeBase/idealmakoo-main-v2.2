/** A missing API policy fails closed; route-specific preview/file policies win. */
export const DEFAULT_API_CONTENT_SECURITY_POLICY="default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox";

export function withApiSecurityHeaders(response:Response):Response {
  const headers=new Headers(response.headers);
  if(!headers.has('Content-Security-Policy'))headers.set('Content-Security-Policy',DEFAULT_API_CONTENT_SECURITY_POLICY);
  headers.set('X-Content-Type-Options','nosniff');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
