'use client';
import Link from 'next/link';
import {useEffect,useMemo,useState} from 'react';
import {ArrowUpRight,Grid2X2,Layers3,List,Search,SlidersHorizontal,X} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {EmptyState} from '@/components/ui/Primitives';
import {useCatalogProducts} from '@/lib/publications';
import type {Localized} from '@/data/catalog';
import {ProductCard,CompareBar} from './ProductCard';
const L=(fa:string,en:string,tr:string,ar:string,ru:string):Localized=>({fa,en,tr,ar,ru});
const labels={
 catalogNote:L('کاتالوگ کارخانه و به‌روزرسانی‌های بازبینی‌شده؛ منابع هر محصول در صفحه خودش مشخص‌اند.','Factory catalogue and reviewed updates. Each product page identifies its sources.','Fabrika kataloğu ve incelenmiş güncellemeler. Her ürün sayfası kaynakları belirtir.','كتالوج المصنع والتحديثات المراجعة. توضح صفحة كل منتج مصادره.','Каталог фабрики и проверенные обновления. Источники указаны на странице каждого продукта.'),
 brand:L('برند محصول','Product brand','Ürün markası','علامة المنتج','Марка продукта'),
};

export function ProductCatalog({category}:{category?:string}){
 const{locale,t,href}=useApp();const catalog=useCatalogProducts(locale);const initialFamily=category==='teeth'||category==='materials'?category:'all';const[family,setFamily]=useState(initialFamily);const[query,setQuery]=useState('');const[mode,setMode]=useState('grid');const[sort,setSort]=useState('default');const[brand,setBrand]=useState('all');
 useEffect(()=>{setFamily(initialFamily);setBrand('all');},[initialFamily]);
 const filtered=useMemo(()=>catalog.filter(p=>(family==='all'||p.family===family)&&(brand==='all'||p.brand===brand)&&[p.name[locale],p.name.fa,p.name.en,p.brand,p.id,p.material[locale],...p.specs.flatMap(s=>[s.label[locale],s.value[locale],s.value.en])].join(' ').toLocaleLowerCase(locale).includes(query.trim().toLocaleLowerCase(locale))).sort((a,b)=>sort==='name'?a.name[locale].localeCompare(b.name[locale],locale,{numeric:true,sensitivity:'base'}):sort==='brand'?a.brand.localeCompare(b.brand,locale):0),[catalog,family,brand,query,locale,sort]);
 const brands=useMemo(()=>Array.from(new Set(catalog.filter(p=>family==='all'||p.family===family).map(p=>p.brand))),[catalog,family]);
 return <div className="container page-content"><div className="page-intro"><span className="eyebrow">{t('builtFor')}</span><h1>{initialFamily==='all'?t('allProducts'):t(initialFamily)}</h1><p>{t('familiesDescription')}</p><div className="intro-meta"><span>{catalog.length.toLocaleString(locale)} {t('products')}</span><span>{catalog.some(product=>product.localPublication)?labels.catalogNote[locale]:t('sourceNote')}</span></div></div><div className="catalog-layout">
  <aside className="catalog-filters glass"><h2><SlidersHorizontal size={17}/>{t('filters')}</h2><div className="filter-group"><span>{t('family')}</span>{['all','teeth','materials'].map(f=><button type="button" className={family===f?'selected':''} aria-pressed={family===f} key={f} onClick={()=>{setFamily(f);setBrand('all');}}><span>{t(f)}</span><small>{catalog.filter(p=>f==='all'||p.family===f).length.toLocaleString(locale)}</small></button>)}</div><label className="field"><span>{labels.brand[locale]}</span><select className="input" aria-label={labels.brand[locale]} value={brand} onChange={e=>setBrand(e.target.value)}><option value="all">{t('all')}</option>{brands.map(value=><option value={value} key={value}>{value}</option>)}</select></label><button type="button" className="text-link" onClick={()=>{setFamily(initialFamily);setBrand('all');setQuery('');setSort('default');}}>{t('reset')}<X size={14}/></button><div className="filter-help"><Layers3 size={23}/><h3>{t('professionalTools')}</h3><p>{t('matcher')}</p><Link className="text-link" href={href('tools/shade-mould-matcher')}>{t('matcher')}<ArrowUpRight size={15}/></Link></div></aside>
  <div className="catalog-main"><div className="catalog-toolbar"><label className="search-input"><Search size={19}/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('search')}/></label><select className="input sort-select" value={sort} onChange={e=>setSort(e.target.value)} aria-label={t('sort')}><option value="default">{t('sort')}</option><option value="name">{t('name')}</option><option value="brand">{labels.brand[locale]}</option></select><div className="view-switch"><button type="button" aria-label={t('grid')} aria-pressed={mode==='grid'} onClick={()=>setMode('grid')}><Grid2X2 size={18}/></button><button type="button" aria-label={t('list')} aria-pressed={mode==='list'} onClick={()=>setMode('list')}><List size={18}/></button></div></div><div className="catalog-count" aria-live="polite">{t('viewing')} <b>{filtered.length.toLocaleString(locale)}</b> {t('products')}</div>{filtered.length?<div className={`product-grid ${mode==='list'?'product-list':''}`}>{filtered.map(product=><ProductCard key={product.id} product={product}/>)}</div>:<EmptyState title={t('noResults')} description={t('reset')}/>}</div>
 </div><CompareBar/></div>;
}

