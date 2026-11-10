import {direction} from '@/lib/i18n';
import {notFoundMetadata} from '@/lib/not-found';
import {NotFoundContent,requestNotFoundLocale} from '@/server/not-found';
import './globals.css';
import './liquid-theme.css';
import './full-width.css';
import './user-preferences.css';
import './mobile-layout.css';

export const dynamic='force-dynamic';
export async function generateMetadata(){return notFoundMetadata(await requestNotFoundLocale());}
export default async function GlobalNotFound(){
  const locale=await requestNotFoundLocale();
  return <html lang={locale} dir={direction(locale)} data-theme="dark">
    <head><link rel="icon" href="/icons/idealmakoo-favicon-48.png" type="image/png" sizes="48x48"/></head>
    <body><NotFoundContent locale={locale}/></body>
  </html>;
}
