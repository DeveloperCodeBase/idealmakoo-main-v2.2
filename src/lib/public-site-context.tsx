'use client';
import {createContext,useContext,useEffect,useMemo,type ReactNode} from 'react';
import {seedServerSite,type PublicSiteSnapshot} from '@/lib/server-runtime';
const SiteContext=createContext<PublicSiteSnapshot|null>(null);
/** Each server render reads its own provider snapshot. No server process global is mutated. */
export function PublicSiteProvider({initialSite,children}:{initialSite?:PublicSiteSnapshot;children:ReactNode}){
 const snapshot=useMemo(()=>initialSite||null,[initialSite]);
 useEffect(()=>{if(snapshot)seedServerSite(snapshot);},[snapshot]);
 return <SiteContext.Provider value={snapshot}>{children}</SiteContext.Provider>;
}
export function useInitialServerSite(){return useContext(SiteContext);}
