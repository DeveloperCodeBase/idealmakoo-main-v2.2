import 'server-only';
import type {Metadata} from 'next';
import {cache,type ReactNode} from 'react';
import {headers} from 'next/headers';
import {notFound,permanentRedirect} from 'next/navigation';
import Application from '@/components/Application';
import PublicWishlist from '@/components/wishlists/PublicWishlist';
import {FeedbackForm,CommunicationPreferences,CommunicationVerification} from '@/components/capabilities/CapabilityForms';
import NajvaDevicePicker from '@/components/capabilities/NajvaDevicePicker';
import {sitePaths} from '@/lib/routes';
import {isLocale,translate,type Locale} from '@/lib/i18n';
import {isPublicCapabilityPath} from '@/lib/private-capabilities';
import {products,articles,resources,company,companyPages} from '@/data/catalog';
import {referenceDocuments} from '@/data/reference-documents';
import {getServerPublicSite,publicationPath,publicOrigin} from '@/server/public-site';
import {canonicalPublicPath,publicPathAvailable,publicationAt,publicAlternates,indexablePath,publicRouteSeo,publicPathIndexable,publicRouteKind} from '@/server/public-routing';
import {notFoundMetadata} from '@/lib/not-found';
import {sourceRouteMetadata,publicationMetadataDescription,resourceMetadataTitle} from '@/lib/source-route-metadata';
import {editorialStructuredData,publicationSocialImage} from '@/server/public-structured-data';
import {assertPrivacyReady} from '@/server/privacy';
import {getPublicWishlist} from '@/server/wishlists';
import {crmSurveyResponse} from '@/server/crm-operations';
import {contactPreferencesResponse} from '@/server/contact-notifications';
import {communicationVerificationResponse,communicationCapabilities} from '@/server/communication-channels';
import {HttpError} from '@/server/types';
import {sessionFor} from '@/server/auth';
import {getResourcePage} from '@/server/resources';
import type {SurveyView,RecipientPreferenceView,VerificationView} from '@/types/communication-capabilities';

export type PublicPageProps={params:Promise<{locale:string;slug?:string[]}>};
/** A route entry supplies only its fixed public prefix; the common handler
 * still validates the complete path, visibility, session and canonical URL. */
export function withPublicPrefix({params}:PublicPageProps,prefix:readonly string[]):PublicPageProps{
  return {params:params.then(({locale,slug=[]})=>({locale,slug:[...prefix,...slug]}))};
}
const opaqueToken=/^[a-f0-9]{64}$/;

// Share the current request's authorization result between metadata and page
// rendering. Managed document paths are created after the static route build.
const managedResourcePage=cache(async(locale:Locale,slug:string)=>{
  try{
    const request=new Request(publicOrigin()+`/${locale}/resources/${encodeURIComponent(slug)}/`,{headers:new Headers(await headers())});
    const session=await sessionFor(request);
    const resource=await getResourcePage(session?.actor??null,slug,locale);
    return resource.visibility==='public'&&!resource.locales.includes(locale)?null:resource;
  }catch(error){
    if(error instanceof HttpError&&[400,401,403,404,409,410,422].includes(error.status))return null;
    throw error;
  }
});

export async function generatePublicMetadata({params}:PublicPageProps):Promise<Metadata>{
  const{locale:raw,slug=[]}=await params;if(!isLocale(raw))return notFoundMetadata('fa');
  const locale=raw,path=slug.join('/'),origin=publicOrigin();
  if(isPublicCapabilityPath(`/${locale}/${path}`)&&path!=='communication-verification/device'&&(slug.length!==2||!opaqueToken.test(slug[1])))return notFoundMetadata(locale);
  if(!indexablePath(path)||isPublicCapabilityPath(`/${locale}/${path}`))return{title:`${translate(locale,'brand')}`,robots:{index:false,follow:false,noarchive:true},referrer:'no-referrer'};
  const site=await getServerPublicSite();
  const kind=publicRouteKind(site,locale,slug);
  if(kind==='missing')return notFoundMetadata(locale);
  const managed=kind==='managed-resource';
  const managedDocument=managed?await managedResourcePage(locale,slug[1]):null;
  if(managed&&!managedDocument)return notFoundMetadata(locale);
  if(managedDocument&&managedDocument.visibility!=='public')return{title:translate(locale,'brand'),robots:{index:false,follow:false,noarchive:true},referrer:'no-referrer'};
  const canonical=managedDocument?'resources/'+managedDocument.slug:canonicalPublicPath(site,locale,path);
  if(!publicPathAvailable(site,locale,canonical))return notFoundMetadata(locale);
  const canonicalPublication=publicationAt(site,locale,canonical);
  const product=slug[0]==='products'?products.find(p=>p.slug===slug[1]):undefined;
  const article=slug[0]==='research'?articles.find(a=>a.slug===slug[1]):undefined;
  const document=slug[0]==='resources'?referenceDocuments.find(d=>d.slug===slug[1]):undefined;
  const companyPage=companyPages.find(p=>p.slug===path),resource=slug[0]==='resources'?resources.find(item=>item.slug===slug[1]):undefined;
  const source=sourceRouteMetadata(canonical,locale),seo=publicRouteSeo(site,locale,canonical),brand=site.preferences.brand.name[locale];
  const title=managedDocument?.title||canonicalPublication?.title||product?.name[locale]||article?.title[locale]||document?.title[locale]||(resource?resourceMetadataTitle(resource,locale):undefined)||companyPage?.title[locale]||source.title;
  const description=seo?.description.trim()||managedDocument?.summary||publicationMetadataDescription(canonicalPublication,canonical,locale)||product?.description[locale]||article?.excerpt[locale]||document?.summary[locale]||(resource?`${resource.title[locale]} — ${translate(locale,'referenceFiles')}`:undefined)||companyPage?.excerpt[locale]||source.description;
  const fullTitle=seo?.title.trim()||`${title} | ${brand}`;
  const publicUrl=`/${locale}/${canonical}${canonical?'/':''}`;
  const known=sitePaths.includes(path)||!!canonicalPublication||!!managedDocument;
  const image=publicationSocialImage(canonicalPublication)||product?.image||document?.pages[0]?.image||'/media/official/1686482269.jpg';
  const languages=managedDocument?Object.fromEntries(managedDocument.locales.filter(language=>publicPathIndexable(site,language,canonical)).map(language=>[language,`/${language}/${canonical}/`])):publicAlternates(site,locale,canonical);
  if(managedDocument&&languages.fa)languages['x-default']=languages.fa;
  return{title:fullTitle,description,metadataBase:new URL(origin),
    alternates:known?{canonical:publicUrl,languages}:undefined,
    robots:{index:known&&publicPathIndexable(site,locale,canonical),follow:known},
    openGraph:{title:fullTitle,description,locale:locale==='fa'?'fa_IR':locale==='ar'?'ar_SA':locale,url:origin+publicUrl,type:article||['research','news','knowledge','article'].includes(canonicalPublication?.kind||'')?'article':'website',images:[{url:image,alt:title}]},
    twitter:{card:'summary_large_image',title:fullTitle,description,images:[{url:image,alt:title}]}};
}

