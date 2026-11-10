import {company,products,type Localized} from '@/data/catalog';
import {companyPageCopy as companyCopy} from '@/data/company-page-copy';
import {policyPageCopy as policyCopy} from '@/data/policy-page-copy';
import {editorialPageCopy} from '@/data/editorial-page-copy';
import {sourceFaqQuestions} from '@/data/faq-content';
import {glossaryCopy} from '@/components/content/glossary-copy';
import {translate,localized,type Locale} from '@/lib/i18n';
import type {PageBlock} from '@/data/workspace-seed';

export const policySections={privacy:['data','access','cookies','ai'],terms:['purpose','technical']} as const;
export const policySourceBlocks=(slug:'privacy'|'terms',locale:Locale):PageBlock[]=>[
 {id:`${slug}-hero`,type:'hero',title:translate(locale,slug),body:'',hidden:false},
 ...policySections[slug].map(key=>({id:`${slug}-${key}`,type:'rich-text',title:policyCopy[key][locale],body:policyCopy[`${key}Body`][locale],hidden:false})),
 {id:`${slug}-contact`,type:'cta',title:policyCopy.contact[locale],body:'',link:`/${locale}/contact/`,hidden:false,options:{ctaLabel:translate(locale,'contact'),secondaryLabel:translate(locale,'security'),secondaryLink:`/${locale}/account/security/`}},
];
const knowledgeTitle=localized('جایی برای دانش و تجربه.','A place for knowledge and experience.','Bilgi ve deneyim için bir yer.','مساحة للمعرفة والخبرة.','Место для знаний и опыта.');
const knowledgeBody=localized('محتوای تخصصی درباره محصولات، مواد و تجربه حرفه‌ای در صنعت دندان.','Specialist content on products, materials and professional experience in the dental industry.','Dental sektörde ürünler, malzemeler ve mesleki deneyim üzerine uzman içerik.','محتوى متخصص حول المنتجات والمواد والخبرة المهنية في صناعة الأسنان.','Профессиональные материалы о продуктах, материалах и опыте в стоматологической отрасли.');
const audienceLinks:Record<string,string[]>={dentist:['products/category/materials','tools/clinical-protocol','sample-request'],lab:['products/category/teeth','technical-selection','inquiry-list'],dealer:['cooperation/distribution','resources','contact'],research:['research','cooperation/research','quality']};
const audienceKeys:Record<string,string[]>={dentist:['materials','protocol','sample'],lab:['allProducts','technical','inquiry'],dealer:['cooperation','resources','contact'],research:['research','cooperation','quality']};

/** Exact original, authored text in each language. Source layouts and their
 * action links become independent draft fields; translations are never copied. */
export function extraSourceDraft(slug:string,locale:Locale):{title:string;summary:string;blocks:PageBlock[]}|null {
 const t=(key:string)=>translate(locale,key),href=(path:string)=>`/${locale}/${path}/`;
 const hero=(title:string,body:string):PageBlock=>({id:`${slug}-hero`,type:'hero',title,body,hidden:false});
 const text=(id:string,title:string,body:string,link?:string):PageBlock=>({id:`${slug}-${id}`,type:'rich-text',title,body,hidden:false,...link?{link}: {}});
 if(slug==='privacy'||slug==='terms')return{title:t(slug),summary:policyCopy[slug==='privacy'?'dataBody':'purposeBody'][locale],blocks:policySourceBlocks(slug,locale)};
 if(slug==='faq')return{title:t('faq'),summary:sourceFaqQuestions[0][1][locale],blocks:[hero(t('faq'),''),...sourceFaqQuestions.map(([question,answer,path],index)=>({id:`faq-question-${index+1}`,type:'faq',title:question[locale],body:answer[locale],link:href(path),hidden:false}))]};
 if(slug==='glossary')return{title:glossaryCopy.title[locale],summary:glossaryCopy.intro[locale],blocks:[hero(glossaryCopy.title[locale],glossaryCopy.intro[locale]),text('published-terms',t('glossary'),glossaryCopy.empty[locale])]};
 if(slug==='knowledge')return{title:editorialPageCopy.blogTitle[locale],summary:editorialPageCopy.blogBody[locale],blocks:[hero(editorialPageCopy.blogTitle[locale],editorialPageCopy.blogBody[locale]),{id:'knowledge-feed',type:'news-carousel',title:editorialPageCopy.noBlog[locale],body:editorialPageCopy.honestEmpty[locale],link:href('research'),hidden:false,options:{ctaLabel:editorialPageCopy.exploreResearch[locale]}},{id:'knowledge-links',type:'features',title:'',body:[[t('products'),editorialPageCopy.productsBody[locale],href('products')],[t('knowledge'),editorialPageCopy.researchBody[locale],href('research')],[t('resources'),editorialPageCopy.resourcesBody[locale],href('resources')]].map(row=>row.join('|')).join('\n'),hidden:false}]};
 if(slug.startsWith('for/')){const audience=slug.slice(4),links=audienceLinks[audience];if(!links)return null;return{title:t(audience==='research'?'researcher':audience),summary:t('ctaText'),blocks:[hero(t(audience==='research'?'researcher':audience),t('ctaText')),...links.map((path,index)=>({id:`for-${audience}-task-${index+1}`,type:'cta',title:t(audienceKeys[audience][index]),body:'',link:href(path),hidden:false,options:{ctaLabel:t(audienceKeys[audience][index])}})),{id:`for-${audience}-products`,type:'product-carousel',title:t('products'),body:'',hidden:false,options:{productIds:products.filter(product=>audience==='dentist'?product.family==='materials':product.family==='teeth').slice(0,7).map(product=>product.id)}}]};}
 const c=(key:keyof typeof companyCopy)=>companyCopy[key][locale];
 const sections:Record<string,{title:keyof typeof companyCopy;intro:keyof typeof companyCopy;pairs:[keyof typeof companyCopy,keyof typeof companyCopy][]}>={
  manufacturing:{title:'manufacturingTitle',intro:'manufacturingIntro',pairs:[['experienceTitle','experienceBody'],['layerTitle','layerBody'],['mouldTitle','mouldBody'],['materialTitle','materialBody'],['visitTitle','visitBody']]},
  quality:{title:'qualityTitle',intro:'qualityIntro',pairs:[['qualityFeedback','qualityFeedbackBody']]},
  global:{title:'globalTitle',intro:'globalIntro',pairs:[['craft','globalNote'],['neighbours','neighboursBody'],['europe','europeBody'],['america','americaBody']]},
  sustainability:{title:'sustainabilityTitle',intro:'sustainabilityBody',pairs:[]},
 };
 const source=sections[slug];if(!source)return null;
 return{title:c(source.title),summary:c(source.intro),blocks:[hero(c(source.title),c(source.intro)),...source.pairs.map(([title,body])=>({...text(title,c(title),c(body)),...(title==='experienceTitle'?{options:{visual:'scene' as const}}:{})})),...(slug==='global'?[text('factory-address',t('factory'),company.factoryLocation[locale]||company.address[locale])]:[])]};
}
