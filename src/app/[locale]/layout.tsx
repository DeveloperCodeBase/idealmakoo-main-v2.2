import type{ReactNode}from 'react';
import{notFound}from 'next/navigation';
import {headers} from 'next/headers';
import {isPublicCapabilityPath} from '@/lib/private-capabilities';
import{isLocale,direction}from '@/lib/i18n';
import{getServerPublicSite}from '@/server/public-site';
import{AppProvider}from '@/components/providers/AppProvider';
import{DISPLAY_BOOTSTRAP_SCRIPT}from '@/lib/display-preferences';
import '../globals.css';
import '../liquid-theme.css';
import '../full-width.css';
import '../user-preferences.css';
import '../mobile-layout.css';
import '@/components/ui/dialog-surface.css';
export const dynamic='force-dynamic';
export default async function LocaleLayout({children,params}:{children:ReactNode;params:Promise<{locale:string}>}){const{locale}=await params;if(!isLocale(locale))notFound();const incoming=await headers();const path=incoming.get('x-idealmakoo-path')||'',nonce=incoming.get('x-nonce')||undefined;const capability=isPublicCapabilityPath(path);const initialSite=capability?undefined:await getServerPublicSite();return <html lang={locale} dir={direction(locale)} data-theme="dark" suppressHydrationWarning><head><link rel="preload" as="font" href={locale==='fa'||locale==='ar'?'/fonts/EstedadVariable.woff2':'/fonts/InterVariable-latin.woff2'} type="font/woff2" crossOrigin="anonymous"/>{!capability&&<script nonce={nonce} dangerouslySetInnerHTML={{__html:DISPLAY_BOOTSTRAP_SCRIPT}}/>}<link rel="icon" href="/icons/idealmakoo-favicon-48.png" type="image/png" sizes="48x48"/><link rel="manifest" href={`/manifests/${locale}.webmanifest`}/></head><body>{capability?children:<AppProvider locale={locale} initialSite={initialSite}>{children}</AppProvider>}</body></html>;}
