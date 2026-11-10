import { company } from '@/data/catalog';
import { translate } from '@/lib/i18n';
import { sitePaths } from '@/lib/routes';
import type { SitePreferences, SiteMenuGroup } from '@/lib/site-preferences';
import {defaultSiteContact,defaultSiteFooterDetails,footerTextFields,safeFooterSource} from '@/lib/site-preference-content';
import {validPublicCopyOverrides,validPublicSeoSettings} from '../lib/site-editorial-settings';
import { assertObject, keys, string, integer, LOCALES, fail, safeJson } from './workspace-validation';

const words=(key:string)=>Object.fromEntries(LOCALES.map(locale=>[locale,translate(locale,key)])) as SitePreferences['brand']['name'];
const group=(id:string,title:string,entries:[string,string][]):SiteMenuGroup=>({id,label:words(title),visible:true,items:entries.map(([path,key],index)=>({id:`${id}-${index}`,label:words(key),path,visible:true}))});
export function defaultSitePreferences():SitePreferences {
  return {version:1,brand:{name:{...company.name},tagline:words('brandSub'),logo:company.logo},contact:defaultSiteContact(),footerDetails:defaultSiteFooterDetails(),navigation:[
    group('products','products',[['products','allProducts'],['products/category/teeth','teeth'],['products/category/materials','materials'],['compare','compare'],['tools/shade-mould-matcher','matcher'],['technical-selection','technical']]),
    group('research','research',[['research','articles'],['resources','resources'],['knowledge','knowledge'],['glossary','glossary'],['news','news'],['events','events']]),
    group('company','company',[['about','about'],['manufacturing','manufacturing'],['quality','quality'],['global','global'],['sustainability','sustainability'],['careers','careers']]),
    group('cooperation','cooperation',[['cooperation','cooperation'],['distributors','distributors'],['cooperation/distribution','dealer'],['cooperation/research','researcher'],['support','support'],['contact','contact']]),
  ],footer:[group('footer-products','products',[['products/category/teeth','teeth'],['products/category/materials','materials'],['resources','resources'],['inquiry-list','inquiry']]),group('footer-company','company',[['about','about'],['research','articles'],['cooperation','cooperation'],['careers','careers']])]};
}
const declared=new Set(sitePaths.filter(path=>!['admin','auth','account'].some(prefix=>path===prefix||path.startsWith(`${prefix}/`))));
function menuPath(value:unknown,additionalRoutes:ReadonlySet<string>) {
  string(value,'menu.path',1000); const [rawPath,query,extra]=value.split('?');
  if(extra!==undefined||/^[a-z][a-z\d+.-]*:/i.test(value)||value.startsWith('//')||/[\\#\s<>\u0000-\u001f]/.test(value)||/%/.test(rawPath)||rawPath.split('/').some(item=>item==='.'||item==='..')) fail('Invalid menu route');
  const path=rawPath.replace(/^\/+|\/+$/g,'').replace(/^(fa|en|tr|ar|ru)(?:\/|$)/,'');
  if(/^(?:api|admin|account|auth)(?:\/|$)/i.test(path))fail('Menus may reference public routes only');
  if(!declared.has(path)&&!additionalRoutes.has(path)) fail('Menu route is not a declared or published public route');
  if(query!==undefined) {const params=new URLSearchParams(query);if(!(path==='page'||path.endsWith('/detail'))||params.size!==1||!/^[a-z\d_-]{1,160}$/i.test(params.get('id')||'')) fail('Invalid menu route query');}
}
function local(value:unknown,path:string,max:number,required=false) {assertObject(value,path);keys(value,LOCALES,path);for(const code of LOCALES) {string(value[code],`${path}.${code}`,max,required?1:0);if(required&&!(value[code] as string).trim())fail(`${path}.${code} is required`);}}
export function validateServerPreferences(value:unknown,additionalRoutes:ReadonlySet<string>=new Set()):asserts value is SitePreferences {
  safeJson(value);assertObject(value,'preferences');keys(value,['version','brand','contact','footerDetails','navigation','footer','uiText','seo','updatedAt'],'preferences');integer(value.version,'preferences.version',1,1);
  if(!validPublicCopyOverrides(value.uiText))fail('Public copy overrides contain invalid or protected fields');
  if(!validPublicSeoSettings(value.seo))fail('Public route SEO settings are invalid');
  assertObject(value.brand,'brand');keys(value.brand,['name','tagline','logo'],'brand');local(value.brand.name,'brand.name',100,true);local(value.brand.tagline,'brand.tagline',200);
  string(value.brand.logo,'brand.logo',700000,1);
  const logo=value.brand.logo;
  if(!/^\/media\/(?:official|brand)\/[a-z\d][a-z\d_-]*\.(?:png|jpe?g|webp|avif)$/i.test(logo)&&!/^\/api\/v1\/media\/[a-z\d_-]+\/content$/i.test(logo)) {
    const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z\d+/]+={0,2})$/.exec(logo);
    if(!match) return fail('Logo must be a raster image');
    const bytes=Buffer.from(match[2],'base64');if(bytes.length<12||bytes.length>512*1024)fail('Logo exceeds size limit');
    const signature=match[1]==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):match[1]==='jpeg'?bytes[0]===255&&bytes[1]===216&&bytes[2]===255:bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
    if(!signature)fail('Logo file signature is invalid');
  }
  assertObject(value.contact,'contact');keys(value.contact,['address','officeAddress','factoryAddress','phone','email'],'contact');local(value.contact.address,'contact.address',500);string(value.contact.phone,'contact.phone',26,7);string(value.contact.email,'contact.email',254);
  if(value.contact.officeAddress!==undefined){local(value.contact.officeAddress,'contact.officeAddress',500);for(const locale of LOCALES)if((value.contact.officeAddress as Record<string,unknown>)[locale]!==(value.contact.address as Record<string,unknown>)[locale])fail('Office address and compatibility address must agree');}
  if(value.contact.factoryAddress!==undefined)local(value.contact.factoryAddress,'contact.factoryAddress',500);
  if(value.footerDetails!==undefined){assertObject(value.footerDetails,'footerDetails');keys(value.footerDetails,[...footerTextFields,'sourceUrl'],'footerDetails');for(const field of footerTextFields)local(value.footerDetails[field],`footerDetails.${field}`,500);if(safeFooterSource(value.footerDetails.sourceUrl)===null)fail('Footer source must be an HTTPS URL without credentials or an empty string');}
  if(!/^\+?[\d ()-]{7,26}$/.test(value.contact.phone)||!/^\d{7,15}$/.test(value.contact.phone.replace(/\D/g,'')))fail('Invalid phone');
  if(value.contact.email&&!/^[^\s@<>?&#]+@[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)+$/i.test(value.contact.email))fail('Invalid email');
  for(const field of ['navigation','footer'] as const) {
    const groups=value[field];if(!Array.isArray(groups)||groups.length>6)fail('Too many menu groups');const ids=new Set<string>();
    for(const raw of groups as unknown[]) {
      assertObject(raw,'menu');keys(raw,['id','label','visible','items'],'menu');string(raw.id,'menu.id',70,1);if(!/^[a-z\d_-]+$/i.test(raw.id)||ids.has(raw.id))fail('Invalid menu ID');ids.add(raw.id);local(raw.label,'menu.label',100,true);if(typeof raw.visible!=='boolean')fail('Invalid menu visibility');
      if(!Array.isArray(raw.items)||raw.items.length>12)fail('Too many menu links');const linkIds=new Set<string>();
      for(const link of raw.items as unknown[]) {assertObject(link,'menu.link');keys(link,['id','label','visible','path'],'menu.link');string(link.id,'link.id',70,1);if(!/^[a-z\d_-]+$/i.test(link.id)||linkIds.has(link.id))fail('Duplicate menu link');linkIds.add(link.id);local(link.label,'link.label',100,true);if(typeof link.visible!=='boolean')fail('Invalid menu link visibility');menuPath(link.path,additionalRoutes);}
    }
  }
}

/** Legacy callers still send contact.address. Missing new fields preserve the
 * stored section; they never reset an already edited factory or attribution. */
export function withPreferenceExtensions(value:SitePreferences,base?:SitePreferences):SitePreferences {
  const fallback=base?withPreferenceExtensions(base):defaultSitePreferences();
  const office=value.contact.officeAddress??value.contact.address;
  return {...value,contact:{...value.contact,address:{...office},officeAddress:{...office},factoryAddress:value.contact.factoryAddress??fallback.contact.factoryAddress},footerDetails:value.footerDetails??fallback.footerDetails,uiText:value.uiText??fallback.uiText,seo:value.seo??fallback.seo};
}
