'use client';
import Link from 'next/link';
import {ArrowUpRight,Bookmark,Check,GitCompareArrows,Plus,X} from 'lucide-react';
import PublicImage from '@/components/ui/PublicImage';
import {useApp} from '@/components/providers/AppProvider';
import {usePublishedProduct} from '@/lib/publications';
import {normalizeComparisonIds} from '@/lib/catalog-logic';
import {isCustomProductId,productPath} from '@/lib/custom-products';
import type {Product,Localized} from '@/data/catalog';
import './product-publication.css';
const L=(fa:string,en:string,tr:string,ar:string,ru:string):Localized=>({fa,en,tr,ar,ru});
const labels={
 manualProduct:L('انتشار جدید محصول','New product publication','Yeni ürün yayını','منشور منتج جديد','Новая публикация продукта'),
 localPreview:L('نسخه منتشرشده','Published version','Yayınlanmış sürüm','النسخة المنشورة','Опубликованная версия'),
};

export function ProductCard({product:sourceProduct,compact=false}:{product:Product;compact?:boolean}){
 const{locale,t,href,addInquiry,saved,toggleSaved,compare,setCompare,notify,catalog}=useApp();
 const product=usePublishedProduct(sourceProduct,locale);const compared=normalizeComparisonIds(compare,catalog);const comparing=compared.includes(product.id);
 const compareProduct=()=>{if(comparing){setCompare(compared.filter(id=>id!==product.id));return;}if(compared.length&&(compared.length>=4||catalog.find(p=>p.id===compared[0])?.family!==product.family)){notify(t('compareLimit'));return;}setCompare([...compared,product.id]);};
 return <article className={`product-card glass ${compact?'compact':''}`}>
  <div className="product-card-top"><span className="badge">{t(product.family)}</span><button type="button" className={`icon-btn ${saved.includes(product.id)?'active':''}`} onClick={()=>toggleSaved(product.id)} aria-label={`${t('save')}: ${product.name[locale]}`} aria-pressed={saved.includes(product.id)}><Bookmark size={17} fill={saved.includes(product.id)?'currentColor':'none'}/></button></div>
  <Link href={href(productPath(product))} className="product-image"><PublicImage src={product.image} alt={product.name[locale]} loading="lazy" width={440} height={340} draggable={false}/><span className="product-orbit"/></Link>
  <div className="product-card-body"><small className="product-brand" dir="auto">{product.brand}</small>{product.localPublication&&<span className="badge">{isCustomProductId(product.id)?labels.manualProduct[locale]:labels.localPreview[locale]}</span>}<Link href={href(productPath(product))}><h3>{product.name[locale]}</h3></Link><p>{product.description[locale]}</p><div className="product-card-actions"><Link className="text-link" href={href(productPath(product))}>{t('details')}<ArrowUpRight size={16} className="directional"/></Link><div><button type="button" className={`icon-btn ${comparing?'active':''}`} onClick={compareProduct} aria-label={`${t('compare')}: ${product.name[locale]}`} aria-pressed={comparing}>{comparing?<Check size={17}/>:<GitCompareArrows size={17}/>}</button><button type="button" className="icon-btn primary-icon" onClick={()=>addInquiry(product.id)} aria-label={`${t('addInquiry')}: ${product.name[locale]}`}><Plus size={19}/></button></div></div></div>
 </article>;
}
export function CompareBar(){const{compare,setCompare,href,t,locale,catalog}=useApp();const ids=normalizeComparisonIds(compare,catalog);if(!ids.length)return null;return <div className="compare-bar glass"><GitCompareArrows size={20}/><span>{t('compare')} <bdi dir="ltr">{ids.length} / 4</bdi></span><div className="compare-thumbs">{ids.map(id=>{const product=catalog.find(p=>p.id===id);return product&&<PublicImage key={id} src={product.image} alt={product.name[locale]}/>;})}</div><Link href={href('compare')} className="btn btn-primary">{t('compare')}<ArrowUpRight size={16}/></Link><button type="button" className="icon-btn" aria-label={t('clearCompare')} onClick={()=>setCompare([])}><X size={18}/></button></div>;}

