'use client';
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ReactNode,type Dispatch,type SetStateAction} from 'react';
import {usePathname,useRouter} from 'next/navigation';
import {Check, X} from 'lucide-react';
import {direction,translate,type Locale} from '@/lib/i18n';
import {readStore,writeStore,makeId} from '@/lib/storage';
import {demoUsers,roles,roleLandingPath,type FrontSession} from '@/lib/auth';
import type {RoleKey} from '@/types/domain';
import type {InquiryLine,FrontRequest} from '@/types/frontend';
import {apiClient,apiRequests,dataMode,demoMode,ApiError,networkError,setCsrfToken,clearCsrfToken} from '@/lib/api';
import {isPublicCapabilityPath} from '@/lib/private-capabilities';
import {readGuestInquiry,writeGuestInquiry,type GuestInquiry} from '@/lib/guest-inquiry';
import {liveText} from '@/lib/live-copy';
import {readServerSite,refreshServerSite,type PublicSiteSnapshot} from '@/lib/server-runtime';
import {PublicSiteProvider,useInitialServerSite} from '@/lib/public-site-context';
import {publicLocaleDestination,localePublications} from '@/lib/publication-locales';
import {useSitePreferences} from '@/lib/site-preferences';
import {publicCopyOverride} from '@/lib/site-editorial-settings';
import type {Product} from '@/data/catalog';
import {parseFrontRequests,parseInquiryLines,inquiryIdentity} from '@/lib/frontend-state';
import {applyCustomerRequestPatch} from '@/components/account/portal-data';
import {getPublishedCatalog,getPublishedProductInventory,useCatalogProducts} from '@/lib/publications';
import {applyRouteLocale,localeFromPath,localizedPath} from '@/lib/locale-routing';
import {defaultUserSettings,readUserSettings,userSettingsKey,updateOwnUserSettings,type UserSettings,type UserProfile,type UserPreferences,type SaveSettingsResult} from '@/lib/user-settings';
import {applyDisplayPreferences} from '@/lib/display-preferences';
import {bindNavigationScroll,type NavigationScrollBinding} from '@/lib/navigation-scroll';
import {accountText} from '@/components/account/account-copy';
import PwaRuntime from './PwaRuntime';
import LiquidEffects from './LiquidEffects';
function readAppStore<T>(key:string,initial:T):T{
 const raw=readStore<unknown>(key,initial);
 if(key==='idealmakoo.session.v1'){const session=raw as FrontSession|null;return (session&&typeof session.id==='string'&&typeof session.email==='string'&&typeof session.name==='string'&&roles.includes(session.role)?session:null) as T;}
 if(Array.isArray(initial)){if(!Array.isArray(raw))return initial;
  if(key.includes('requests'))return parseFrontRequests(raw,getPublishedProductInventory()) as T;
  if(key.includes('inquiries'))return parseInquiryLines(raw,getPublishedProductInventory()) as T;
  return raw.filter(item=>typeof item==='string') as T;
 }
 return raw as T;
}
function usePersisted<T>(key:string,initial:T):[T,Dispatch<SetStateAction<T>>,boolean]{
 const [state,setState]=useState(initial);
 const [ready,setReady]=useState(false);
 useEffect(()=>{if(!demoMode){setReady(true);return;}const read=()=>{setState(readAppStore(key,initial));setReady(true);};read();const onStorage=(e:StorageEvent)=>{if(e.key===key||e.key===null)read();};const onLocal=(e:Event)=>{if((e as CustomEvent).detail?.key===key)read();};window.addEventListener('storage',onStorage);window.addEventListener('idealmakoo:store',onLocal);return()=>{window.removeEventListener('storage',onStorage);window.removeEventListener('idealmakoo:store',onLocal);};},[key]); // stable per provider
 const update=useCallback<Dispatch<SetStateAction<T>>>((action)=>{if(!demoMode){setState(action);return;}const current=readAppStore(key,initial);const next=typeof action==='function'?(action as (v:T)=>T)(current):action;if(!writeStore(key,next))throw new Error('Browser storage unavailable');setState(next);},[key]);
 return[state,update,ready];
}
interface CollectionDto {inquiries:InquiryLine[];compare:string[];saved:string[];collectionVersion:number;savedVersion:number;defaultWishlistId:string}
interface AppContextValue{
 locale:Locale;dir:'rtl'|'ltr';theme:'dark'|'light';setTheme:(theme:'dark'|'light')=>void;toggleTheme:()=>void;t:(key:string)=>string;
 pathname:string;href:(path?:string)=>string;switchLocale:(locale:Locale)=>void;notify:(message:string)=>void;role:RoleKey;setRole:(role:string)=>void;
 session:FrontSession|null;sessionReady:boolean;sessionError:string;acceptSession:(user:FrontSession,csrfToken?:string)=>void;signIn:(role:string,name?:string,email?:string)=>FrontSession|null;signOut:()=>Promise<void>;
 userSettings:UserSettings|null;settingsReady:boolean;settingsError:string;displayName:string;
 saveProfile:(patch:Partial<UserProfile>,expectedRevision?:number)=>Promise<SaveSettingsResult>;
 savePreferences:(patch:Partial<UserPreferences>,expectedRevision?:number)=>Promise<SaveSettingsResult>;
 catalog:Product[];savedVersion:number;defaultWishlistId:string;
 inquiries:InquiryLine[];setInquiries:(action:SetStateAction<InquiryLine[]>)=>Promise<boolean>;addInquiry:(productId:string,quantity?:number,options?:Partial<InquiryLine>)=>Promise<boolean>;
 compare:string[];setCompare:Dispatch<SetStateAction<string[]>>;toggleCompare:(id:string,family?:string)=>void;saved:string[];toggleSaved:(id:string)=>void;
 requests:FrontRequest[];requestsReady:boolean;requestsError:string;reloadRequests:()=>void;createRequest:(input:Omit<FrontRequest,'id'|'createdAt'>)=>Promise<FrontRequest>;updateRequest:(id:string,patch:Partial<FrontRequest>)=>Promise<boolean>;
}
const Context=createContext<AppContextValue|null>(null);
export function AppProvider(props:{children:ReactNode;locale:Locale;initialSite?:PublicSiteSnapshot}){return <PublicSiteProvider initialSite={props.initialSite}><AppProviderRuntime {...props}/></PublicSiteProvider>;}
function AppProviderRuntime({children,locale:layoutLocale}:{children:ReactNode;locale:Locale}){
 const initialSite=useInitialServerSite();
 const router=useRouter();const pathname=usePathname();const [theme,setThemeState]=useState<'dark'|'light'>('dark');
 const locale=localeFromPath(pathname)||layoutLocale;
 const publicTokenPage=isPublicCapabilityPath(pathname);
 const publicTokenRef=useRef(publicTokenPage);publicTokenRef.current=publicTokenPage;
 const navigationScroll=useRef<NavigationScrollBinding|null>(null);
 useEffect(()=>{const binding=bindNavigationScroll(document);navigationScroll.current=binding;return()=>{binding.destroy();navigationScroll.current=null;};},[]);
 useEffect(()=>{navigationScroll.current?.commit(pathname);},[pathname]);
 const catalog=useCatalogProducts(locale);
 const [session,setSession,localSessionReady]=usePersisted<FrontSession|null>('idealmakoo.session.v1',null);
 const [serverSessionReady,setServerSessionReady]=useState(false);
 const [authGeneration,setAuthGeneration]=useState(0);
 const authGenerationRef=useRef(0);
 const requestContextKey=JSON.stringify([session?.id||null,session?.role||null,locale,authGeneration]);
 const requestContextRef=useRef(requestContextKey);requestContextRef.current=requestContextKey;
 const contextCurrent=useCallback((context:string,generation:number)=>!publicTokenRef.current&&requestContextRef.current===context&&authGenerationRef.current===generation,[]);
 const requestSequence=useRef(0);
 const settingsSequence=useRef(0);
 const [sessionError,setSessionError]=useState('');
 const sessionReady=demoMode?localSessionReady:serverSessionReady;
 const [settingsState,setSettingsState]=useState<UserSettings|null>(null);
 const [settingsError,setSettingsError]=useState('');
 const identityRef=useRef<string|null>(session?.id||null);identityRef.current=session?.id||null;
 const [settingsOwner,setSettingsOwner]=useState<string|null|undefined>(undefined);
 const [settingsContext,setSettingsContext]=useState<string|null>(null);
 const [guestTheme,setGuestTheme]=useState<'dark'|'light'>('dark');
 const [systemDark,setSystemDark]=useState(true);
 const userSettings=session&&settingsState?.ownerId===session.id&&(demoMode||settingsContext===requestContextKey)?settingsState:null;
 const settingsReady=sessionReady&&settingsOwner===(session?.id||null)&&(demoMode||settingsContext===requestContextKey);
 const [inquiries,setInquiriesState]=usePersisted<InquiryLine[]>('idealmakoo.inquiries.v1',[]);
 const [compare,setCompareState]=usePersisted<string[]>('idealmakoo.compare.v1',[]);
 const [saved,setSavedState]=usePersisted<string[]>('idealmakoo.saved.v1',[]);
 const [requests,setRequests,localRequestsReady]=usePersisted<FrontRequest[]>('idealmakoo.requests.v1',[]);
 const [requestResolution,setRequestResolution]=useState<{context:string;status:'loading'|'ready'|'error';error:string}|null>(null);
 const currentRequestResolution=requestResolution?.context===requestContextKey?requestResolution:null;
 const requestsReady=demoMode?localRequestsReady&&sessionReady:sessionReady&&currentRequestResolution?.status==='ready';
 const requestsError=demoMode?'':currentRequestResolution?.status==='error'?currentRequestResolution.error:'';
 // A new identity/role never sees even one render of the prior actor's list.
 const visibleRequests=useMemo(()=>!publicTokenPage&&(demoMode||requestsReady)?requests:[],[publicTokenPage,requestsReady,requests]);
 const reloadRequests=useCallback(()=>{if(!publicTokenRef.current)window.dispatchEvent(new CustomEvent('idealmakoo:requests'));},[]);
 const [collectionMeta,setCollectionMeta]=useState({collectionVersion:0,savedVersion:0,defaultWishlistId:''});
 const [collectionOwner,setCollectionOwner]=useState<string|null>(null);
 const collectionReady=demoMode||sessionReady&&collectionOwner===requestContextKey;
 const visibleCollections=useMemo(()=>!publicTokenPage&&collectionReady?{inquiries,compare,saved}:{inquiries:[],compare:[],saved:[]},[publicTokenPage,collectionReady,inquiries,compare,saved]);
 const visibleCollectionMeta=useMemo(()=>!publicTokenPage&&collectionReady?collectionMeta:{collectionVersion:0,savedVersion:0,defaultWishlistId:''},[publicTokenPage,collectionReady,collectionMeta]);
 const metaRef=useRef(visibleCollectionMeta);metaRef.current=visibleCollectionMeta;
 const [guestMerge,setGuestMerge]=useState<{source:GuestInquiry;error:string;context:string}|null>(null);
 const mergeBusy=useRef<string|null>(null);const [merging,setMerging]=useState(false);
 const [toasts,setToasts]=useState<{id:string;message:string}[]>([]);
 const preferences=useSitePreferences();
 const t=useCallback((key:string)=>publicCopyOverride(preferences.uiText,locale,key)??liveText(key,locale)??translate(locale,key),[locale,preferences.uiText]);
 const notify=useCallback((message:string)=>{const id=makeId('toast');setToasts(list=>[...list.slice(-2),{id,message}]);setTimeout(()=>setToasts(list=>list.filter(toast=>toast.id!==id)),4500);},[]);
 useEffect(()=>{
  const media=window.matchMedia('(prefers-color-scheme: dark)');const readSystem=()=>setSystemDark(media.matches);readSystem();media.addEventListener('change',readSystem);
  const readGuest=()=>{try{setGuestTheme(localStorage.getItem('idealmakoo.theme')==='light'?'light':'dark');}catch{/* A guest can still use the current theme. */}};readGuest();
  const storage=(event:StorageEvent)=>{if(event.key==='idealmakoo.theme'||event.key===null)readGuest();};window.addEventListener('storage',storage);
  return()=>{media.removeEventListener('change',readSystem);window.removeEventListener('storage',storage);};
 },[]);
 const requestRef=useRef(visibleRequests);requestRef.current=visibleRequests;
 const collectionRef=useRef(visibleCollections);collectionRef.current=visibleCollections;
 const collectionQueue=useRef<Promise<unknown>>(Promise.resolve());
 const acceptCollection=useCallback((next:CollectionDto,context:string,generation:number)=>{
  if(!contextCurrent(context,generation))return false;
  const collection={inquiries:next.inquiries||[],compare:next.compare||[],saved:next.saved||[]};
  collectionRef.current=collection;setInquiriesState(collection.inquiries);setCompareState(collection.compare);setSavedState(collection.saved);
  const meta={collectionVersion:next.collectionVersion,savedVersion:next.savedVersion,defaultWishlistId:next.defaultWishlistId};
  metaRef.current=meta;setCollectionMeta(meta);setCollectionOwner(context);return true;
 },[contextCurrent,setInquiriesState,setCompareState,setSavedState]);
 const advanceAuth=useCallback(()=>{
  const generation=++authGenerationRef.current;setAuthGeneration(generation);
  requestSequence.current++;settingsSequence.current++;
  requestRef.current=[];collectionRef.current={inquiries:[],compare:[],saved:[]};metaRef.current={collectionVersion:0,savedVersion:0,defaultWishlistId:''};
  collectionQueue.current=Promise.resolve();setCollectionOwner(null);setRequestResolution(null);setSettingsContext(null);setSettingsState(null);setSettingsError('');
  mergeBusy.current=null;setGuestMerge(null);setMerging(false);
 },[]);
 const attemptGuestMerge=useCallback((source:GuestInquiry)=>{
  const owner=identityRef.current,context=requestContextRef.current,generation=authGenerationRef.current;
  if(!owner||source.userId&&source.userId!==owner||mergeBusy.current||!contextCurrent(context,generation))return Promise.resolve();
  const operation=crypto.randomUUID();mergeBusy.current=operation;setMerging(true);
  const task=collectionQueue.current.then(async()=>{
   if(!contextCurrent(context,generation)||identityRef.current!==owner)return;
   const bound={...source,userId:owner};
   try{
    if(!writeGuestInquiry(bound))throw new Error('Storage unavailable');
    setGuestMerge({source:bound,error:'',context});
    const result=await apiClient.request<{collection:CollectionDto;duplicate:boolean}>('/me/collection/merge',{method:'POST',body:JSON.stringify({id:bound.id,locale:bound.locale,items:bound.items})});
    if(!contextCurrent(context,generation)||identityRef.current!==owner)return;
    acceptCollection(result.collection,context,generation);
    if(readGuestInquiry()?.id===bound.id)writeGuestInquiry(null);setGuestMerge(null);
   }catch(error){if(contextCurrent(context,generation))setGuestMerge({source:bound,error:networkError(error,locale),context});}
  }).finally(()=>{if(mergeBusy.current===operation){mergeBusy.current=null;setMerging(false);}});
  collectionQueue.current=task.catch(()=>undefined);return task;
 },[acceptCollection,contextCurrent,locale]);
 const acceptSession=useCallback((user:FrontSession,token?:string)=>{advanceAuth();if(token)setCsrfToken(token);identityRef.current=user.id;setSession(user);setSessionError('');setServerSessionReady(true);},[advanceAuth,setSession]);
 useEffect(()=>{
  if(demoMode)return;
  if(publicTokenPage){
   // Capability links have their own authority. Drop the private client view
   // without changing the server cookie; a return must verify the session anew.
   advanceAuth();clearCsrfToken();identityRef.current=null;setSession(null);setSessionError('');setServerSessionReady(false);return;
  }
  let active=true;const generation=authGenerationRef.current;
  const current=()=>active&&!publicTokenRef.current&&authGenerationRef.current===generation;
  apiClient.request<{user:FrontSession|null;csrfToken:string}>('/auth/session').then(result=>{
   if(!current())return;advanceAuth();setCsrfToken(result.csrfToken);identityRef.current=result.user?.id||null;setSession(result.user);setSessionError('');setServerSessionReady(true);
  }).catch(error=>{if(current()){advanceAuth();clearCsrfToken();identityRef.current=null;setSession(null);setSessionError(networkError(error,locale));setServerSessionReady(true);}});
  const expired=()=>{advanceAuth();clearCsrfToken();identityRef.current=null;setSession(null);setSessionError('');setServerSessionReady(true);setRequests([]);setSettingsOwner(null);setInquiriesState([]);setCompareState([]);setSavedState([]);};
  window.addEventListener('idealmakoo:session-expired',expired);
  return()=>{active=false;window.removeEventListener('idealmakoo:session-expired',expired);};
 },[advanceAuth,setSession,setRequests,publicTokenPage]);
 useEffect(()=>{
  if(demoMode||publicTokenPage||!sessionReady)return;
  let active=true;
  const refresh=async(report:boolean)=>{
   for(let attempt=0;attempt<2;attempt++)try{await refreshServerSite();return;}catch(error){
    if(!active)return;
    // A refresh already pending for the prior identity can be shared by the
    // public snapshot adapter. Retry that discarded GET once for this actor.
    if(attempt===0&&error instanceof ApiError&&error.problem.title==='Account changed')continue;
    if(report)notify(networkError(error,locale));return;
   }
  };
  void refresh(true);const focus=()=>void refresh(false);window.addEventListener('focus',focus);
  return()=>{active=false;window.removeEventListener('focus',focus);};
 },[notify,publicTokenPage,sessionReady,session?.id,session?.role,authGeneration,locale]);
 useEffect(()=>{
  if(!sessionReady||publicTokenPage)return;
  let active=true;
  if(!demoMode){
   const context=requestContextKey,owner=session?.id||null,generation=authGeneration;
   const current=()=>active&&identityRef.current===owner&&contextCurrent(context,generation);
   setSettingsState(null);setSettingsOwner(undefined);setSettingsContext(null);setSettingsError('');setRequests([]);setInquiriesState([]);setCompareState([]);setSavedState([]);
   setCollectionOwner(null);setCollectionMeta({collectionVersion:0,savedVersion:0,defaultWishlistId:''});
   collectionRef.current={inquiries:[],compare:[],saved:[]};metaRef.current={collectionVersion:0,savedVersion:0,defaultWishlistId:''};collectionQueue.current=Promise.resolve();
   setRequestResolution({context,status:'loading',error:''});
   const loadRequests=async()=>{
    const sequence=++requestSequence.current;
    setRequestResolution(previous=>previous?.context===context&&previous.status==='ready'?previous:{context,status:'loading',error:''});
    try{const next=await apiRequests.list();if(current()&&requestSequence.current===sequence){setRequests(next);setRequestResolution({context,status:'ready',error:''});}}
    catch(error){if(current()&&requestSequence.current===sequence){setRequests([]);setRequestResolution({context,status:'error',error:networkError(error,locale)});}}
   };
   const refreshRequests=()=>{if(current())void loadRequests();};
   void loadRequests();window.addEventListener('idealmakoo:requests',refreshRequests);window.addEventListener('focus',refreshRequests);
   const stopRequests=()=>{active=false;window.removeEventListener('idealmakoo:requests',refreshRequests);window.removeEventListener('focus',refreshRequests);};
   if(!session){
    setSettingsOwner(null);setSettingsContext(context);const guest=readGuestInquiry();const items=guest&&!guest.userId?guest.items:[];
    collectionRef.current={inquiries:items,compare:[],saved:[]};setInquiriesState(items);setCollectionOwner(context);return stopRequests;
   }
   const settingsRead=++settingsSequence.current;
   void apiClient.request<UserSettings>('/me/settings').then(next=>{if(current()&&settingsSequence.current===settingsRead){setSettingsState(next);setSettingsOwner(session.id);setSettingsContext(context);}}).catch(error=>{if(current()&&settingsSequence.current===settingsRead){setSettingsOwner(session.id);setSettingsContext(context);setSettingsError(networkError(error,locale));notify(networkError(error,locale));}});
   const loadCollection=(merge:boolean)=>{
    const task=collectionQueue.current.then(async()=>{
     if(!current())return;
     try{const next=await apiClient.request<CollectionDto>('/me/collection');if(current()){
      acceptCollection(next,context,generation);
      const guest=merge?readGuestInquiry():null;
      if(guest?.items.length&&(!guest.userId||guest.userId===session.id))void attemptGuestMerge(guest);
     }}catch(error){if(current())notify(networkError(error,locale));}
    });collectionQueue.current=task.catch(()=>undefined);
   };
   loadCollection(true);const refreshCollection=()=>{if(current())loadCollection(false);};
   window.addEventListener('idealmakoo:wishlists',refreshCollection);
   return()=>{stopRequests();window.removeEventListener('idealmakoo:wishlists',refreshCollection);};
  }
  const key=session?userSettingsKey(session.id):null;
  const read=()=>{const next=session?readUserSettings(session,locale):null;setSettingsState(next);setSettingsOwner(session?.id||null);};read();
  const storage=(event:StorageEvent)=>{if(event.key===key||event.key===null)read();};
  const local=(event:Event)=>{if((event as CustomEvent).detail?.key===key)read();};
  window.addEventListener('storage',storage);window.addEventListener('idealmakoo:store',local);
  return()=>{active=false;window.removeEventListener('storage',storage);window.removeEventListener('idealmakoo:store',local);};
 },[session?.id,session?.role,sessionReady,authGeneration,locale,publicTokenPage,acceptCollection,attemptGuestMerge,contextCurrent]);
 const saveSettings=useCallback(async(kind:'profile'|'preferences',patch:Partial<UserProfile>|Partial<UserPreferences>,expectedRevision?:number):Promise<SaveSettingsResult>=>{
  if(!session)return {ok:false,reason:'session'};
  if(demoMode){const result=updateOwnUserSettings(session,kind,patch,expectedRevision??readUserSettings(session,locale).revision);if(result.ok){setSettingsState(result.settings);setSettingsOwner(session.id);}return result;}
  const context=requestContextKey,generation=authGeneration;
  const current=()=>identityRef.current===session.id&&contextCurrent(context,generation);
  if(!current())return {ok:false,reason:'session'};
  const accept=(next:UserSettings)=>{setSettingsState(previous=>previous?.ownerId===next.ownerId&&previous.revision>next.revision?previous:next);setSettingsOwner(session.id);setSettingsContext(context);setSettingsError('');};
  try{const next=await apiClient.request<UserSettings>(`/me/${kind}`,{method:'PATCH',headers:{'If-Match':String(expectedRevision??userSettings?.revision??0)},body:JSON.stringify(patch)});if(!current())return {ok:false,reason:'session'};settingsSequence.current++;accept(next);return {ok:true,settings:next};}
  catch(error){
   if(!current())return {ok:false,reason:'session'};
   if(error instanceof ApiError&&(error.status===409||error.status===412)){
    const sequence=++settingsSequence.current;const latest=await apiClient.request<UserSettings>('/me/settings').catch(()=>null);
    if(!current())return {ok:false,reason:'session'};
    if(latest&&settingsSequence.current===sequence)accept(latest);return {ok:false,reason:'conflict'};
   }
   return {ok:false,reason:error instanceof ApiError&&error.status===401?'session':error instanceof ApiError&&error.status===422?'validation':'storage'};
  }
 },[session,locale,userSettings?.revision,requestContextKey,authGeneration,contextCurrent]);
 const saveProfile=useCallback((patch:Partial<UserProfile>,revision?:number)=>saveSettings('profile',patch,revision),[saveSettings]);
 const savePreferences=useCallback((patch:Partial<UserPreferences>,revision?:number)=>saveSettings('preferences',patch,revision),[saveSettings]);
 const setTheme=useCallback((value:'dark'|'light')=>{
  if(session&&!publicTokenPage){void savePreferences({theme:value}).then(result=>{if(!result.ok)notify(accountText(locale,'storageError',t));});return;}
  setGuestTheme(value);try{localStorage.setItem('idealmakoo.theme',value);}catch{/* The guest theme remains usable. */}
 },[session,savePreferences,notify,locale,t,publicTokenPage]);
 const saveCollection=useCallback((key:'inquiries'|'compare'|'saved',action:unknown):Promise<boolean>=>{
  const owner=session?.id||null,context=requestContextKey,generation=authGeneration;
  const current=()=>identityRef.current===owner&&contextCurrent(context,generation);
  const task=collectionQueue.current.then(async()=>{
   if(!current())return false;
   try{
    const previous=collectionRef.current[key];const next=typeof action==='function'?(action as (value:typeof previous)=>typeof previous)(previous):action;
    if(!Array.isArray(next))throw new Error('Invalid collection');
    const update={...collectionRef.current,[key]:next};
    if(!demoMode&&session){
     const metadata=metaRef.current;if(key==='saved'?!metadata.savedVersion:!metadata.collectionVersion)throw new Error('Collection is still loading');
     const committed=await apiClient.request<CollectionDto>('/me/collection',{method:'PATCH',body:JSON.stringify({[key]:next,...(key==='saved'?{savedVersion:metadata.savedVersion,savedLocale:locale}:{collectionVersion:metadata.collectionVersion})})});
     if(!current())return false;acceptCollection(committed,context,generation);
    }else{
     if(!demoMode&&key==='inquiries'){
      if(next.length>500)throw new Error('The inquiry exceeds its allowed size');
      const source:GuestInquiry={schemaVersion:1,id:crypto.randomUUID(),locale,items:next as InquiryLine[],createdAt:new Date().toISOString()};
      if(!writeGuestInquiry(next.length?source:null))throw new Error('Browser storage unavailable');
     }
     collectionRef.current=update;setInquiriesState(update.inquiries);setCompareState(update.compare);setSavedState(update.saved);setCollectionOwner(context);
    }return true;
   }catch(error){if(current()){
    notify(networkError(error,locale));
    if(error instanceof ApiError&&[409,412].includes(error.status)&&owner){const fresh=await apiClient.request<CollectionDto>('/me/collection').catch(()=>null);if(fresh&&current())acceptCollection(fresh,context,generation);}
   }return false;}
  });collectionQueue.current=task.catch(()=>undefined);return task;
 },[session?.id,locale,notify,setInquiriesState,setCompareState,setSavedState,acceptCollection,requestContextKey,authGeneration,contextCurrent]);
 const setInquiries=useCallback((action:SetStateAction<InquiryLine[]>)=>saveCollection('inquiries',action),[saveCollection]);
 const setCompare=useCallback((action:SetStateAction<string[]>)=>{void saveCollection('compare',action);},[saveCollection]);
 const setSaved=useCallback((action:SetStateAction<string[]>)=>saveCollection('saved',action),[saveCollection]);
 useEffect(()=>{
  if(!settingsReady)return;
  const preferences=userSettings?.preferences||{...defaultUserSettings({id:'guest',name:'',email:'',role:'customer',demo:true},locale).preferences,theme:guestTheme};
  setThemeState(applyDisplayPreferences(preferences,systemDark));
 },[settingsReady,userSettings?.preferences,guestTheme,systemDark,locale]);
 useEffect(()=>{applyRouteLocale(document,locale);},[locale]);
 useEffect(()=>{if(!demoMode)return;const refresh=()=>setRequests(readAppStore<FrontRequest[]>('idealmakoo.requests.v1',[]));window.addEventListener('idealmakoo:requests',refresh);return()=>window.removeEventListener('idealmakoo:requests',refresh);},[setRequests]);
 const href=useCallback((path='')=>localizedPath(locale,path),[locale]);
 const signIn=useCallback((role:string,name?:string,email?:string)=>{if(!demoMode)return null;const user=demoUsers.find(u=>u.role===role);if(!user)return null;const normalizedEmail=email?.trim().toLowerCase();const next:FrontSession={id:normalizedEmail&&!normalizedEmail.endsWith('.invalid')?`local-${normalizedEmail}`:user.id,role:user.role,name:name||user.name,email:normalizedEmail||user.email,demo:true};setSession(next);const settings=readUserSettings(next,locale);const signedIn={...next,name:settings.profile.name};if(signedIn.name!==next.name)setSession(signedIn);applyDisplayPreferences(settings.preferences,window.matchMedia('(prefers-color-scheme: dark)').matches);setSettingsState(settings);setSettingsOwner(next.id);return signedIn;},[setSession,locale]);
 const setRole=useCallback((value:string)=>{if(!demoMode||session?.role!=='superAdmin'||!roles.includes(value as RoleKey)){notify(t('accessDenied'));return;}const next=signIn(value);if(next)router.replace(roleLandingPath(value,locale));notify(t('changedRole'));},[session?.role,signIn,router,notify,t,locale]);
 const switchLocale=useCallback((language:Locale)=>{
  const current=typeof window!=='undefined'?window.location.pathname+window.location.search+window.location.hash:pathname;
  const snapshot=readServerSite()||initialSite;
  const destination=publicLocaleDestination(snapshot?{...snapshot,publications:localePublications(snapshot.publications)}:undefined,language,current);
  if(destination===null){notify(t('translationUnavailable'));return;}
  if(session&&!publicTokenPage&&userSettings?.preferences.language!==language){void savePreferences({language}).then(result=>{if(!result.ok)notify(accountText(locale,'storageError',t));});}
  if(destination!==current)router.push(destination);
 },[session,userSettings,savePreferences,notify,t,pathname,router,locale,publicTokenPage,initialSite]);
 const profileName=userSettings?.profile.name||session?.name||'';
 const isDefaultDemoName=!!session&&session.email.endsWith('.invalid')&&profileName===demoUsers.find(user=>user.id===session.id)?.name;
 const displayName=session?(isDefaultDemoName?accountText(locale,`role_${session.role}`,t):profileName):accountText(locale,'guest',t);
 const displaySession=useMemo(()=>session&&!publicTokenPage?{...session,name:displayName}:null,[session,displayName,publicTokenPage]);
 const signOut=useCallback(async()=>{
  const context=requestContextKey,generation=authGeneration;
  if(!contextCurrent(context,generation))return;
  try{
   if(!demoMode)await apiClient.request('/auth/logout',{method:'POST'});
   if(!contextCurrent(context,generation))return;
   advanceAuth();clearCsrfToken();identityRef.current=null;setSession(null);setSessionError('');setServerSessionReady(true);setSettingsOwner(null);setRequests([]);
   const guest=readGuestInquiry();if(guest?.userId)writeGuestInquiry(null);setInquiriesState([]);setCompareState([]);setSavedState([]);
   if('caches'in window)void caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('idealmakoo-private')).map(key=>caches.delete(key))));router.push(href());
  }catch(error){if(contextCurrent(context,generation))notify(networkError(error,locale));}
 },[advanceAuth,setSession,setRequests,setInquiriesState,setCompareState,setSavedState,router,href,notify,locale,requestContextKey,authGeneration,contextCurrent]);
 const createRequest=useCallback(async(input:Omit<FrontRequest,'id'|'createdAt'>)=>{
  const owner=session?.id||null,context=requestContextKey,generation=authGeneration;
  if(!contextCurrent(context,generation)||identityRef.current!==owner)throw new ApiError({type:'about:blank',title:'Account changed',detail:'The account changed before this request could be submitted.',status:409});
  const key=input.idempotencyKey||crypto.randomUUID();const existing=requestRef.current.find(x=>x.idempotencyKey===key);if(existing)return existing;
  const record=dataMode==='api'?await apiRequests.create({...input,kind:input.kind==='callback'?'contact':input.kind,locale:input.locale||locale},key):{...input,id:makeId('IM-REQ'),createdAt:new Date().toISOString(),ownerId:session?.id||'guest',locale,version:1,idempotencyKey:key};
  if(!contextCurrent(context,generation)||identityRef.current!==owner)throw new ApiError({type:'about:blank',title:'Account changed',detail:'The account changed before the submitted request response could be displayed.',status:409});
  requestSequence.current++;setRequests(items=>[record,...items.filter(item=>item.id!==record.id)]);reloadRequests();return record;
 },[locale,session,setRequests,requestContextKey,authGeneration,contextCurrent,reloadRequests]);
 const updateRequest=useCallback(async(id:string,patch:Partial<FrontRequest>)=>{
  const owner=session?.id||null,context=requestContextKey,generation=authGeneration;
  const currentContext=()=>identityRef.current===owner&&contextCurrent(context,generation);
  if(!currentContext())return false;
  const current=requestRef.current.find(item=>item.id===id);if(!current){notify(t('accessDenied'));return false;}
  try{
   const next=demoMode?applyCustomerRequestPatch(current,patch,displaySession):await apiRequests.update(id,patch,current.version||1);
   if(!currentContext())return false;if(!next){notify(t('accessDenied'));return false;}
   requestSequence.current++;setRequests(items=>items.map(item=>item.id===id&&!(item.version&&next.version&&item.version>next.version)?next:item));reloadRequests();return true;
  }catch(error){if(currentContext()){notify(networkError(error,locale));if(error instanceof ApiError&&(error.status===409||error.status===412))reloadRequests();}return false;}
 },[session?.id,setRequests,displaySession,notify,t,locale,requestContextKey,authGeneration,contextCurrent,reloadRequests]);
 const addInquiry=useCallback(async(id:string,quantity=1,options:Partial<InquiryLine>={})=>{const product=getPublishedCatalog(locale).find(p=>p.id===id)||getPublishedProductInventory().find(p=>p.id===id);if(!product||!Number.isInteger(quantity)||quantity<1||quantity>100000){notify(t('invalidCsv'));return false;}const variant=options.variantId?product.localPublication?.productRelease?.variants.find(row=>row.id===options.variantId):undefined;if(options.variantId&&!variant){notify(t('invalidCsv'));return false;}const requested={...(product.family==='teeth'?{shade:variant?.shade||options.shade?.trim()||undefined,mould:variant?.mould||options.mould?.trim()||undefined}:{}),note:options.note?.slice(0,1000)};const safeOptions={...requested,...(variant?{variantId:variant.id,sku:variant.sku,unit:variant.unit}:{})};const accepted=await saveCollection('inquiries',(list:InquiryLine[])=>{const found=list.find(x=>inquiryIdentity(x)===inquiryIdentity({productId:id,quantity,...safeOptions})&&(x.note||'')===(safeOptions.note||''));if(found&&found.quantity+quantity>100000)throw new Error('Quantity exceeds the allowed limit');return found?list.map(x=>x===found?{...x,quantity:x.quantity+quantity}:x):[...list,{productId:id,quantity,...safeOptions}];});if(accepted)notify(t('added'));return accepted;},[locale,saveCollection,notify,t]);
 const value=useMemo<AppContextValue>(()=>({catalog,savedVersion:visibleCollectionMeta.savedVersion,defaultWishlistId:visibleCollectionMeta.defaultWishlistId,locale,dir:direction(locale),theme,setTheme,toggleTheme:()=>setTheme(theme==='dark'?'light':'dark'),t,pathname,href,switchLocale,notify,session:displaySession,sessionReady:publicTokenPage||sessionReady,sessionError:publicTokenPage?'':sessionError,acceptSession,userSettings:publicTokenPage?null:userSettings,settingsReady:publicTokenPage||settingsReady,settingsError:publicTokenPage||settingsContext!==requestContextKey?'':settingsError,displayName:publicTokenPage?accountText(locale,'guest',t):displayName,saveProfile,savePreferences,role:displaySession?.role||'customer',setRole,signIn,signOut,inquiries:visibleCollections.inquiries,setInquiries,addInquiry,compare:visibleCollections.compare,setCompare,toggleCompare:(id)=>setCompare(items=>items.includes(id)?items.filter(x=>x!==id):items.length<4?[...items,id]:items),saved:visibleCollections.saved,toggleSaved:(id)=>{void setSaved(items=>items.includes(id)?items.filter(x=>x!==id):[...items,id]).then(accepted=>{if(accepted)notify(t('savedChanges'));});},requests:visibleRequests,requestsReady:publicTokenPage||requestsReady,requestsError:publicTokenPage?'':requestsError,reloadRequests,createRequest,updateRequest}),[publicTokenPage,visibleCollections,visibleCollectionMeta,sessionReady,sessionError,acceptSession,catalog,locale,theme,t,pathname,href,router,notify,session,setRole,signIn,signOut,inquiries,setInquiries,addInquiry,compare,setCompare,saved,setSaved,visibleRequests,requestsReady,requestsError,reloadRequests,createRequest,updateRequest,setTheme,switchLocale,displaySession,userSettings,settingsReady,settingsError,settingsContext,requestContextKey,displayName,saveProfile,savePreferences]);
 return <Context.Provider value={value}><PwaRuntime/><LiquidEffects/>{children}{guestMerge&&!publicTokenPage&&guestMerge.context===requestContextKey&&session?.id===guestMerge.source.userId&&<aside className="glass" data-guest-inquiry-merge style={{position:'fixed',insetInline:'1rem',bottom:'1rem',maxWidth:640,padding:'1.2rem',zIndex:1000}}><p>{({fa:'سبد استعلام مهمان پس از تأیید سرور به حساب شما اضافه می‌شود.',en:'Your guest inquiry is added to your account only after the server confirms it.',tr:'Misafir talebiniz yalnızca sunucu onayından sonra hesabınıza eklenir.',ar:'تُضاف قائمة الاستفسار إلى حسابك بعد تأكيد الخادم.',ru:'Гостевой запрос добавляется в учётную запись только после подтверждения сервера.'})[locale]}</p>{guestMerge.error&&<p role="alert">{guestMerge.error}</p>}<button className="btn btn-primary" disabled={merging} onClick={()=>void attemptGuestMerge(guestMerge.source)}>{({fa:'بررسی و تلاش دوباره',en:'Check and retry',tr:'Kontrol et ve yeniden dene',ar:'التحقق وإعادة المحاولة',ru:'Проверить и повторить'})[locale]}</button></aside>}<div className="toast-stack" role="status" aria-live="polite">{toasts.map(toast=><div className="toast glass" key={toast.id}><Check size={18}/><span>{toast.message}</span><button className="icon-btn" aria-label={t('close')} onClick={()=>setToasts(items=>items.filter(x=>x.id!==toast.id))}><X size={16}/></button></div>)}</div></Context.Provider>;
}
export function useApp(){const context=useContext(Context);if(!context)throw new Error('useApp requires AppProvider');return context;}
