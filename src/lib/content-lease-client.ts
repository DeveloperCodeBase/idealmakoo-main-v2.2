interface HeldLease {token:string;until:number}
const held=new Map<string,HeldLease>();
export function holdContentLease(key:string,token:string,leaseUntil:string){if(!/^[a-f0-9]{64}$/.test(token)||!Number.isFinite(Date.parse(leaseUntil)))throw new Error('Invalid editing lease');held.set(key,{token,until:Date.parse(leaseUntil)});}
export function dropContentLease(key:string){held.delete(key);}
export function clearContentLeases(){held.clear();}
export function contentLeaseHeaders():Record<string,string>{const tokens:string[]=[];for(const [key,lease] of held){if(lease.until<=Date.now())held.delete(key);else if(tokens.length<20)tokens.push(lease.token);}return tokens.length?{'X-Content-Leases':tokens.join(',')}:{};}
