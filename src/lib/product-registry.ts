import type {Locale} from './i18n';

export type ProductRegistryKind='serial'|'batch';
export type ProductRegistryStatus='registered'|'recalled'|'withdrawn';
export interface ProductRegistryValue {
  code:string;kind:ProductRegistryKind;productId:string;batchCode:string;status:ProductRegistryStatus;internalNote:string;
}
export interface ProductRegistryEntry extends ProductRegistryValue {
  id:string;version:number;createdAt:string;updatedAt:string;archivedAt:string|null;
}
export interface ProductRegistryDirectory {
  items:ProductRegistryEntry[];products:{id:string;names:Record<Locale,string>}[];canManage:boolean;nextCursor:string|null;
}
export type ProductRegistryLookup=
  |{matched:false;code:string;locale:Locale;state:'not_registered'}
  |{matched:true;code:string;locale:Locale;state:'registered';kind:ProductRegistryKind;status:ProductRegistryStatus;product:{id:string;name:string};batchCode:string};

/** Lookup is exact after ASCII case/outer-whitespace normalization. Wildcards,
 * invisible Unicode, partial identifiers and fuzzy matching are not accepted. */
export function normalizeRegistryCode(value:string):string|null {
  const code=value.trim().toUpperCase();return /^[A-Z0-9][A-Z0-9._/-]{3,79}$/.test(code)?code:null;
}
