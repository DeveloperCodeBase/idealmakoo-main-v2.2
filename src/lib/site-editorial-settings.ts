import {locales,type Locale} from './i18n';
import {sitePaths} from './routes';

/** Public descriptive copy only. Authentication, consent, legal/security
 * notices, validation messages and transaction action labels are not overridable. */
export const editablePublicCopyKeys=['heroEyebrow','heroTitle','heroDescription','exploreHint','productFamilies','familiesDescription','featured','featuredDescription','professionals','dentist','lab','dealer','researcher','companyHistory','ctaTitle','ctaText','builtFor','referenceFiles','professionalTools'] as const;
export type EditablePublicCopyKey=typeof editablePublicCopyKeys[number];
export type PublicCopyOverrides=Partial<Record<Locale,Partial<Record<EditablePublicCopyKey,string>>>>;
export interface PublicRouteSeo {title:string;description:string;noindex:boolean}
export type PublicSeoSettings=Record<string,Partial<Record<Locale,PublicRouteSeo>>>;
export const publicSeoPaths=sitePaths.filter(path=>!['admin','account','auth','api','page','published','saved-share','feedback','communication-preferences','communication-verification','unsubscribe'].some(prefix=>path===prefix||path.startsWith(prefix+'/'))&&!path.includes('/detail'));
const allowedKeys=new Set<string>(editablePublicCopyKeys),allowedPaths=new Set<string>(publicSeoPaths);
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validText=(value:unknown,max:number)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);

export function validPublicCopyOverrides(value:unknown):boolean {
 if(value===undefined)return true;if(!object(value))return false;
 return Object.entries(value).every(([locale,entries])=>locales.includes(locale as Locale)&&object(entries)&&Object.entries(entries).every(([key,text])=>allowedKeys.has(key)&&validText(text,2000)&&String(text).trim().length>0));
}
export function parsePublicCopyOverrides(value:unknown):PublicCopyOverrides {
 if(!validPublicCopyOverrides(value)||!object(value))return{};
 return Object.fromEntries(Object.entries(value).map(([locale,entries])=>[locale,Object.fromEntries(Object.entries(entries as Record<string,string>).map(([key,text])=>[key,text.trim()]))])) as PublicCopyOverrides;
}
export function publicCopyOverride(value:unknown,locale:Locale,key:string):string|undefined {
 if(!allowedKeys.has(key)||!object(value)||!object(value[locale]))return;
 const text=value[locale][key];return validText(text,2000)&&String(text).trim()?String(text):undefined;
}
export function validPublicSeoSettings(value:unknown):boolean {
 if(value===undefined)return true;if(!object(value)||Object.keys(value).length>publicSeoPaths.length)return false;
 return Object.entries(value).every(([path,entries])=>allowedPaths.has(path)&&object(entries)&&Object.entries(entries).every(([locale,seo])=>locales.includes(locale as Locale)&&object(seo)&&Object.keys(seo).every(key=>['title','description','noindex'].includes(key))&&validText(seo.title,160)&&validText(seo.description,500)&&typeof seo.noindex==='boolean'));
}
export function parsePublicSeoSettings(value:unknown):PublicSeoSettings {
 if(!validPublicSeoSettings(value)||!object(value))return{};
 return Object.fromEntries(Object.entries(value).map(([path,entries])=>[path,Object.fromEntries(Object.entries(entries as Record<string,PublicRouteSeo>).map(([locale,seo])=>[locale,{title:seo.title.trim(),description:seo.description.trim(),noindex:seo.noindex}]))]));
}
