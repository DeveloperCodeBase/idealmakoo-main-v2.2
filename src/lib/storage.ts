export function readStore<T>(key:string,fallback:T):T {
 if(typeof window==='undefined')return fallback;
 try{const value=window.localStorage.getItem(key);if(!value)return fallback;const parsed:unknown=JSON.parse(value);if(parsed===null)return fallback;if(Array.isArray(fallback)&&!Array.isArray(parsed))return fallback;if(fallback!==null&&typeof fallback!==typeof parsed)return fallback;return parsed as T;}catch{return fallback;}
}
export function writeStore<T>(key:string,value:T):boolean{
 try{window.localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new CustomEvent('idealmakoo:store',{detail:{key}}));return true;}catch{return false;}
}
export function makeId(prefix='IM'){return `${prefix}-${new Date().getFullYear()}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;}
export function downloadBlob(blob:Blob,name:string){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function downloadJson(value:unknown,name:string){downloadBlob(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),name);}
export function safeCsvCell(value:unknown){const v=String(value??'');return '"'+(/^[=+@\-\t\r]/.test(v)?"'"+v:v).replaceAll('"','""')+'"';}
export function exportCsv(rows:unknown[][],name:string){downloadBlob(new Blob(['\uFEFF'+rows.map(row=>row.map(safeCsvCell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),name);}
export async function copyText(text:string){if(navigator.clipboard)await navigator.clipboard.writeText(text);else{const el=document.createElement('textarea');el.value=text;document.body.append(el);el.select();document.execCommand('copy');el.remove();}}
