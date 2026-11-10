import { company, companyPages, products } from '@/data/catalog';
import { locales, translate, type Locale } from '@/lib/i18n';
import type { PageBlock, PageDraft } from '@/data/workspace-seed';
import {extraSourceDraft} from './site-source-drafts';
import {companySourceDraft} from './company-source-drafts';
import {editablePublicTargets} from './site-targets';
export {editablePublicTargets} from './site-targets';
export type {EditablePublicTarget} from './site-targets';
export const homeSectionIds=['home-hero','home-families','home-products','home-story','home-innovation','home-audiences','home-research','home-catalogs','home-news','home-resources','home-cta'] as const;
const homeText = {
 innovation: ['جزئیات را از زاویه‌ای تازه ببینید.','See the details from a new angle.','Ayrıntıları yeni bir açıdan görün.','شاهد التفاصيل من زاوية جديدة.','Взгляните на детали под новым углом.'],
 innovationBody: ['فرم، ماده و هماهنگی؛ به مکعب شیشه‌ای و دندان سه‌بعدی دست بزنید، لایه‌ها را بچرخانید و بعد، مجموعه محصولات کارخانه را کشف کنید. این یک تجربه تعاملی طراحی است.','Form, material and harmony. Explore the glass cube and three-dimensional tooth, turn its layers, then discover the factory’s product collection. This is an interactive design experience.','Biçim, malzeme ve uyum. Cam küpü ve üç boyutlu dişi keşfedin, katmanlarını döndürün, ardından fabrikanın ürünlerini inceleyin. Bu, etkileşimli bir tasarım deneyimidir.','الشكل والمادة والانسجام. استكشف المكعب الزجاجي والسن ثلاثي الأبعاد، ودوّر طبقاته، ثم اكتشف مجموعة منتجات المصنع. هذه تجربة تصميم تفاعلية.','Форма, материал и гармония. Изучите стеклянный куб и объёмный зуб, поверните слои, затем познакомьтесь с продукцией фабрики. Это интерактивная демонстрация дизайна.'],
 productDocs: ['ورق بزنید، مقایسه کنید، همراه ببرید.','Browse, compare and take it with you.','İnceleyin, karşılaştırın, yanınıza alın.','تصفّح وقارن وخذها معك.','Просматривайте, сравнивайте, сохраняйте.'],
 catalogueBody: ['برگه‌های تصویری معرفی محصول از آرشیو رسمی؛ هر کارت به منبع و فایل اصلی همان محصول متصل است.','Product image sheets from the official archive. Each card connects to its product’s original file and source.','Resmî arşivden ürün tanıtım görselleri. Her kart ürünün asıl dosyasına ve kaynağına bağlıdır.','صور تعريف المنتجات من الأرشيف الرسمي. ترتبط كل بطاقة بالملف الأصلي ومصدر المنتج.','Изображения листов продукции из официального архива. Каждая карточка связана с исходным файлом и источником продукта.'],
 newsBody: ['تازه‌های منتشرشده کارخانه در همین وب‌سایت.','Factory updates published on this website.','Bu sitede yayınlanan fabrika haberleri.','مستجدات المصنع المنشورة على هذا الموقع.','Новости фабрики, опубликованные на этом сайте.'],
};
export function createHomeBlocks(locale:Locale,copyText?:(key:string)=>string):PageBlock[]{
 const t=copyText||((key:string)=>translate(locale,key));const href=(path:string)=>`/${locale}/${path}/`;
 const text=(key:keyof typeof homeText)=>homeText[key][locales.indexOf(locale)];
 const block=(id:string,type:string,title:string,body='',mediaUrl?:string,link?:string):PageBlock=>({id,type,title,body,mediaUrl,link,hidden:false,options:{tone:'neutral'}});
 return [
  {...block('home-hero','hero',t('heroTitle'),t('heroDescription'),products.find(product=>product.id==='president')?.image,href('products')),options:{visual:'scene',tone:'cyan',ctaLabel:t('browseProducts'),secondaryLabel:t('catalogue'),secondaryLink:href('resources')}},
  block('home-families','features',t('productFamilies'),t('familiesDescription')),
  {...block('home-products','product-carousel',t('featured'),t('featuredDescription'),undefined,href('products')),options:{productIds:['president','apple','ideal-line','bstar-nano-composite','antic','light-cure-composite'],ctaLabel:t('allProducts'),tone:'cyan'}},
  {...block('home-story','split',t('companyHistory'),company.about[locale],company.heroImage,href('about')),options:{ctaLabel:t('about'),tone:'neutral'}},
  {...block('home-innovation','split',text('innovation'),text('innovationBody'),undefined,href('manufacturing')),options:{visual:'scene',tone:'violet',ctaLabel:t('manufacturing'),secondaryLabel:t('products'),secondaryLink:href('products')}},
  block('home-audiences','features',t('professionals')),
  {...block('home-research','product-carousel',t('knowledge'),t('sourceNote'),undefined,href('research')),options:{ctaLabel:t('browseResearch'),tone:'neutral'}},
  block('home-catalogs','catalog-carousel',text('productDocs'),text('catalogueBody')),
  block('home-news','news-carousel',t('news'),text('newsBody')),
  {...block('home-resources','cta',t('resources'),t('referenceFiles'),undefined,href('resources')),options:{ctaLabel:t('catalogue'),tone:'cyan'}},
  {...block('home-cta','cta',t('ctaTitle'),t('ctaText'),undefined,href('cooperation')),options:{ctaLabel:t('cooperation'),secondaryLabel:t('contactUs'),secondaryLink:href('contact'),tone:'violet'}},
 ];
}
export function createSiteDraft(slug:string,locale:Locale,author:string,authorId?:string):PageDraft {
 const target=editablePublicTargets.find(item=>item.slug===slug);if(!target)throw new Error('Unsupported editorial target');
 const source=companyPages.find(page=>page.slug===slug);const t=(key:string)=>translate(locale,key);
 const extra=slug!=='home'?companySourceDraft(slug,locale)||extraSourceDraft(slug,locale):null;
 const paragraphs=source?.body.map(text=>text[locale])||[];
 const summary=extra?.summary||source?.excerpt[locale]||(slug==='home'?t('heroDescription'):'');
 return {id:`site-${slug.replaceAll('/','-')}-${locale}`,slug,locale,title:extra?.title||target.title[locale],summary,status:'draft',version:1,author,authorId,updatedAt:new Date().toISOString(),blocks:slug==='home'?createHomeBlocks(locale):extra?.blocks||[{id:`${slug}-hero`,type:'hero',title:target.title[locale],body:summary,mediaUrl:source?company.heroImage:undefined},...paragraphs.map((body,index)=>({id:`${slug}-body-${index}`,type:'rich-text',title:'',body})),...(!paragraphs.length?[{id:`${slug}-body`,type:'rich-text',title:'',body:''}]:[])]};
}
/** Retain original scene sections when opening old generic home drafts/publications. */
export function upgradeHomeBlocks(blocks:PageBlock[],locale:Locale):{blocks:PageBlock[];upgraded:boolean}{
 if(blocks.some(block=>(homeSectionIds as readonly string[]).includes(block.id)))return {blocks,upgraded:false};
 const mapping:Record<string,string>={'hero':'home-hero','product-carousel':'home-products','product-grid':'home-products','catalog-carousel':'home-catalogs','news-carousel':'home-news'};
 const source=createHomeBlocks(locale);const matched=new Set<string>();const extras:PageBlock[]=[];
 for(const block of blocks){const id=mapping[block.type];const index=id?source.findIndex(item=>item.id===id):-1;if(index>=0&&!matched.has(id)){const base=source[index];source[index]={...base,...block,id,type:base.type,options:{...base.options,...block.options}};matched.add(id);}else extras.push(block);}
 source.splice(Math.max(0,source.length-1),0,...extras);return {blocks:source,upgraded:true};
}
