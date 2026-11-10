/** Capability pages deliberately render without account/session bootstrap. */
const names=new Set(['feedback','saved-share','communication-preferences','communication-unsubscribe','communication-verification']);
export function isPublicCapabilityPath(pathname:string):boolean {
 try{pathname=decodeURIComponent(pathname);}catch{return false;}
 const parts=pathname.split('/').filter(Boolean);
 return parts.length>=2&&['fa','en','tr','ar','ru'].includes(parts[0])&&names.has(parts[1]);
}
