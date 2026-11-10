import {products,type ContentLocale,type Localized,type Product} from '@/data/catalog';
const L=(fa:string,en:string,tr:string,ar:string,ru:string):Localized=>({fa,en,tr,ar,ru});
const labels={
 notDocumented:L('در منبع منتشر نشده','Not published in the source','Kaynakta yayımlanmamış','غير منشور في المصدر','Не опубликовано в источнике'),
 family:L('خانواده محصول','Product family','Ürün ailesi','عائلة المنتج','Семейство продукта'),
 teeth:L('دندان مصنوعی','Denture teeth','Protez dişler','الأسنان الصناعية','Искусственные зубы'),
 materials:L('مواد دندانی','Dental materials','Dental malzemeler','المواد السنية','Стоматологические материалы'),
 material:L('مواد','Material','Malzeme','المادة','Материал'),
 features:L('ویژگی‌های مستند','Documented features','Belgelenmiş özellikler','الميزات الموثقة','Документированные особенности'),
};

/** Comparison accepts distinct known products, from the first valid product's family, capped at four. */
export function normalizeComparisonIds(value:unknown,catalog:Product[]=products):string[]{
 if(!Array.isArray(value))return [];
 const ids:string[]=[];let family:Product['family']|undefined;
 for(const item of value){if(typeof item!=='string'||ids.includes(item))continue;const product=catalog.find(p=>p.id===item);if(!product)continue;if(!family)family=product.family;if(product.family!==family)continue;ids.push(product.id);if(ids.length===4)break;}
 return ids;
}
export interface ComparisonRow {key:string;label:string;values:string[];}
/** Preserve every sourced specification; absent values are explicitly unknown, never inferred. */
export function buildComparisonRows(selected:Product[],locale:ContentLocale):ComparisonRow[]{
 const missing=labels.notDocumented[locale];
 const rows:ComparisonRow[]=[
  {key:'family',label:labels.family[locale],values:selected.map(p=>labels[p.family][locale])},
  {key:'material',label:labels.material[locale],values:selected.map(p=>p.material[locale]||missing)},
  {key:'features',label:labels.features[locale],values:selected.map(p=>p.features.map(f=>f[locale]).join(' · ')||missing)},
 ];
 const specLabels=new Map<string,Localized>();
 for(const product of selected)for(const spec of product.specs){const key=spec.label.en.trim().toLowerCase();if(key!=='material'&&!specLabels.has(key))specLabels.set(key,spec.label);}
 for(const [key,label] of specLabels)rows.push({key:`spec:${key}`,label:label[locale],values:selected.map(p=>p.specs.find(s=>s.label.en.trim().toLowerCase()===key)?.value[locale]||missing)});
 return rows;
}
export function comparisonRowDiffers(row:ComparisonRow){return new Set(row.values.map(v=>v.normalize('NFKC').replace(/\s+/g,' ').trim())).size>1;}
