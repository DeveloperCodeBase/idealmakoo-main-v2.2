import type{ReactNode}from 'react';
import '../globals.css';
import '../liquid-theme.css';
import '../full-width.css';
import '../mobile-layout.css';
import '@/components/ui/dialog-surface.css';
export const metadata={title:'ایده‌آل ماکو | Ideal Makoo',description:'پلتفرم کارخانه تولید دندان مصنوعی و مواد دندانی ایده‌آل ماکو'};
export const dynamic='force-dynamic';
export default function EntryLayout({children}:{children:ReactNode}){return <html lang="fa" dir="rtl" data-theme="dark"><body>{children}</body></html>;}
