import type{ReactNode}from 'react';
import {headers}from 'next/headers';
import '../globals.css';
import '../liquid-theme.css';
import '../full-width.css';
import '../mobile-layout.css';
import '@/components/ui/dialog-surface.css';
export const metadata={title:'ایده‌آل ماکو | Ideal Makoo',description:'پلتفرم کارخانه تولید دندان مصنوعی و مواد دندانی ایده‌آل ماکو'};
export const dynamic='force-dynamic';
const NAJVA_BOOTSTRAP=`window.NAJVA={};var s=document.createElement("script");s.src="https://van.najva.com/static/js/main-script.js";s.defer=!0;s.id="najva-mini-script";s.setAttribute("data-najva-id","ae9e618d-f6d8-487d-b072-4943f1f5508e");document.head.appendChild(s);`;
export default async function EntryLayout({children}:{children:ReactNode}){const nonce=(await headers()).get('x-nonce')||undefined;return <html lang="fa" dir="rtl" data-theme="dark"><head><script nonce={nonce} dangerouslySetInnerHTML={{__html:NAJVA_BOOTSTRAP}}/></head><body>{children}</body></html>;}
