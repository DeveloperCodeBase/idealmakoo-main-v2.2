import { company } from '@/data/catalog';
import { locales, translate, type Localized } from '@/lib/i18n';

export interface SiteContactDetails {
  /** Compatibility alias for the office, also used by frozen seller snapshots. */
  address: Localized;
  officeAddress: Localized;
  factoryAddress: Localized;
  phone: string;
  email: string;
}
export interface SiteFooterDetails {
  since: Localized;
  contentLabel: Localized;
  developerLabel: Localized;
  developerName: Localized;
  developerRights: Localized;
  sourceLabel: Localized;
  sourceUrl: string;
}
export const footerTextFields = ['since','contentLabel','developerLabel','developerName','developerRights','sourceLabel'] as const;
const local=(values:readonly string[]):Localized=>Object.fromEntries(locales.map((locale,index)=>[locale,values[index]])) as Localized;
const words=(key:string):Localized=>Object.fromEntries(locales.map(locale=>[locale,translate(locale,key)])) as Localized;
export function defaultSiteContact():SiteContactDetails {
  return {address:{...company.address},officeAddress:{...company.address},factoryAddress:{...company.factoryLocation},phone:company.phones[0],email:''};
}
export function defaultSiteFooterDetails():SiteFooterDetails {
  return {
    since:words('since'),
    contentLabel:local(['محتوا و علائم تجاری:','Content and trademarks:','İçerik ve ticari markalar:','المحتوى والعلامات التجارية:','Контент и товарные знаки:']),
    developerLabel:local(['طراحی، توسعه و پیاده‌سازی:','Design, development and implementation:','Tasarım, geliştirme ve uygulama:','التصميم والتطوير والتنفيذ:','Дизайн, разработка и внедрение:']),
    developerName:local(['شرکت شبکه هوشمند ابتکار ویستا','Shabakeh Hooshmand Ebtekar Vista','Shabakeh Hooshmand Ebtekar Vista','شرکت شبکه هوشمند ابتکار ویستا','Shabakeh Hooshmand Ebtekar Vista']),
    developerRights:local(['کلیهٔ حقوق طراحی و نرم‌افزار این وب‌سایت محفوظ است.','All rights to this website’s design and software are reserved.','Bu web sitesinin tasarım ve yazılımına ilişkin tüm haklar saklıdır.','جميع حقوق تصميم هذا الموقع وبرمجياته محفوظة.','Все права на дизайн и программное обеспечение этого сайта защищены.']),
    sourceLabel:words('source'),sourceUrl:company.website,
  };
}
/** An optional external source is HTTPS only. An empty value removes the link. */
export function safeFooterSource(value:unknown):string|null {
  if(typeof value!=='string'||value.length>1000||/[\u0000-\u0020\u007f\\]/.test(value))return null;
  if(value==='')return '';
  try {const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.hostname&&!url.hash?url.href:null;}catch{return null;}
}
