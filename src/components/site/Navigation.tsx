'use client';
import PublicImage from '@/components/ui/PublicImage';

import Link from 'next/link';
import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,BookOpen,Check,ChevronDown,ClipboardList,Globe2,Layers3,LayoutDashboard,Menu,Moon,Search,Settings2,Sun,UserRound,X,Download,Factory,Handshake} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {locales,localeNames,type Locale} from '@/lib/i18n';
import {resources,company} from '@/data/catalog';
import {Modal} from '@/components/ui/Primitives';
import {useCatalogProducts,useCatalogArticles,usePublicSiteSnapshot} from '@/lib/publications';
import {siteMenuHref,useSitePreferences,visibleMenuGroups} from '@/lib/site-preferences';
import styles from './preferences.module.css';
import {isPublicPathVisible} from '@/lib/public-visibility';
import {productPath} from '@/lib/custom-products';
import UserMenu from './UserMenu';
import PublicNoticeBanner from './PublicNoticeBanner';
import {demoMode} from '@/lib/api';
import PublicSearch from './PublicSearch';
import {resourceText} from '@/components/resources/resource-copy';
import {accountText} from '@/components/account/account-copy';
import {roleLandingRoute} from '@/lib/auth';
import drawerStyles from './mobile-drawer.module.css';
const groupIcons:Record<string,typeof Layers3>={products:Layers3,research:BookOpen,company:Factory,cooperation:Handshake};
export function Brand({small=false,linked=true,fetchPriority}:{small?:boolean;linked?:boolean;fetchPriority?:"high"|"low"|"auto"}){
 const{t,href,locale}=useApp();const preferences=useSitePreferences();
 const name=preferences.brand.name[locale],englishName=preferences.brand.name.en.toUpperCase();
 // The link's native accessible name follows its visible brand text in every locale.
 // Home is its destination/description; a separate aria-label must not replace the text.
 const content=<><span className="brand-mark"><PublicImage src={preferences.brand.logo} width={40} height={44} sizes="40px" loading="eager" fetchPriority={fetchPriority} alt=""/></span><span className={styles.brandText}><strong title={name}>{name}</strong>{' '}<small dir="ltr">{englishName}</small></span></>;
 return linked?<Link href={href()} className={`brand ${small?'brand-small':''}`} title={t('home')}>{content}</Link>:<span className={`brand ${small?'brand-small':''}`}>{content}</span>;
}
export function ThemeLanguage({compact=false}:{compact?:boolean}){
 const{locale,t,toggleTheme,theme,switchLocale}=useApp();const[open,setOpen]=useState(false);const ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{const close=(e:PointerEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false);};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
 return <div className="theme-language"><button className="icon-btn" onClick={toggleTheme} aria-label={t('theme')} title={t('theme')}>{theme==='dark'?<Sun size={18}/>:<Moon size={18}/>}</button><div className="language-menu" ref={ref}><button className={`language-trigger ${compact?'compact':''}`} aria-label={`${locale.toUpperCase()} — ${t('language')}`} aria-expanded={open} onClick={()=>setOpen(!open)}><Globe2 size={17}/><span>{locale.toUpperCase()}</span><ChevronDown size={12}/></button>{open&&<div className="language-popover glass" role="menu" onKeyDown={e=>{if(e.key==='Escape')setOpen(false);}}>{locales.map(l=><button role="menuitem" key={l} lang={l} dir={l==='fa'||l==='ar'?'rtl':'ltr'} onClick={()=>{switchLocale(l);setOpen(false);}}>{localeNames[l]}{l===locale&&<Check size={14}/>}</button>)}</div>}</div></div>;
}
export default function Navigation(){
 const{t,locale,href,inquiries,session,sessionReady,pathname,theme,toggleTheme,switchLocale}=useApp();const preferences=useSitePreferences();const site=usePublicSiteSnapshot();const groups=visibleMenuGroups(preferences.navigation,site,locale);const products=useCatalogProducts(locale);const featuredProduct=products[10]||products[0];const articles=useCatalogArticles(locale);const[open,setOpen]=useState<string|null>(null);const[mobile,setMobile]=useState(false);const[search,setSearch]=useState(false);const[query,setQuery]=useState('');const ref=useRef<HTMLElement>(null);
 const controlledSearch={items:[] as {title:string;type:string;documentLocale:string;label:string;slug:string;summary:string}[],loading:false,error:'',truncated:false};
 const text=(key:string)=>accountText(locale,key,t);
 const showSearch=()=>{setMobile(false);setOpen(null);setSearch(true);};
 useEffect(()=>{setOpen(null);setMobile(false);setSearch(false);},[pathname,locale,session?.id]);
 useEffect(()=>{
  const compact=window.matchMedia('(max-width: 1100px)'),largeFontCompact=window.matchMedia('(max-width: 1240px)');
  const sync=()=>{
   const compactLayout=compact.matches||(largeFontCompact.matches&&document.documentElement.dataset.fontSize==='large');
   if(compactLayout)setOpen(null);else setMobile(false);
  };
  sync();compact.addEventListener('change',sync);largeFontCompact.addEventListener('change',sync);
  const observer=new MutationObserver(sync);observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-font-size']});
  return()=>{compact.removeEventListener('change',sync);largeFontCompact.removeEventListener('change',sync);observer.disconnect();};
 },[]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setMobile(false);setOpen(null);setSearch(v=>!v);}if(e.key==='Escape'){setOpen(null);setMobile(false);}};const click=(e:PointerEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(null);};document.addEventListener('keydown',key);document.addEventListener('pointerdown',click);return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',click);};},[]);
 const q=query.trim().toLowerCase();const results=[...products.map(p=>({title:p.name[locale],sub:p.brand,path:productPath(p),icon:Layers3})),...articles.map(a=>({title:a.title[locale],sub:t('articles'),path:'research/'+a.slug,icon:BookOpen})),...resources.map(r=>({title:r.title[locale],sub:r.format,path:'resources/'+r.slug,icon:Download})),...controlledSearch.items.map(r=>({title:r.title,sub:`${resourceText(locale,r.type)} · ${r.documentLocale.toUpperCase()} · ${r.label}`,path:'resources/'+r.slug,icon:Download,searchText:r.summary+' '+r.slug}))].filter(x=>isPublicPathVisible(site,locale,x.path)&&(!q||`${x.title} ${x.sub} ${'searchText' in x?x.searchText:''}`.toLowerCase().includes(q))).sort((a,b)=>Number(b.sub.toLowerCase()===q)-Number(a.sub.toLowerCase()===q)||Number(b.title.toLowerCase()===q)-Number(a.title.toLowerCase()===q)).slice(0,9);
 return <>
 <PublicNoticeBanner/>
 <header className={`site-header gn-root ${styles.header}`} ref={ref} dir={locale==='fa'||locale==='ar'?'rtl':'ltr'}>
  <nav className="gn-bar" aria-label={t('menu')} onPointerMove={e=>{const rect=e.currentTarget.getBoundingClientRect();e.currentTarget.style.setProperty('--shine-x',`${((e.clientX-rect.left)/rect.width)*100}%`);}}>
   <Brand fetchPriority="high"/>
   <div className={`gn-links ${styles.navigationLinks}`}>{groups.map(group=><button className={`gn-link ${open===group.id?'active':''}`} key={group.id} aria-expanded={open===group.id} aria-controls={`mega-${group.id}`} title={group.label[locale]} onClick={()=>setOpen(open===group.id?null:group.id)}><span>{group.label[locale]}</span><ChevronDown size={13}/></button>)}<Link href={href('contact')} className="gn-link">{t('contact')}</Link></div>
   <div className={`gn-actions ${styles.headerActions}`}><button type="button" className="icon-btn nav-search" onClick={showSearch} aria-label={t('search')}><Search size={19}/></button><ThemeLanguage/><Link className="inquiry-icon icon-btn" href={href('inquiry-list')} aria-label={`${t('inquiry')} (${inquiries.length})`}><ClipboardList size={20}/>{inquiries.length>0&&<span>{inquiries.length}</span>}</Link>{session?<UserMenu/>:<Link className="btn nav-login" href={href('auth/login')} aria-label={t('login')}><UserRound size={19}/><span>{t('login')}</span></Link>}<button type="button" className="icon-btn mobile-toggle" onClick={()=>{setOpen(null);setSearch(false);setMobile(true);}} aria-label={t('menu')} aria-haspopup="dialog" aria-expanded={mobile}><Menu size={21}/></button></div>
  </nav>
  {groups.map(group=>{const GroupIcon=groupIcons[group.id]||Layers3;return open===group.id&&<div className="mega-menu glass" id={`mega-${group.id}`} key={group.id}><div className="mega-feature"><GroupIcon size={30}/><span className="eyebrow">{preferences.brand.name.en}</span><h3>{group.label[locale]}</h3><p>{t('sourceNote')}</p><Link href={siteMenuHref(group.items[0].path,locale)} className="text-link" onClick={()=>setOpen(null)}>{t('discover')}<ArrowUpRight size={17}/></Link></div><div className="mega-links">{group.items.map(item=><Link href={siteMenuHref(item.path,locale)} key={item.id} onClick={()=>setOpen(null)}><span>{item.label[locale]}</span><ArrowUpRight size={16} className="directional"/></Link>)}</div>{featuredProduct&&<div className="mega-product"><PublicImage src={featuredProduct.image} alt={featuredProduct.name[locale]}/><span dir="ltr">{featuredProduct.brand}</span><small>{t('builtFor')}</small></div>}</div>;})}
 </header>
 {mobile&&<Modal title={t('menu')} className={`${drawerStyles.drawer} ${styles.mobileNavigation}`} onClose={()=>setMobile(false)}>
  <div className={`mobile-nav-content ${styles.mobileNavigationContent}`} onClick={event=>{if(event.target instanceof Element&&event.target.closest('a[href]'))setMobile(false);}}>
   <Brand/>
   <div className={styles.mobileTools}>
    <button type="button" onClick={showSearch}><Search size={19}/><span>{t('search')}</span></button>
    <Link href={href('inquiry-list')}><ClipboardList size={19}/><span>{t('inquiry')}</span>{inquiries.length>0&&<b>{new Intl.NumberFormat(locale).format(inquiries.length)}</b>}</Link>
    <Link href={href(session?'account':'auth/login')}><UserRound size={19}/><span>{session?text('personalAccount'):t('login')}</span></Link>
    {session&&<><Link href={href('account/profile')}><UserRound size={19}/><span>{text('profile')}</span></Link><Link href={href('account/preferences')}><Settings2 size={19}/><span>{text('personalPreferences')}</span></Link>{session.role!=='customer'&&<Link href={href(roleLandingRoute(session.role))}><LayoutDashboard size={19}/><span>{text('staffWorkspace')}</span></Link>}</>}
   </div>
   <div className={styles.mobilePreferences}><button type="button" onClick={toggleTheme}>{theme==='dark'?<Sun size={19}/>:<Moon size={19}/>}<span>{t('theme')}</span></button><label><Globe2 size={18}/><span>{t('language')}</span><select value={locale} onChange={event=>switchLocale(event.target.value as Locale)} aria-label={t('language')}>{locales.map(language=><option key={language} value={language}>{localeNames[language]}</option>)}</select></label></div>
   {groups.map((group,index)=><details key={group.id} open={index===0}><summary>{group.label[locale]}<ChevronDown size={17}/></summary>{group.items.map(item=><Link key={item.id} href={siteMenuHref(item.path,locale)}>{item.label[locale]}<ArrowUpRight size={15}/></Link>)}</details>)}
   <Link className="btn" href={href('contact')}>{t('contact')}</Link>
  </div>
 </Modal>}
 {search&&!demoMode&&<PublicSearch query={query} setQuery={setQuery} onClose={()=>setSearch(false)}/>}
 {search&&demoMode&&<Modal title={t('search')} onClose={()=>setSearch(false)} className="search-dialog"><div className="search-field"><Search size={22}/><input autoFocus aria-label={t('search')} placeholder={t('searchPlaceholder')} maxLength={120} value={query} onChange={e=>setQuery(e.target.value)}/><kbd>⌘ K</kbd></div><div className="search-result-list">{results.map((item,i)=><Link href={href(item.path)} key={item.path+i} onClick={()=>setSearch(false)}><item.icon size={18}/><span>{item.title}<small>{item.sub}</small></span><ArrowUpRight size={16}/></Link>)}{controlledSearch.loading&&<p role="status">{t('loading')}</p>}{controlledSearch.error&&<p role="alert">{controlledSearch.error}</p>}{!results.length&&!controlledSearch.loading&&<p>{t('noResults')}</p>}{controlledSearch.truncated&&isPublicPathVisible(site,locale,'resources')&&<Link href={href('resources')} onClick={()=>setSearch(false)}>{t('resources')}<ArrowUpRight size={16}/></Link>}</div></Modal>}
 </>;
}
