'use client';
import {useEffect} from 'react';
import {usePathname} from 'next/navigation';
import {isPublicCapabilityPath} from '@/lib/private-capabilities';
import {bindPwaInstallation,syncPwaInstallLocale} from '@/lib/pwa-install';

export default function PwaRuntime(){
  const pathname=usePathname();
  useEffect(()=>bindPwaInstallation(window),[]);
  useEffect(()=>syncPwaInstallLocale(pathname.split('/')[1]),[pathname]);
  useEffect(()=>{
    if(isPublicCapabilityPath(pathname)||!('serviceWorker' in navigator)||!window.isSecureContext||/^\/(?:admin|api)(?:\/|$)|^\/(?:fa|en|tr|ar|ru)\/(?:admin|account|auth)(?:\/|$)/.test(pathname))return;
    let cancelled=false;
    const timer=window.setTimeout(()=>{void(async()=>{
      const registration=await navigator.serviceWorker.getRegistration('/');
      const managed=[registration?.active,registration?.waiting,registration?.installing].some(worker=>{
        if(!worker)return false;
        try{const url=new URL(worker.scriptURL);return url.origin===window.location.origin&&url.pathname==='/najva-messaging-sw.js';}catch{return false;}
      });
      if(cancelled||managed)return;
      await navigator.serviceWorker.register('/service-worker.js',{type:'module',scope:'/'});
    })().catch(()=>{/* Offline caching is optional; normal online operation remains available. */});},2000);
    return()=>{cancelled=true;window.clearTimeout(timer);};
  },[pathname]);
  return null;
}
