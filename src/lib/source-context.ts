import {articles,companyPages,products,type ContentLocale,type Localized} from '@/data/catalog';
import type {OfficialSourcePage} from '@/data/official-source-pages';
import {researchBodyForLocale} from './research-locale';

const L=(fa:string,en:string,tr:string,ar:string,ru:string):Localized=>({fa,en,tr,ar,ru});
const indexes:Record<string,{title:Localized;body:Localized;path:string}>={
 'official-page-home':{title:L('صفحهٔ اصلی مرجع','Source homepage','Kaynak ana sayfası','الرئيسية في المصدر','Главная страница источника'),body:L('صفحهٔ اصلی منبع، معرفی شرکت و پیوند محصولات و پژوهش‌های آرشیوی را در کنار هم قرار می‌دهد.','The source homepage brings together company information and links to its product and research archives.','Kaynak ana sayfası, şirket bilgilerini ürün ve araştırma arşivlerinin bağlantılarıyla bir araya getirir.','تجمع الصفحة الرئيسية للمصدر معلومات الشركة وروابط أرشيف المنتجات والبحوث.','Главная страница источника объединяет сведения о компании и ссылки на архивы продуктов и исследований.'),path:''},
 'official-page-3':{title:L('فهرست محصولات مرجع','Source product index','Kaynak ürün dizini','فهرس منتجات المصدر','Список продуктов источника'),body:L('این صفحهٔ مرجع فهرست محصولات کارخانه را ارائه می‌کند. معرفی هر محصول در صفحهٔ همان محصول به زبان انتخاب‌شده در دسترس است.','This source page lists the factory’s products. Each product has a separate introduction in the selected language.','Bu kaynak sayfa fabrikanın ürünlerini listeler. Her ürünün seçilen dilde ayrı bir tanıtımı vardır.','تسرد هذه الصفحة المصدر منتجات المصنع. لكل منتج تعريف مستقل باللغة المختارة.','Эта страница источника содержит перечень продукции фабрики. Для каждого продукта доступно отдельное описание на выбранном языке.'),path:'products'},
 'official-page-5':{title:L('فهرست پژوهش مرجع','Source research index','Kaynak araştırma dizini','فهرس بحوث المصدر','Список исследований источника'),body:L('این صفحهٔ مرجع فهرست مطالب پژوهشی آرشیو کارخانه را ارائه می‌کند. خلاصهٔ هر مدخل همراه با پیوند منبع در بخش پژوهش در دسترس است.','This source page indexes the factory’s research archive. Each entry has an editorial summary and a source link in the research section.','Bu kaynak sayfa fabrikanın araştırma arşivini listeler. Araştırma bölümündeki her kayıtta editoryal özet ve kaynak bağlantısı bulunur.','تفهرس هذه الصفحة المصدر أرشيف أبحاث المصنع. يتوفر لكل مدخل ملخص تحريري ورابط مصدر في قسم البحوث.','Эта страница источника содержит указатель научного архива фабрики. В разделе исследований для каждой записи доступны редакционное резюме и ссылка на источник.'),path:'research'},
};
const unknownTitle=L('مدخل آرشیو منبع','Source archive entry','Kaynak arşivi kaydı','مدخل أرشيف المصدر','Запись архива источника');

/** Never substitute an original Persian transcript for missing target-language prose. */
export function sourceContextForLocale(page:OfficialSourcePage,locale:ContentLocale):{title:string;paragraphs:string[];path?:string}{
 const product=page.productId?products.find(item=>item.id===page.productId):undefined;
 if(product)return {title:product.name[locale],paragraphs:[product.description[locale],...product.features.map(item=>item[locale])].filter(Boolean),path:`products/${product.slug}`};
 const article=page.articleId?articles.find(item=>item.id===page.articleId):undefined;
 if(article)return {title:article.title[locale],paragraphs:[article.excerpt[locale],...researchBodyForLocale(article,locale)].filter(Boolean),path:`research/${article.slug}`};
 const company=page.companyPageId?companyPages.find(item=>item.id===page.companyPageId):undefined;
 if(company)return {title:company.title[locale],paragraphs:[company.excerpt[locale],...company.body.map(item=>item[locale])].filter(Boolean),path:company.slug};
 const index=indexes[page.id];
 if(index)return {title:index.title[locale],paragraphs:[index.body[locale]],path:index.path};
 return {title:locale==='fa'?page.title:unknownTitle[locale],paragraphs:[]};
}
