import {articles,products,resources,type ContentLocale} from '@/data/catalog';
import {referenceDocuments} from '@/data/reference-documents';
import {parseCustomProduct} from '@/lib/custom-products';
import {parseProductRelease} from '@/lib/product-release';
import {publicationPath} from '@/lib/publication-path';
import {wishlistKey,wishlistPublicationKinds,type WishlistReference,type WishlistPublicationKind} from '@/lib/wishlist-references';
import {isPublicArticleVisible,isPublicPathVisible,type PublicVisibilitySnapshot} from '@/lib/public-visibility';
import type {LocalPublication} from '@/data/workspace-seed';
export interface WishlistCandidate {reference:WishlistReference;title:string;summary:string;href:string;category:'product'|'article'|'document'|'page';public:boolean;imageUrl?:string}
export function wishlistPageHref(locale:ContentLocale,path:string):string|null{
 const clean=path.replace(/^\/+|\/+$/g,'');
 if(clean&&!/^[a-z0-9]+(?:[/-][a-z0-9]+)*$/.test(clean))return null;
 if(/^(?:admin|account|auth|api|_next|saved-share|feedback|communication-preferences|communication-unsubscribe|communication-verification)(?:\/|$)/.test(clean))return null;
 return `/${locale}/${clean}${clean?'/':''}`;
}
function image(value:unknown):string|undefined{return typeof value==='string'&&/^\/media\/[a-zA-Z0-9_./-]+\.(?:png|jpe?g|webp|avif|gif|svg)$/.test(value)&&!value.includes('..')?value:undefined;}
export function publicWishlistCandidates(publications:readonly LocalPublication[],hiddenProducts:readonly string[],locale:ContentLocale,site?:PublicVisibilitySnapshot|null):WishlistCandidate[]{
 const output=new Map<string,WishlistCandidate>(),hidden=new Set(hiddenProducts);
 const add=(reference:WishlistReference,title:string,summary:string,path:string,category:WishlistCandidate['category'],imageUrl?:string)=>{
  const href=wishlistPageHref(locale,path);if(!href||!title.trim()||!isPublicPathVisible(site,locale,path)||reference.kind==='article'&&!isPublicArticleVisible(site,locale,reference.id))return;
  const safeImage=image(imageUrl);output.set(wishlistKey(reference),{reference,title,summary,href,category,public:true,...safeImage?{imageUrl:safeImage}:{}});
 };
 for(const product of products)if(!hidden.has(product.id))add({kind:'product',id:product.id},product.name[locale],product.description[locale],`products/${product.slug}`,'product',product.image);
 for(const article of articles)add({kind:'article',id:article.id},article.title[locale],article.excerpt[locale],`research/${article.slug}`,'article',article.image);
 for(const resource of resources)add({kind:'resource',id:resource.id},resource.title[locale],'',`resources/${resource.slug}`,'document',resource.format==='JPG'?resource.url:undefined);
 for(const reference of referenceDocuments)add({kind:'reference',id:reference.id},reference.title[locale],reference.summary[locale],`resources/${reference.slug}`,'document',reference.pages[0]?.image);
 const released=publications.filter(row=>row.locale===locale).sort((a,b)=>Date.parse(a.publishedAt)-Date.parse(b.publishedAt)||a.version-b.version);
 for(const publication of released){
  if(publication.kind==='product'){
   const custom=parseCustomProduct(publication.customProduct),base=products.find(product=>product.id===publication.productRelease?.productId)||products.find(product=>product.id===publication.id)||custom;
   if(!base||hidden.has(base.id)||hidden.has(publication.id))continue;
   const release=parseProductRelease(publication.productRelease,base);if(custom&&base.id===custom.id&&!release)continue;
   const path=publicationPath(publication),expected=`products/${release?.slug||base.slug}`;if(path!==expected)continue;
   add({kind:'product',id:base.id},publication.title,publication.summary,path,'product',release?.gallery[0]?.url||base.image);continue;
  }
  if(!wishlistPublicationKinds.some(kind=>kind===publication.kind))continue;
  const path=publicationPath(publication),kind=publication.kind as WishlistPublicationKind;
  const originalArticle=kind==='research'?articles.find(row=>row.id===publication.id||`research/${row.slug}`===path):undefined;
  const originalResource=kind==='resources'?resources.find(row=>row.id===publication.id||`resources/${row.slug}`===path):undefined;
  const originalReference=kind==='resources'?referenceDocuments.find(row=>row.id===publication.id||`resources/${row.slug}`===path):undefined;
  const reference:WishlistReference=originalArticle?{kind:'article',id:originalArticle.id}:originalResource?{kind:'resource',id:originalResource.id}:originalReference?{kind:'reference',id:originalReference.id}:{kind:'publication',publicationKind:kind,id:publication.id};
  add(reference,publication.title,publication.summary,path,kind==='resources'?'document':kind==='page'?'page':'article',publication.blocks.find(block=>!block.hidden&&block.type==='image')?.mediaUrl);
 }
 return [...output.values()];
}
