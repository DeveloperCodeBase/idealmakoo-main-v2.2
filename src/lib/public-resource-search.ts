'use client';
import {useEffect,useState} from 'react';
import {apiClient,demoMode,networkError} from './api';
import type {Locale} from './i18n';
import type {PublicResourceSearchResult} from '@/types/resources';

export function usePublicResourceSearch(query:string,open:boolean,locale:Locale,sessionReady:boolean,actorId:string|null){
  const key=JSON.stringify([locale,actorId,query.trim(),open,sessionReady]), [state,setState]=useState<PublicResourceSearchResult&{key:string;loading:boolean;error:string}>({key:'',items:[],truncated:false,loading:false,error:''});
  useEffect(()=>{
    if(!open||demoMode||!sessionReady)return;
    let active=true,controller:AbortController|null=null;
    const read=async()=>{
      controller?.abort();controller=new AbortController();const signal=controller.signal;
      // Clear prior results before checking current rights again.
      setState({key,items:[],truncated:false,loading:true,error:''});
      try{const params=new URLSearchParams({locale,q:query.trim(),limit:'12'});const result=await apiClient.request<PublicResourceSearchResult>(`/public/resource-search?${params}`,{signal});if(active&&!signal.aborted)setState({...result,key,loading:false,error:''});}
      catch(error){if(active&&!signal.aborted)setState({key,items:[],truncated:false,loading:false,error:networkError(error,locale)});}
    };
    const delay=window.setTimeout(()=>void read(),180),timer=window.setInterval(()=>{if(document.visibilityState!=='hidden')void read();},30_000),focus=()=>void read();
    window.addEventListener('focus',focus);
    return()=>{active=false;controller?.abort();clearTimeout(delay);clearInterval(timer);window.removeEventListener('focus',focus);};
  },[key,locale,query,open,sessionReady,actorId]);
  return !open||demoMode?{items:[],truncated:false,loading:false,error:''}:state.key===key?state:{items:[],truncated:false,loading:true,error:''};
}
