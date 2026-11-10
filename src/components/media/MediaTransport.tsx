'use client';
import {useEffect,useRef,useState} from 'react';
import {Download,Eye} from 'lucide-react';
import {mediaAssetApiPath} from '@/lib/dam-client';
import {c} from '@/components/controlled/copy';
import {downloadControlledBlob,useControlledApi} from '@/components/controlled/useControlledApi';
import styles from '@/components/controlled/controlled.module.css';
import {mt} from './media-copy';

export interface DownloadableMedia {id:string;url:string;filename:string;bytes?:number;mimeType?:string;sha256?:string}
export async function readMediaBlob(api:Pick<ReturnType<typeof useControlledApi>,'blob'|'alive'>,asset:DownloadableMedia,locale:string){
 const path=mediaAssetApiPath(asset.id,asset.url);if(!path)throw new Error(mt(locale,'unavailable'));
 const blob=await api.blob(path),mime=blob.type.split(';')[0].trim().toLowerCase();
 if(!blob.size||mime==='application/json'||mime==='text/html'||asset.bytes!==undefined&&blob.size!==asset.bytes||asset.mimeType&&mime!==asset.mimeType.split(';')[0].toLowerCase())throw new Error(mt(locale,'unavailable'));
 if(asset.sha256){
  if(!/^[a-f0-9]{64}$/i.test(asset.sha256))throw new Error(mt(locale,'unavailable'));
  const digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());
  if([...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('')!==asset.sha256.toLowerCase())throw new Error(mt(locale,'unavailable'));
 }
 if(!api.alive())throw new DOMException('Panel changed','AbortError');
 return blob;
}
export default function AuthorizedMediaPreview(props:{asset:DownloadableMedia;locale:string;enabled:boolean;title?:string;downloadOnly?:boolean}){
 return <Preview key={`${props.asset.id}:${props.asset.mimeType}:${props.asset.sha256}`} {...props}/>;
}
function Preview({asset,locale,enabled,title,downloadOnly=false}:{asset:DownloadableMedia;locale:string;enabled:boolean;title?:string;downloadOnly?:boolean}){
 const api=useControlledApi(locale),[preview,setPreview]=useState<{url:string;type:string;text?:string}|null>(null),current=useRef(enabled);current.current=enabled;
 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url);},[preview]);
 useEffect(()=>{if(!enabled)setPreview(null);},[enabled]);
 const get=async()=>{const blob=await readMediaBlob(api,asset,locale);if(!current.current)throw new DOMException('Access changed','AbortError');return blob;};
 const view=()=>void api.run(async()=>{const blob=await get();const type=blob.type.split(';')[0];const text=type==='text/vtt'?await blob.text():undefined;if(!api.alive()||!current.current)return;setPreview({url:URL.createObjectURL(blob),type,text});});
 const canPreview=!!asset.mimeType&&(/^(image|video|audio)\//.test(asset.mimeType)||['application/pdf','text/vtt'].includes(asset.mimeType));
 return <div className={styles.list}>
  {api.error&&<p className={styles.error} role="alert">{api.error}</p>}
  <div className={styles.row}><button type="button" className="btn" disabled={!enabled||api.busy} onClick={()=>void api.run(async()=>downloadControlledBlob(await get(),asset.filename))}><Download size={16}/>{c(locale,'download')}</button>{!downloadOnly&&canPreview&&<button type="button" className="btn" disabled={!enabled||api.busy} onClick={view}><Eye size={16}/>{mt(locale,'preview')}</button>}{preview&&<button type="button" className="btn" onClick={()=>setPreview(null)}>{mt(locale,'closePreview')}</button>}</div>
  {!enabled&&<p className={styles.muted}>{mt(locale,'unavailable')}</p>}
  {enabled&&preview&&(preview.type.startsWith('image/')?<img src={preview.url} alt={title||asset.filename} style={{maxWidth:'100%',maxHeight:520,objectFit:'contain',borderRadius:12}}/>:preview.type.startsWith('video/')?<video controls preload="metadata" src={preview.url} aria-label={title||asset.filename} style={{width:'100%',maxHeight:520}}/>:preview.type.startsWith('audio/')?<audio controls preload="metadata" src={preview.url} aria-label={title||asset.filename}/>:preview.type==='application/pdf'?<iframe title={title||asset.filename} className={styles.preview} src={preview.url} sandbox=""/>:preview.type==='text/vtt'?<pre className={styles.code} style={{maxHeight:400,overflow:'auto',whiteSpace:'pre-wrap'}}>{preview.text}</pre>:null)}
 </div>;
}