/** The renderer is evaluated only after the same server authorization and
 * publication checks used by every route entry. It is never a client prop. */
export async function renderPublicPage({params}:PublicPageProps,renderContent:(segments:string[])=>ReactNode){
  const{locale,slug=[]}=await params;if(!isLocale(locale))notFound();
  const path=slug.join('/');
  if(isPublicCapabilityPath(`/${locale}/${path}`)){
    await assertPrivacyReady();
    if(path==='communication-verification/device')return <NajvaDevicePicker locale={locale} capabilities={communicationCapabilities()}/>;
    if(slug.length!==2||!opaqueToken.test(slug[1]))notFound();
    const token=slug[1];
    try{
      if(slug[0]==='saved-share')return <PublicWishlist wishlist={await getPublicWishlist(token,locale)}/>;
      const incoming=new Headers(await headers());
      const request=(endpoint:string)=>new Request(publicOrigin()+'/api/v1/'+endpoint,{headers:incoming});
      if(slug[0]==='feedback'){
        const response=await crmSurveyResponse(request('surveys/forms/'+token),token);const initial=await response.json() as SurveyView;
        if(initial.locale!==locale)notFound();return <FeedbackForm key={token} token={token} initial={initial}/>;
      }
      if(slug[0]==='communication-preferences'){
        const response=await contactPreferencesResponse(request('communication-preferences/'+token),token);const initial=await response.json() as RecipientPreferenceView;
        if(initial.locale!==locale)notFound();return <CommunicationPreferences key={token} token={token} initial={initial}/>;
      }
      if(slug[0]==='communication-verification'){
        const response=await communicationVerificationResponse(request('communication-verification/'+token),token);const initial=await response.json() as VerificationView;
        if(initial.locale!==locale)notFound();return <CommunicationVerification key={token} token={token} initial={initial}/>;
      }
    }catch(error){if(error instanceof HttpError&&[400,401,403,404,410,422].includes(error.status))notFound();throw error;}
    notFound();
  }
  const site=await getServerPublicSite(),published=publicationAt(site,locale,path);
  const kind=publicRouteKind(site,locale,slug);
  if(kind==='missing')notFound();
  const managedDocument=kind==='managed-resource'?await managedResourcePage(locale,slug[1]):null;
  if(kind==='managed-resource'&&!managedDocument)notFound();
  const canonical=managedDocument?'resources/'+managedDocument.slug:canonicalPublicPath(site,locale,path);
  if(!publicPathAvailable(site,locale,canonical))notFound();
  if(canonical!==path)permanentRedirect(`/${locale}/${canonical}${canonical?'/':''}`);
  const origin=publicOrigin(),product=slug[0]==='products'?products.find(p=>p.slug===slug[1]):undefined;
  const releasedProduct=published?.kind==='product'||published?.kind==='products'?published:undefined;
  const image=publicationSocialImage(releasedProduct)||product?.image;
  const schema=product||releasedProduct?{'@context':'https://schema.org','@type':'Product',name:published?.title||product?.name[locale],description:published?.summary||product?.description[locale],...(image?{image:new URL(image,origin).href}:{}),...(product?{brand:{'@type':'Brand',name:product.brand}}:{}),manufacturer:{'@type':'Organization',name:'Ideal Makoo'},url:origin+`/${locale}/${path}/`}:published?editorialStructuredData(published,origin,publicationPath(published)):!slug.length?{'@context':'https://schema.org','@type':'Organization',name:site.preferences.brand.name[locale],url:origin,logo:new URL(site.preferences.brand.logo||company.logo,origin).href,telephone:site.preferences.contact.phone}:null;
  const nonce=(await headers()).get('x-nonce')||undefined;
  const content=renderContent(slug);
  return <>{schema&&<script nonce={nonce} type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(schema).replace(/</g,'\\u003c')}}/>}<Application segments={slug} {...(slug[0]==='account'?{accountContent:content}:slug[0]==='admin'?{workspaceContent:content}:slug[0]==='auth'?{authContent:content}:{publicContent:content})}/></>;
}
