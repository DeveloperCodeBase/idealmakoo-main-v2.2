'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useApp} from '@/components/providers/AppProvider';
import {apiClient,demoMode,networkError} from '@/lib/api';
import type {PublicUploadPolicy} from '@/lib/upload-policy';

export const UPLOAD_POLICY_EVENT='idealmakoo:upload-policy';
/** No browser persistence or cross-account policy cache. Responses from an old
 * account/unmounted editor cannot enable a newly opened uploader. */
export function useUploadPolicy() {
 const {session,sessionReady,locale}=useApp();
 const [policy,setPolicy]=useState<PublicUploadPolicy|null>(null),[error,setError]=useState('');
 const current=useRef(0),controller=useRef<AbortController|null>(null);
 const refresh=useCallback(async()=>{
  const sequence=++current.current;controller.current?.abort();const request=new AbortController();controller.current=request;
  try {const value=await apiClient.request<PublicUploadPolicy>('/media/policy',{signal:request.signal});if(sequence===current.current){setPolicy(value);setError('');}return value;}
  catch(cause){if(sequence===current.current&&!request.signal.aborted)setError(networkError(cause,locale));throw cause;}
 },[locale]);
 useEffect(()=>{
  current.current++;controller.current?.abort();setPolicy(null);setError('');
  if(demoMode||!sessionReady)return;
  const load=()=>void refresh().catch(()=>{});load();
  window.addEventListener('focus',load);window.addEventListener(UPLOAD_POLICY_EVENT,load);
  return()=>{current.current++;controller.current?.abort();window.removeEventListener('focus',load);window.removeEventListener(UPLOAD_POLICY_EVENT,load);};
 },[session?.id,session?.role,sessionReady,refresh]);
 return{policy,error,refresh};
}
