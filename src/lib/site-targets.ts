import { company, companyPages, type Localized } from '@/data/catalog';
import { locales, translate } from '@/lib/i18n';
const localizedKey=(key:string):Localized=>Object.fromEntries(locales.map(locale=>[locale,translate(locale,key)])) as Localized;
export interface EditablePublicTarget {slug:string;title:Localized;mode:'home'|'replace';sourceUrl?:string}
const extraTargets=[['manufacturing','manufacturing'],['quality','quality'],['sustainability','sustainability'],['global','global'],['faq','faq'],['glossary','glossary'],['knowledge','knowledge'],['privacy','privacy'],['terms','terms'],['for/dentist','dentist'],['for/lab','lab'],['for/dealer','dealer'],['for/research','researcher']];
/** Exact editorial routes only: transaction, catalog, tools and account flows are never replaced. */
export const editablePublicTargets:readonly EditablePublicTarget[]=[{slug:'home',title:localizedKey('home'),mode:'home',sourceUrl:company.website},...companyPages.map(page=>({slug:page.slug,title:page.title,mode:'replace' as const,sourceUrl:page.sourceUrl})),...extraTargets.filter(([slug])=>!companyPages.some(page=>page.slug===slug)).map(([slug,key])=>({slug,title:localizedKey(key),mode:'replace' as const}))];
