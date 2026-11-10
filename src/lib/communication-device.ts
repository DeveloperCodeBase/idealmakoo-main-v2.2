import type {Locale} from './i18n';

/** The SDK is confined to a dedicated public document. No token enters storage. */
export function pickNajvaDevice(locale:Locale,signal?:AbortSignal):Promise<string>{
  if(typeof window==='undefined'||signal?.aborted)return Promise.reject(new Error('DEVICE_CANCELLED'));
  const nonce=crypto.randomUUID();
  const popup=window.open(`/${locale}/communication-verification/device/#nonce=${nonce}`,'_blank','popup,width=560,height=680');
  if(!popup)return Promise.reject(new Error('POPUP_BLOCKED'));
  return new Promise((resolve,reject)=>{
    let finished=false;
    const finish=(token?:string,code='DEVICE_CANCELLED')=>{
      if(finished)return;finished=true;
      window.removeEventListener('message',receive);signal?.removeEventListener('abort',cancel);
      clearInterval(closed);clearTimeout(timeout);
      try{popup.close();}catch{/* Window may already be closed. */}
      if(token)resolve(token);else reject(new Error(code));
    };
    const receive=(event:MessageEvent<unknown>)=>{
      if(event.origin!==window.location.origin||event.source!==popup||!event.data||typeof event.data!=='object')return;
      const data=event.data as Record<string,unknown>;
      if(data.type!=='idealmakoo:push-device'||data.nonce!==nonce)return;
      if(typeof data.token==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(data.token))finish(data.token.toLowerCase());
      else if(data.error===true)finish(undefined,'DEVICE_UNAVAILABLE');
    };
    const cancel=()=>finish();
    const closed=setInterval(()=>{if(popup.closed)finish();},500);
    const timeout=setTimeout(()=>finish(undefined,'DEVICE_TIMEOUT'),120000);
    window.addEventListener('message',receive);signal?.addEventListener('abort',cancel,{once:true});
  });
}
