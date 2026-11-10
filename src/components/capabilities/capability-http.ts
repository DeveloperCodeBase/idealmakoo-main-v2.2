export class CapabilityError extends Error {constructor(public status:number,public code:string){super(code);}}
export async function capabilityRequest<T>(path:string,options:{method?:'GET'|'POST'|'PATCH'|'DELETE';body?:unknown;csrf?:string;survey?:boolean;version?:number;signal?:AbortSignal}={}):Promise<T>{
  const headers=new Headers({Accept:'application/json'});
  if(options.body!==undefined)headers.set('Content-Type','application/json');
  if(options.csrf)headers.set(options.survey?'X-Survey-CSRF':'X-Communication-CSRF',options.csrf);
  if(options.version!==undefined)headers.set('If-Match',String(options.version));
  const response=await fetch(path,{method:options.method||'GET',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers,signal:options.signal,body:options.body===undefined?undefined:JSON.stringify(options.body)});
  const value:unknown=await response.json();
  if(!response.ok){const body=value&&typeof value==='object'?value as Record<string,unknown>:{};throw new CapabilityError(response.status,typeof body.code==='string'?body.code:'REQUEST_FAILED');}
  return value as T;
}
export function safeCapabilityLink(input:string,locale:string):string|null{
  try{const origin=typeof window==='undefined'?'https://capability.invalid':window.location.origin;const url=new URL(input,origin);return url.origin===origin&&url.pathname.startsWith('/'+locale+'/')&&!/[\\\u0000-\u0020\u007f]/.test(input)?url.pathname+url.search+url.hash:null;}catch{return null;}
}
