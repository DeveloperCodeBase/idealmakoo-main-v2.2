import type {ContentLocale,Localized,Product} from '@/data/catalog';
import {parseProductRelease,type ProductRelease} from '@/lib/product-release';
import {editorNumber,productEditorLocales} from '@/components/workspace/product-editor-data';

const L=(fa:string,en:string,tr:string,ar:string,ru:string):Localized=>({fa,en,tr,ar,ru});
const labels={
 materialClass:L('گروه ماده','Material class','Malzeme sınıfı','فئة المادة','Класс материала'),
 toothPosition:L('موقعیت دندان','Tooth position','Diş konumu','موضع السن','Положение зуба'),
 arch:L('فک','Arch','Çene','الفك','Челюсть'),
 layerCount:L('تعداد لایه‌ها','Layer count','Katman sayısı','عدد الطبقات','Количество слоёв'),
 mouldCodes:L('کدهای قالب','Mould codes','Kalıp kodları','رموز القوالب','Коды форм'),
 shadeSystem:L('سیستم رنگ','Shade system','Renk sistemi','نظام الألوان','Система оттенков'),
 availableShades:L('کدهای رنگ ثبت‌شده','Entered shade codes','Girilen renk kodları','رموز الألوان المدخلة','Внесённые коды оттенков'),
 category:L('دسته ماده','Material category','Malzeme kategorisi','فئة المادة','Категория материала'),
 concentrationOrGeneration:L('غلظت یا نسل','Concentration or generation','Konsantrasyon veya nesil','التركيز أو الجيل','Концентрация или поколение'),
 curingMethod:L('روش پلیمریزاسیون','Curing method','Sertleşme yöntemi','طريقة التصلب','Метод отверждения'),
 deliveryForm:L('شکل ارائه','Delivery form','Sunum biçimi','شكل التقديم','Форма выпуска'),
 netQuantity:L('مقدار خالص','Net quantity','Net miktar','الكمية الصافية','Количество нетто'),
 quantityUnit:L('واحد مقدار','Quantity unit','Miktar birimi','وحدة الكمية','Единица количества'),
 curingTimeSeconds:L('زمان پلیمریزاسیون (ثانیه)','Curing time (seconds)','Sertleşme süresi (saniye)','وقت التصلب (ثوانٍ)','Время отверждения (секунды)'),
 etchingTimeSeconds:L('زمان اچ (ثانیه)','Etching time (seconds)','Aşındırma süresi (saniye)','وقت التخريش (ثوانٍ)','Время травления (секунды)'),
 storageTemperatureCelsius:L('دمای نگهداری (سانتی‌گراد)','Storage temperature (°C)','Saklama sıcaklığı (°C)','درجة حرارة التخزين (°م)','Температура хранения (°C)'),
};
const enumLabels={upper:L('بالا','Upper','Üst','علوي','Верхняя'),lower:L('پایین','Lower','Alt','سفلي','Нижняя'),anterior:L('قدامی','Anterior','Ön','أمامي','Передний'),posterior:L('خلفی','Posterior','Arka','خلفي','Задний'),PMMA_Multilayer:L('PMMA چندلایه','Multilayer PMMA','Çok katmanlı PMMA','PMMA متعدد الطبقات','Многослойный PMMA'),Nano_Composite:L('نانوکامپوزیت','Nano composite','Nano kompozit','نانو كومبوزيت','Нанокомпозит'),Nano_Base_Acrylic:L('اکریلیک با پایه نانو','Nano base acrylic','Nano bazlı akrilik','أكريليك بقاعدة نانو','Акрил на нанооснове'),acid_etch:L('ژل اچ','Etching gel','Aşındırma jeli','جل التخريش','Протравочный гель'),bonding_resin:L('رزین باندینگ','Bonding resin','Bonding rezini','راتنج الربط','Адгезивная смола'),light_cure_composite:L('کامپوزیت نوری','Light cure composite','Işıkla sertleşen kompozit','كومبوزيت ضوئي','Светоотверждаемый композит'),laboratory_putty:L('پوتی لابراتواری','Laboratory putty','Laboratuvar putty','معجون مختبري','Лабораторная масса'),light_cure:L('نوری','Light cure','Işıkla sertleşen','تصلب ضوئي','Световое отверждение'),self_cure:L('خودپخت','Self cure','Kendiliğinden sertleşen','تصلب ذاتي','Самоотверждение'),dual_cure:L('دوگانه','Dual cure','Çift sertleşen','تصلب مزدوج','Двойное отверждение'),non_curing_gel:L('ژل بدون پخت','Non-curing gel','Sertleşmeyen jel','جل غير متصلب','Неотверждаемый гель'),syringe:L('سرنگ','Syringe','Şırınga','حقنة','Шприц'),bottle:L('بطری','Bottle','Şişe','زجاجة','Флакон'),jar_putty:L('ظرف پوتی','Putty container','Putty kabı','عبوة معجون','Контейнер массы'),kit:L('کیت','Kit','Kit','طقم','Набор'),pack:L('بسته','Pack','Paket','عبوة','Упаковка')};
const localize=(read:(locale:ContentLocale)=>string):Localized=>Object.fromEntries(productEditorLocales.map(locale=>[locale,read(locale)])) as Localized;
const enumText=(value:string,locale:ContentLocale)=>enumLabels[value as keyof typeof enumLabels]?.[locale]||value;
const benefits=(release:ProductRelease,locale:ContentLocale):Localized[]=>{
 const rows=Object.fromEntries(productEditorLocales.map(language=>[language,release.localized[language].benefits.split(/\r?\n/).map(value=>value.trim()).filter(Boolean)])) as Record<ContentLocale,string[]>;
 return rows[locale].map((_,index)=>localize(language=>rows[language][index]||''));
};

