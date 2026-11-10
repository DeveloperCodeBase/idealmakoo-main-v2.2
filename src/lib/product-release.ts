import {products,type Product,type Localized,type ContentLocale} from '@/data/catalog';
import {parseCustomProduct} from '@/lib/custom-products';
import {createProductDraft,readProductDraft,validateProductDraft,productEditorLocales,materialClasses,materialCategories,curingMethods,deliveryForms,quantityUnits,type ProductEditorDraft,type EditorTranslation,type EditorSpecification,type EditorVariant,type EditorGallery,type EditorDownload} from '@/components/workspace/product-editor-data';

/** An immutable local editorial snapshot. Its presence does not assert factory verification. */
export interface ProductRelease {
 schemaVersion:1;
 productId:string;
 revision:number;
 draftUpdatedAt:string;
 family:'teeth'|'materials';
 originalSourceUrl:string;
 brand?:string;
 slug?:string;
 productCode?:string;
 authoredSourceUrl?:string;
 localized:Record<ContentLocale,Omit<EditorTranslation,'seoTitle'|'seoDescription'>>;
 material:Localized;
 technical:ProductEditorDraft['technical'];
 specifications:EditorSpecification[];
 variants:EditorVariant[];
 gallery:EditorGallery[];
 downloads:EditorDownload[];
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=(path:string):never=>{throw new Error(`Invalid product release: ${path}`);};
const string=(value:unknown,path:string,max=30000):string=>typeof value==='string'&&value.length<=max?value:fail(path);
const local=(value:unknown,path:string):Localized=>{if(!object(value))return fail(path);return Object.fromEntries(productEditorLocales.map(locale=>[locale,string(value[locale],`${path}.${locale}`)])) as Localized;};
const rows=<T>(value:unknown,path:string,read:(value:Record<string,unknown>,path:string)=>T):T[]=>{if(!Array.isArray(value)||value.length>200)return fail(path);return value.map((row,index)=>object(row)?read(row,`${path}.${index}`):fail(`${path}.${index}`));};
const common=(row:Record<string,unknown>,path:string)=>({id:string(row.id,path+'.id',240),sourceUrl:string(row.sourceUrl,path+'.sourceUrl',4000)});
const contentKeys=['title','subtitle','shortDescription','fullDescription','indications','benefits','packagingInfo'] as const;
function content(value:unknown):ProductRelease['localized']{if(!object(value))return fail('localized');return Object.fromEntries(productEditorLocales.map(locale=>{const entry=value[locale];if(!object(entry))return fail(`localized.${locale}`);return [locale,Object.fromEntries(contentKeys.map(key=>[key,string(entry[key],`localized.${locale}.${key}`)]))];})) as ProductRelease['localized'];}
function technical(value:unknown):ProductRelease['technical']{
 if(!object(value))return fail('technical');const result={} as ProductRelease['technical'];
 for(const key of ['materialClass','layerCount','mouldCodes','shadeSystem','availableShades','category','concentrationOrGeneration','curingMethod','deliveryForm','netQuantity','quantityUnit','curingTimeSeconds','etchingTimeSeconds','storageTemperatureCelsius'] as const)result[key]=string(value[key],`technical.${key}`,4000);
 const choiceArray=(key:string,choices:readonly string[])=>{const arr=value[key];if(!Array.isArray(arr)||arr.length>choices.length||arr.some(item=>typeof item!=='string'||!choices.includes(item))||new Set(arr).size!==arr.length)return fail(`technical.${key}`);return [...arr] as string[];};
 result.arch=choiceArray('arch',['upper','lower']) as ProductRelease['technical']['arch'];result.toothPosition=choiceArray('toothPosition',['anterior','posterior']) as ProductRelease['technical']['toothPosition'];
 for(const [key,choices]of [['materialClass',materialClasses],['category',materialCategories],['curingMethod',curingMethods],['deliveryForm',deliveryForms],['quantityUnit',quantityUnits]] as const)if(result[key]&&!(choices as readonly string[]).includes(result[key]))fail(`technical.${key}`);
 return result;
}
/** Strictly whitelist every public field; malformed rows are rejected, never filled with official source values. */
function snapshot(value:Record<string,unknown>,original:Product,fromDraft:boolean):ProductRelease{
 const canonical=products.find(product=>product.id===original.id)||parseCustomProduct(original);
 if(!canonical)return fail('productId');
 if(value.schemaVersion!==1||value.productId!==original.id)fail('productId');
 if(value.family!=='teeth'&&value.family!=='materials')fail('family');
 if(typeof value.revision!=='number'||!Number.isSafeInteger(value.revision)||value.revision<1)fail('revision');
 const identifying=(key:'brand'|'slug'|'productCode',fallback:string)=>value[key]===undefined&&!fromDraft?fallback:string(value[key],key,240);
 const brand=identifying('brand',canonical.brand),slug=identifying('slug',canonical.slug),productCode=identifying('productCode',canonical.id);
 if(!brand.trim()||!productCode.trim()||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))fail('identity');
 const authoredSourceUrl=string(value[fromDraft?'sourceUrl':'authoredSourceUrl']??canonical.sourceUrl,'authoredSourceUrl',4000);
 const result:ProductRelease={schemaVersion:1,productId:original.id,revision:value.revision as number,draftUpdatedAt:string(value[fromDraft?'updatedAt':'draftUpdatedAt'],'draftUpdatedAt',100),family:value.family as ProductRelease['family'],originalSourceUrl:canonical!.sourceUrl,brand,slug,productCode,authoredSourceUrl,localized:content(value.localized),material:local(value.material,'material'),technical:technical(value.technical),
 specifications:rows(value.specifications,'specifications',(row,path)=>{if(row.type!=='text'&&row.type!=='number')return fail(path+'.type');return {...common(row,path),key:string(row.key,path+'.key',240),label:local(row.label,path+'.label'),type:row.type,value:local(row.value,path+'.value'),numberValue:string(row.numberValue,path+'.numberValue',100),unit:string(row.unit,path+'.unit',240)};}),
 variants:rows(value.variants,'variants',(row,path)=>{if(typeof row.arch!=='string'||typeof row.position!=='string'||!['','upper','lower'].includes(row.arch)||!['','anterior','posterior'].includes(row.position))return fail(path+'.position');return {...common(row,path),sku:string(row.sku,path+'.sku',240),shade:string(row.shade,path+'.shade',240),mould:string(row.mould,path+'.mould',240),unit:string(row.unit,path+'.unit',240),unitsPerPack:string(row.unitsPerPack,path+'.unitsPerPack',100),arch:row.arch as EditorVariant['arch'],position:row.position as EditorVariant['position']};}),
 gallery:rows(value.gallery,'gallery',(row,path)=>({...common(row,path),url:string(row.url,path+'.url',4000),alt:local(row.alt,path+'.alt')})),
 downloads:rows(value.downloads,'downloads',(row,path)=>{if(typeof row.format!=='string'||!['JPG','PNG','WEBP','PDF','OTHER'].includes(row.format)||!productEditorLocales.includes(row.language as ContentLocale))return fail(path+'.format');return {...common(row,path),url:string(row.url,path+'.url',4000),label:local(row.label,path+'.label'),format:row.format as EditorDownload['format'],language:row.language as ContentLocale};})};
 const base=createProductDraft(canonical!);
 const validationDraft:ProductEditorDraft={...base,...result,sourceUrl:authoredSourceUrl,localized:Object.fromEntries(productEditorLocales.map(locale=>[locale,{...base.localized[locale],...result.localized[locale]}])) as ProductEditorDraft['localized']};
 const errors=validateProductDraft(validationDraft).filter(issue=>issue.severity==='error');
 if(errors.length)fail(errors.map(issue=>`${issue.path}:${issue.code}`).join(', '));
 return result;
}
/** Call only when explicitly submitting the draft for review. Review workflow authorization is the caller's responsibility. */
export function createProductRelease(unknownDraft:unknown,original:Product):ProductRelease{
 if(!object(unknownDraft)||unknownDraft.schemaVersion!==1||unknownDraft.productId!==original.id)fail('productId');
 const source=unknownDraft as Record<string,unknown>;
 const release=snapshot(source,original,true);
 // Also validate editor-only identifying fields without exposing them in the public snapshot.
 for(const key of ['slug','brand','productCode','sourceUrl'] as const)string(source[key],key,4000);
 const errors=validateProductDraft(readProductDraft(source,original)).filter(issue=>issue.severity==='error');if(errors.length)fail(errors.map(issue=>`${issue.path}:${issue.code}`).join(', '));
 return release;
}
/** localStorage publications are untrusted, so a corrupt snapshot fails closed. */
export function parseProductRelease(value:unknown,original:Product):ProductRelease|null{try{return object(value)?snapshot(value,original,false):null;}catch{return null;}}
export function exportProductRelease(value:unknown,original:Product):string{const release=parseProductRelease(value,original);if(!release)fail('snapshot');return JSON.stringify({schema:'IdealMakooLocalProductRelease',productRelease:release,provenance:{scope:'local_reviewed_content',factoryVerified:false,publicOfficialSourceChanged:false}},null,2);}
