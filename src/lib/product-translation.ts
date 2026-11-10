import {products,type ContentLocale,type Product} from '@/data/catalog';
import type {WorkspaceRecord} from '@/data/workspace-seed';
import {parseCustomProduct} from '@/lib/custom-products';
import {createProductRelease,type ProductRelease} from '@/lib/product-release';
import {readProductDraft,productEditorLocales,type ProductEditorDraft} from '@/components/workspace/product-editor-data';

export interface ProductTranslationFields {title:string;summary:string;body:string}
export type ProductTranslationProblem='source'|'length'|'review';
export class ProductTranslationError extends Error {
 readonly problem:ProductTranslationProblem;
 constructor(problem:ProductTranslationProblem){super(problem);this.problem=problem;}
}
const plain=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
function canonical(value:unknown):string {
 if(value===undefined)return 'undefined';
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 const row=value as Record<string,unknown>;
 return '{'+Object.keys(row).filter(key=>row[key]!==undefined).sort().map(key=>JSON.stringify(key)+':'+canonical(row[key])).join(',')+'}';
}
const equal=(before:unknown,after:unknown)=>canonical(before)===canonical(after);
const text=(value:unknown):value is string=>typeof value==='string'&&value.length<=30000;

/** Read the same persisted fields as ProductEditor, without silently normalizing an existing draft. */
export function productTranslationSource(record:WorkspaceRecord):{product:Product;draft:ProductEditorDraft}|null {
 if(record.collection!=='products')return null;
 const id=record.product||record.id;
 const product=parseCustomProduct(record.details?.customProduct)||products.find(candidate=>candidate.id===id);
 if(!product||product.id!==id)return null;
 const stored=record.details?.productDraft,draft=readProductDraft(stored,product);
 // A malformed or future draft must be repaired in the product editor, not overwritten by translation.
 if(stored!==undefined&&!equal(stored,draft))return null;
 if(stored===undefined)for(const locale of productEditorLocales){
  draft.localized[locale].title=record.title[locale]??draft.localized[locale].title;
  draft.localized[locale].shortDescription=record.summary[locale]??draft.localized[locale].shortDescription;
 }
 return {product,draft};
}

export function productTranslationFields(record:WorkspaceRecord,locale:ContentLocale):ProductTranslationFields|null {
 const source=productTranslationSource(record);if(!source)return null;
 const content=source.draft.localized[locale];
 return {title:content.title,summary:content.shortDescription,body:content.fullDescription};
}

/** Save only the selected language; review snapshots are created only on explicit submission. */
export function productTranslationPatch(record:WorkspaceRecord,locale:ContentLocale,value:ProductTranslationFields,status:'draft'|'review',author:string,updatedAt=new Date().toISOString()):Partial<WorkspaceRecord> {
 const source=productTranslationSource(record);if(!source)throw new ProductTranslationError('source');
 if(!productEditorLocales.includes(locale)||!Object.values(value).every(text))throw new ProductTranslationError('length');
 const draft:ProductEditorDraft={...source.draft,revision:source.draft.revision+1,updatedAt,savedAt:updatedAt,author,
  localized:{...source.draft.localized,[locale]:{...source.draft.localized[locale],title:value.title,shortDescription:value.summary,fullDescription:value.body}}};
 let productReviewDraft:ProductRelease|undefined;
 try{if(status==='review')productReviewDraft=createProductRelease(draft,source.product);}catch{throw new ProductTranslationError('review');}
 return {title:{...record.title,[locale]:value.title},summary:{...record.summary,[locale]:value.summary},status,
  details:{...record.details,productDraft:draft,productReviewDraft}};
}

/** Shared browser/server authorization: no technical, foreign-language, or forged review-snapshot edits. */
export function permittedProductTranslation(before:WorkspaceRecord,after:WorkspaceRecord,allowed:(locale:ContentLocale)=>boolean,author:string):boolean {
 try{
  if(before.collection!=='products'||after.collection!=='products'||!['draft','review'].includes(after.status))return false;
  const source=productTranslationSource(before),value=after.details?.productDraft;
  if(!source||!plain(value))return false;
  const next=readProductDraft(value,source.product);
  if(!equal(value,next)||next.revision!==source.draft.revision+1||!Number.isSafeInteger(next.revision)||next.author!==author||next.savedAt!==next.updatedAt||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(next.updatedAt)||!Number.isFinite(Date.parse(next.updatedAt)))return false;
  const expected:ProductEditorDraft={...source.draft,revision:next.revision,updatedAt:next.updatedAt,savedAt:next.savedAt,author,
   localized:{...source.draft.localized}};
  for(const locale of productEditorLocales){
   if(!allowed(locale))continue;
   const content=next.localized[locale];
   if(![content.title,content.shortDescription,content.fullDescription].every(text))return false;
   expected.localized[locale]={...source.draft.localized[locale],title:content.title,shortDescription:content.shortDescription,fullDescription:content.fullDescription};
   const changed=!equal(expected.localized[locale],source.draft.localized[locale])||before.title[locale]!==after.title[locale]||before.summary[locale]!==after.summary[locale];
   if(changed&&(after.title[locale]!==content.title||after.summary[locale]!==content.shortDescription))return false;
  }
  if(!equal(expected,next))return false;
  const review=after.status==='review'?createProductRelease(next,source.product):undefined;
  return equal(after.details?.productReviewDraft,review);
 }catch{return false;}
}