/** Visible catalogue rows are the reviewed values, including explicit empty lists. */
export function releaseSpecificationRows(release:ProductRelease):Product['specs']{
 const keys=release.family==='teeth'?['materialClass','toothPosition','arch','layerCount','mouldCodes','shadeSystem','availableShades'] as const:['category','concentrationOrGeneration','curingMethod','deliveryForm','netQuantity','quantityUnit','curingTimeSeconds','etchingTimeSeconds','storageTemperatureCelsius'] as const;
 const technical=keys.filter(key=>{const value=release.technical[key];return Array.isArray(value)?value.length>0:!!value.trim();}).map(key=>({label:{...labels[key]},value:localize(locale=>{const value=release.technical[key];return Array.isArray(value)?value.map(item=>enumText(item,locale)).join(' · '):enumText(value,locale);})}));
 return [...technical,...release.specifications.map(row=>({label:{...row.label},value:row.type==='text'?{...row.value}:localize(locale=>{const numeric=editorNumber(row.numberValue);return numeric.value===null?'':`${new Intl.NumberFormat(locale,{maximumFractionDigits:12,useGrouping:false}).format(numeric.value)}${row.unit.trim()?' '+row.unit.trim():''}`;})}))];
}

/** Source objects are immutable. A validated local release supplies the visible product. */
export function productFromRelease(original:Product,value:unknown,locale:ContentLocale):Product{
 const release=parseProductRelease(value,original);if(!release)return original;
 return {...original,slug:release.slug??original.slug,brand:release.brand??original.brand,family:release.family,name:{...original.name,[locale]:release.localized[locale].title},description:{...original.description,[locale]:release.localized[locale].shortDescription},material:{...release.material},features:benefits(release,locale),specs:releaseSpecificationRows(release),image:release.gallery[0]?.url||'/media/brand/product-placeholder.svg',gallery:release.gallery.map(image=>image.url),downloads:release.downloads.map(file=>({label:{...file.label},url:file.url,sourceUrl:file.sourceUrl}))};
}
