import type {RoleKey} from '@/types/domain';
import type {Localized,ContentLocale} from '@/data/catalog';
export interface PricebookPolicy {schemaVersion:1;market:string;validFrom?:string;validUntil?:string}
export interface PricebookEntry {id:string;productId:string;titleSnapshot:string;unit:string;unitPriceDecimal:string;currency:string}
export interface PricebookVersion {id:string;pricebookId:string;version:number;title:Localized;market:string;currency:string;validFrom:string;validUntil?:string;entries:PricebookEntry[];checksum:string;approvedById:string;approvedAt:string}
export interface CommercialPolicy {version:number;discountCeilings:Record<RoleKey,string>;createdAt:string}
export interface QuoteCustomerSnapshot {name:string;email:string;organization:string;phone?:string;country?:string;address?:string;taxId?:string}
export interface QuoteSellerSnapshot {name:string;email?:string;phone?:string;address?:string;website?:string;registrationId?:string;taxId?:string}
export interface QuotePricebookSnapshot {id:string;pricebookId:string;version:number;title?:Localized;market:string;currency:string;checksum:string;validFrom?:string;validUntil?:string}
export interface QuoteEnvelope {recordId:string;requestId:string;currentRevisionId:string;version:number;updatedAt:string}
export type QuoteLocale=ContentLocale;
