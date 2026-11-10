'use client';
import {useMemo} from 'react';
import type {Product} from '@/data/catalog';
import {localized,localeNames,locales,type Locale} from '@/lib/i18n';
import {localizedPath,productPath} from '@/lib/custom-products';
import {getPublishedProductInventory,type PublishedProduct} from '@/lib/publications';
const sourceTitleLabel=localized('زبان منبع','Source language','Kaynak dili','لغة المصدر','Язык оригинала');
/** Existing inquiry IDs retain their published identity across interface languages. */
export function useExistingProductDisplay(catalog:Product[]){return useMemo(()=>{const merged=new Map(catalog.map(product=>[product.id,product]));for(const product of getPublishedProductInventory())if(!merged.has(product.id))merged.set(product.id,product);return [...merged.values()];},[catalog]);}
function existingProductTitle(product:Product|undefined,locale:Locale,fallback='—'){
 if(!product)return {title:fallback,language:locale};
 const published=product as PublishedProduct,source=published.sourceName||published.sourceProduct?.name;
 for(const language of [locale,...(published.localPublication?.locale?[published.localPublication.locale]:[]),'fa',...locales] as Locale[]){const title=product.name[language]?.trim()||source?.[language]?.trim();if(title)return {title,language};}
 return {title:product.brand||fallback,language:locale};
}
export function existingProductHref(product:Product,locale:Locale){return localizedPath(locale,productPath(product));}
export function ExistingProductName({product,locale,fallback}:{product:Product|undefined;locale:Locale;fallback?:string}){const name=existingProductTitle(product,locale,fallback);return <><bdi lang={name.language}>{name.title}</bdi>{name.language!==locale&&<small className="badge" style={{fontSize:10,marginInlineStart:6}}>{sourceTitleLabel[locale]}: <bdi>{localeNames[name.language]}</bdi></small>}</>;}
