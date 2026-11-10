'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ApiError,apiClient,networkError} from '@/lib/api';

/** Mount these panels with an account/role/locale key. Late private responses are discarded. */
export function useControlledApi(locale:string){
 const mounted=useRef(true),controllers=useRef(new Set<AbortController>()),running=useRef(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[conflict,setConflict]=useState(false);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;for(const controller of controllers.current)controller.abort();controllers.current.clear();};},[]);
 const alive=useCallback(()=>mounted.current,[]);
 const request=useCallback(async<T,>(path:string,options:RequestInit={}):Promise<T>=>{
  if(!mounted.current)throw new DOMException('Panel changed','AbortError');
  const controller=new AbortController();controllers.current.add(controller);
  try{const signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;const result=await apiClient.request<T>(path,{...options,signal});if(!mounted.current)throw new DOMException('Panel changed','AbortError');return result;}finally{controllers.current.delete(controller);}
 },[]);
 const blob=useCallback(async(path:string,options:RequestInit={}):Promise<Blob>=>{
  if(!mounted.current)throw new DOMException('Panel changed','AbortError');
  const controller=new AbortController();controllers.current.add(controller);
  try{const signal=options.signal?AbortSignal.any([controller.signal,options.signal]):controller.signal;const result=await apiClient.blob(path,{...options,signal});if(!mounted.current)throw new DOMException('Panel changed','AbortError');return result;}finally{controllers.current.delete(controller);}
 },[]);
 const fail=useCallback((reason:unknown)=>{if(!mounted.current||reason instanceof DOMException&&reason.name==='AbortError')return;setError(networkError(reason,locale));if(reason instanceof ApiError&&(reason.status===409||reason.status===412))setConflict(true);},[locale]);
 const run=useCallback(async(action:()=>Promise<void>)=>{if(!mounted.current||running.current)return;running.current=true;setBusy(true);setError('');try{await action();}catch(reason){fail(reason);}finally{running.current=false;if(mounted.current)setBusy(false);}},[fail]);
 const reset=useCallback(()=>{if(mounted.current){setError('');setConflict(false);}},[]);
 return{request,blob,alive,busy,error,conflict,fail,run,reset};
}

export function downloadControlledBlob(blob:Blob,name:string){
 const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name.replace(/[\\/\u0000-\u001f\u007f]/g,'_').slice(0,180)||'document';anchor.rel='noopener';document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),30_000);
}
export function localDateInput(iso:string){const date=new Date(iso);return Number.isFinite(date.getTime())?new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16):'';}
export function isoDateInput(value:string){const parsed=new Date(value);if(!Number.isFinite(parsed.getTime()))throw new Error('Choose a valid date');return parsed.toISOString();}

export function controlledAccountKey(session:{id?:string;role?:string;allowedLocales?:readonly string[];qualityScope?:boolean;crmAccess?:unknown;mfaEnabled?:boolean;emailVerified?:boolean;mfaEnrollmentRequired?:boolean}|null|undefined,locale:string){
 return JSON.stringify([locale,session?.id,session?.role,session?.allowedLocales,session?.qualityScope,session?.crmAccess,session?.mfaEnabled,session?.emailVerified,session?.mfaEnrollmentRequired]);
}
