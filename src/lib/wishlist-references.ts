export const wishlistLimits={lists:50,itemsPerList:500,totalItems:5000,activeShares:20,maxShareMinutes:30*24*60} as const;
export const wishlistPublicationKinds=['research','resources','news','event','page','hr','knowledge','glossary'] as const;
export type WishlistPublicationKind=typeof wishlistPublicationKinds[number];
export type WishlistReference={kind:'product'|'article'|'resource'|'reference'|'document';id:string}|{kind:'publication';publicationKind:WishlistPublicationKind;id:string}|{kind:'legacy';id:string};
export interface WishlistDraftItem {id?:string;reference:WishlistReference;note:string}
export interface WishlistDraft {name:string;description:string;purpose:'general'|'project';items:WishlistDraftItem[]}
export const wishlistKey=(reference:WishlistReference):string=>reference.kind==='publication'?`publication:${reference.publicationKind}:${reference.id}`:`${reference.kind}:${reference.id}`;
export const wishlistSavedId=(reference:WishlistReference):string=>reference.kind==='product'||reference.kind==='legacy'?reference.id:wishlistKey(reference);
export function resolveSavedReference(value:string,candidates:readonly WishlistReference[],existing:readonly WishlistReference[]=[]):WishlistReference|null{
 const exact=existing.find(reference=>wishlistSavedId(reference)===value);if(exact)return exact;
 const keyed=candidates.find(reference=>wishlistSavedId(reference)===value||wishlistKey(reference)===value);if(keyed)return keyed;
 const raw=candidates.filter(reference=>reference.id===value);return raw.length===1?raw[0]:null;
}
export function wishlistDraftChanged(current:WishlistDraft,saved:WishlistDraft):boolean{return current.name!==saved.name||current.description!==saved.description||current.purpose!==saved.purpose||current.items.length!==saved.items.length||current.items.some((item,index)=>{const other=saved.items[index];return item.id!==other.id||wishlistKey(item.reference)!==wishlistKey(other.reference)||item.note!==other.note;});}
