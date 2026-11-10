'use client';
import {useEffect,useRef,useState} from 'react';
import type {Locale} from '@/lib/i18n';
import type {ChannelCapabilities} from '@/types/communication-capabilities';
import {CapabilityFrame} from './CapabilityForms';
import {capabilityText as text} from './capability-copy';

interface NajvaApi {getUserToken?:()=>unknown;najvaUserSubscribed?:(token:unknown)=>void}
type NajvaWindow=Window&{NAJVA?:NajvaApi};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

/** Only this exact route can load the operator-configured official SDK. */
export default function NajvaDevicePicker({locale,capabilities}:{locale:Locale;capabilities:ChannelCapabilities}){
  const[nonce,setNonce]=useState<string|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const alive=useRef(true),cancel=useRef<(()=>void)|null>(null);
  useEffect(()=>{alive.current=true;const value=new URLSearchParams(window.location.hash.slice(1)).get('nonce');setNonce(value&&uuid.test(value)&&window.opener?value:null);setReady(true);if(window.location.hash)window.history.replaceState(null,'',window.location.pathname+window.location.search);return()=>{alive.current=false;cancel.current?.();};},[]);
  async function connect(){
    if(!nonce||!window.opener||!capabilities.push.verification||!capabilities.pushSdkUrl)return;
    setBusy(true);setError('');
    try{
      if(!window.isSecureContext||!('Notification'in window)||!('serviceWorker'in navigator))throw new Error('DEVICE_UNAVAILABLE');
      const permission=Notification.permission==='granted'?'granted':await Notification.requestPermission();
      if(permission!=='granted')throw new Error('PERMISSION_DENIED');
      const url=new URL(capabilities.pushSdkUrl);
      if(url.protocol!=='https:'||url.username||url.password||!/(^|\.)najva\.com$/.test(url.hostname))throw new Error('DEVICE_UNAVAILABLE');
      const token=await new Promise<string>((resolve,reject)=>{
        const host=window as NajvaWindow;host.NAJVA||={};
        const previous=host.NAJVA.najvaUserSubscribed;
        let settled=false;let poll:ReturnType<typeof setInterval>|undefined;
        const script=document.createElement('script');script.src=url.href;script.async=true;script.referrerPolicy='no-referrer';
        const finish=(value?:string)=>{if(settled)return;settled=true;clearTimeout(timeout);if(poll)clearInterval(poll);if(host.NAJVA?.najvaUserSubscribed===receive)host.NAJVA.najvaUserSubscribed=previous;script.remove();cancel.current=null;value?resolve(value):reject(new Error('DEVICE_UNAVAILABLE'));};
        const receive=(value:unknown)=>{if(typeof value==='string'&&uuid.test(value))finish(value.toLowerCase());};
        host.NAJVA.najvaUserSubscribed=receive;
        const timeout=setTimeout(()=>finish(),30000);cancel.current=()=>finish();
        let reading=false;
        const read=async()=>{if(reading||settled)return;reading=true;try{if(host.NAJVA?.getUserToken)receive(await host.NAJVA.getUserToken());}catch{/* Wait for the bounded subscription callback. */}finally{reading=false;}};
        script.onerror=()=>finish();script.onload=()=>{void read();poll=setInterval(()=>void read(),500);};
        document.head.append(script);
      });
      if(!alive.current)return;
      window.opener.postMessage({type:'idealmakoo:push-device',nonce,token},window.location.origin);
      setBusy(false);
    }catch{if(alive.current){setError(text('blocked',locale));setBusy(false);}}
  }
  return <CapabilityFrame locale={locale} title={text('device',locale)}><section className="glass capability-card"><p>{text('deviceHint',locale)}</p>{!capabilities.push.verification?<p role="status">{text('disabled',locale)}</p>:!ready?<p role="status">{text('loading',locale)}</p>:!nonce?<p>{text('deviceStart',locale)}</p>:<button className="btn btn-primary" type="button" disabled={busy} onClick={()=>void connect()}>{busy?text('loading',locale):text('allowDevice',locale)}</button>}{error&&<p className="capability-error" role="alert">{error}</p>}</section></CapabilityFrame>;
}
