'use client';
import{useEffect}from 'react';
import{useRouter}from 'next/navigation';
import{entryLocalePath,localizedPath,rememberedLocale}from '@/lib/locale-routing';
export default function LocaleRedirect({path=''}:{path?:string}){const router=useRouter();useEffect(()=>{router.replace(entryLocalePath(path,window.location,rememberedLocale(window)));},[path,router]);return <div className="site-loading"><span className="loading-orbit"/><noscript><a href={localizedPath('fa',path)}>ایده‌آل ماکو — ادامه</a></noscript></div>;}
