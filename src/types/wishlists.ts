import type {Locale} from '@/lib/i18n';
import type {WishlistCandidate} from '@/lib/wishlist-catalog';
import type {WishlistDraft,WishlistReference} from '@/lib/wishlist-references';
export type {WishlistReference,WishlistCandidate,WishlistDraft};
export interface WishlistSummary {id:string;name:string;description:string;purpose:'general'|'project';isDefault:boolean;version:number;createdAt:string;updatedAt:string;itemCount:number}
export interface WishlistItem {id:string;reference:WishlistReference;note:string;position:number;createdAt:string;available:boolean;content:WishlistCandidate|null}
export interface Wishlist extends Omit<WishlistSummary,'itemCount'> {items:WishlistItem[]}
export interface WishlistDirectory {items:WishlistSummary[];defaultId:string;limits:{lists:number;itemsPerList:number;totalItems:number;activeShares:number;maxShareMinutes:number}}
export interface WishlistShare {id:string;title:string;locale:Locale;sourceVersion:number;itemCount:number;expiresAt:string;createdAt:string;revokedAt:string|null;version:number}
export interface WishlistSharePreview {listId:string;version:number;locale:Locale;excludedCount:number;items:{itemId:string;content:WishlistCandidate}[]}
export interface PublicWishlist {schemaVersion:1;title:string;locale:Locale;expiresAt:string;items:WishlistCandidate[]}
