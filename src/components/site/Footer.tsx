'use client';
import Link from 'next/link';
import {ArrowUpRight,Mail,MapPin,Phone} from 'lucide-react';
import {Brand} from './Navigation';
import {useApp} from '@/components/providers/AppProvider';
import {siteMenuHref,useSitePreferences,visibleMenuGroups} from '@/lib/site-preferences';
import {usePublicSiteSnapshot} from '@/lib/publications';
import {isPublicPathVisible} from '@/lib/public-visibility';
import styles from './preferences.module.css';
import creditStyles from './footer-credit.module.css';

export default function Footer(){
 const{locale,dir,t,href}=useApp();const preferences=useSitePreferences();const site=usePublicSiteSnapshot();const groups=visibleMenuGroups(preferences.footer,site,locale);const credit=preferences.footerDetails;const visible=(path:string)=>isPublicPathVisible(site,locale,path);
 return <footer className="site-footer" dir={dir} lang={locale}>
  <div className={`container footer-grid ${styles.footerGrid}`}>
   <div className="footer-brand"><Brand linked={visible('')}/><p>{preferences.brand.tagline[locale]}</p><span className="footer-since">{credit.since[locale]}</span></div>
   {groups.map(group=><div key={group.id}><h2>{group.label[locale]}</h2>{group.items.map(item=><Link key={item.id} href={siteMenuHref(item.path,locale)}>{item.label[locale]}</Link>)}</div>)}
   <div className="footer-contact"><h2>{t('contact')}</h2>{preferences.contact.officeAddress[locale]&&<p><MapPin size={16}/><span><strong>{t('headquarters')}</strong><br/>{preferences.contact.officeAddress[locale]}</span></p>}{preferences.contact.factoryAddress[locale]&&<p><MapPin size={16}/><span><strong>{t('factory')}</strong><br/>{preferences.contact.factoryAddress[locale]}</span></p>}<a href={`tel:${preferences.contact.phone.replace(/[^+\d]/g,'')}`}><Phone size={16}/><bdi dir="ltr">{preferences.contact.phone}</bdi></a>{preferences.contact.email&&<a href={`mailto:${preferences.contact.email}`}><Mail size={16}/><bdi dir="ltr">{preferences.contact.email}</bdi></a>}{visible('contact')&&<Link className="text-link" href={href('contact')}>{t('contactUs')}<ArrowUpRight size={16}/></Link>}</div>
  </div>
  <div className={`container footer-bottom ${creditStyles.bottomRow}`}>
   <span>{credit.contentLabel[locale]} <bdi dir="auto">{preferences.brand.name[locale]}</bdi></span>
   <div>{visible('privacy')&&<Link href={href('privacy')}>{t('privacy')}</Link>}{visible('terms')&&<Link href={href('terms')}>{t('terms')}</Link>}{visible('install')&&<Link href={href('install')}>{t('install')}</Link>}{credit.sourceUrl&&credit.sourceLabel[locale]&&<a href={credit.sourceUrl} target="_blank" rel="noreferrer">{credit.sourceLabel[locale]}<ArrowUpRight size={12}/></a>}</div>
  </div>
  <div className={`container ${creditStyles.credit}`}>
   <p className={creditStyles.byline}><span>{credit.developerLabel[locale]}</span><strong><bdi dir="auto">{credit.developerName[locale]}</bdi></strong></p>
   <p className={creditStyles.rights}><span><bdi dir="ltr">© {new Date().getFullYear()}</bdi> <bdi dir="auto">{credit.developerName[locale]}</bdi>.</span><span>{credit.developerRights[locale]}</span></p>
  </div>
 </footer>;
}
