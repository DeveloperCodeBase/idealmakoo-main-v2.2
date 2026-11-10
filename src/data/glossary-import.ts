import type {WorkspaceRecord} from './workspace-seed';
import {recordText} from './workspace-seed';
import {localized} from '../lib/i18n';

/** Exact pre-existing editorial copy imported from the verified source checkpoint.
 * This seed creates unpublished drafts; it carries no scientific approval or fallback release.
 */
const importedTerms=[
 ['PMMA',localized('پلی‌متیل‌متاکریلات','Polymethyl methacrylate','Polimetil metakrilat','بولي ميثيل ميثاكريلات','Полиметилметакрилат')],
 ['Shade',localized('شید: شناسهٔ رنگ دندان در سیستم رنگ همان محصول.','A tooth colour identifier within the product shade system.','Ürünün renk sistemindeki diş rengi tanımı.','معرّف لون الأسنان ضمن نظام ألوان المنتج.','Обозначение цвета зуба в системе оттенков продукта.')],
 ['Mould',localized('قالب: شناسهٔ شکل و اندازهٔ دندان مصنوعی.','An identifier for the shape and size of an artificial tooth.','Yapay dişin şekil ve boyut tanımı.','معرّف لشكل وحجم السن الصناعي.','Обозначение формы и размера искусственного зуба.')],
 ['Anterior',localized('قدامی: دندان‌های بخش جلویی قوس دندانی.','Teeth at the front of the dental arch.','Diş arkının ön bölgesindeki dişler.','أسنان الجزء الأمامي من القوس السني.','Передние зубы зубной дуги.')],
 ['Posterior',localized('خلفی: دندان‌های بخش پشتی قوس دندانی.','Teeth at the back of the dental arch.','Diş arkının arka bölgesindeki dişler.','أسنان الجزء الخلفي من القوس السني.','Боковые зубы зубной дуги.')],
 ['Nano-composite',localized('نانوکامپوزیت: نام یک گروه ترکیبی مواد؛ مشخصات هر محصول جداگانه بررسی می‌شود.','A class of composite materials; specifications are product-specific.','Bir kompozit malzeme sınıfı; özellikler ürüne özeldir.','فئة من المواد المركبة؛ المواصفات خاصة بكل منتج.','Класс композитных материалов; свойства зависят от продукта.')],
 ['IFU',localized('دستورالعمل استفادهٔ رسمی محصول.','Instructions for use issued for a product.','Ürünün kullanım talimatları.','تعليمات استخدام المنتج.','Инструкция по применению продукта.')],
 ['SDS',localized('برگهٔ اطلاعات ایمنی مواد.','Safety data sheet.','Güvenlik bilgi formu.','صحيفة بيانات السلامة.','Паспорт безопасности материала.')],
 ['Batch / Lot',localized('شناسهٔ یک سری تولید محصول.','An identifier for a production batch.','Üretim partisi tanımı.','معرّف دفعة إنتاج.','Идентификатор производственной партии.')],
 ['RFQ',localized('درخواست اطلاعات فنی و شرایط تأمین محصول.','Request for product and supply terms.','Ürün ve tedarik koşulları talebi.','طلب معلومات المنتج وشروط التوريد.','Запрос информации о продукции и условиях поставки.')],
 ['Light cure',localized('پخت نوری: نام روش سخت‌شدن ماده طبق دستورالعمل همان محصول.','Light curing, as specified in the product instructions.','Ürün talimatında tanımlanan ışıkla sertleşme.','التصلب بالضوء وفق تعليمات المنتج.','Световое отверждение согласно инструкции продукта.')],
 ['Monoplane',localized('منوپلن: فرم خلفی با سطح اکلوزالی صفر درجه طبق توضیح محصول.','Posterior tooth form with a zero-degree occlusal design, where specified.','Belirtildiğinde sıfır derece oklüzal tasarımlı arka diş formu.','شكل أسنان خلفية بتصميم إطباقي صفر درجة عند تحديده.','Форма боковых зубов с нулевым наклоном, если указано производителем.')]
] as const;

export const glossaryImportProvenance={sourceDocument:'src/components/site/Tools.tsx',sourceSha256:'851189b856673bbcb9478f1f71f032c284e79caec43e24f5ffb6b9a2742d9b7c',arraySha256:'98fedd2d7a9f0aa496fe85e0938d51ee34c9949c9d9129c2da507ca117c83726',count:12} as const;

export function createSourceGlossaryDrafts(at:string):WorkspaceRecord[]{
  return importedTerms.map(([term,definition])=>({id:'GLOSSARY-'+term.toUpperCase().replace(/[^A-Z0-9]+/g,'-'),collection:'glossary',title:recordText(term),summary:{...definition},status:'draft',owner:'editor',author:'system',authorId:'system-source-import',publishedLocales:[],history:[],tags:['source-intake'],demo:false,createdAt:at,updatedAt:at,details:{glossary:{schemaVersion:1,aliases:{}},glossaryImport:{schemaVersion:1,source:{...glossaryImportProvenance,label:term},definitionStatus:'imported-unreviewed',approvalStatus:'unreviewed'}}}));
}
