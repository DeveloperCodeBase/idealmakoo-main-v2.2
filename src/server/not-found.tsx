import 'server-only';
import {headers} from 'next/headers';
import {direction,translate,type Locale} from '@/lib/i18n';
import {notFoundDescriptions,notFoundLocale} from '@/lib/not-found';

export async function requestNotFoundLocale():Promise<Locale> {
  return notFoundLocale((await headers()).get('x-idealmakoo-path'));
}

/** The error document needs no account bootstrap, database or JavaScript. */
export function NotFoundContent({locale}:{locale:Locale}) {
  return <main id="main-content" className="container page-content" lang={locale} dir={direction(locale)}>
    <section className="empty-state glass" aria-labelledby="not-found-heading">
      <span className="eyebrow" aria-hidden="true">404</span>
      <h1 id="not-found-heading">{translate(locale,'notFound')}</h1>
      <p>{notFoundDescriptions[locale]}</p>
      <a className="btn btn-primary" href={`/${locale}/`}>{translate(locale,'home')}</a>
    </section>
  </main>;
}
