'use client';
import PublicImage from '@/components/ui/PublicImage';

import {Children,isValidElement,useCallback,useEffect,useId,useMemo,useRef,useState,type CSSProperties,type ReactNode,type PointerEvent,type KeyboardEvent} from 'react';
import {createPortal} from 'react-dom';
import {useDialogPortalTarget,useViewportDialog} from '@/components/ui/dialog-runtime';
import {ArrowUpRight,ChevronLeft,ChevronRight,Play,Pause,Shuffle,Maximize2,Minimize2,X,ExternalLink,FileImage,MoveHorizontal} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {boundedIndex,cardPose,carouselSize,carouselUrl,clamp,wheelNavigationIntent,CAROUSEL_MOTION} from '@/lib/carousel';
import {bindCarouselGesture,type CarouselGestureBinding} from '@/lib/carousel-gesture';
import type {Localized,Product} from '@/data/catalog';
import {localizedPath,productPath} from '@/lib/custom-products';
import {DISPLAY_PREFERENCES_EVENT,isReducedMotion} from '@/lib/display-preferences';
import './carousel.css';

export interface CarouselItem {id:string;title:string;subtitle?:string;image?:string;href?:string;description?:string;sourceUrl?:string;actionLabel?:string;glow?:string;wash?:string;}
interface CarouselProps {children?:ReactNode;items?:CarouselItem[];label:string;initialIndex?:number;className?:string;prioritizeInitialImage?:boolean;}
type Phase='idle'|'gathering'|'expanding'|'open'|'contracting'|'spreading';
const L=(fa:string,en:string,tr:string,ar:string,ru:string):Localized=>({fa,en,tr,ar,ru});
const copy={carousel:L('کروسل شیشه‌ای','Glass carousel','Cam karusel','معرض زجاجي','Стеклянная карусель'),slide:L('اسلاید','Slide','Slayt','شريحة','Слайд'),help:L('کارت کناری را به مرکز بیاورید؛ کارت مرکزی را برای جزئیات باز کنید. بکشید یا افقی اسکرول کنید؛ اسکرول با Shift و کلیدهای جهت، ابتدا و انتها نیز کار می‌کنند.','Select a side card to bring it forward; open the centre card for details. Drag, scroll horizontally or use Shift + wheel; arrow, Home and End keys also work.','Yan kartı öne getirin; ayrıntılar için orta kartı açın. Sürükleyin, yatay kaydırın veya Shift + tekerlek, ok, Home ve End tuşlarını kullanın.','اختر بطاقة جانبية لتقديمها، وافتح الوسطى للتفاصيل. اسحب أو مرّر أفقيًا، أو استخدم Shift مع التمرير والأسهم وHome وEnd.','Выберите боковую карточку, чтобы вывести её вперёд; откройте центральную для подробностей. Перетаскивайте, прокручивайте по горизонтали или с Shift; доступны стрелки, Home и End.'),select:L('انتخاب','Select','Seç','اختر','Выбрать'),open:L('مشاهده جزئیات','View details','Ayrıntıları gör','عرض التفاصيل','Подробности'),previous:L('کارت قبلی','Previous card','Önceki kart','البطاقة السابقة','Предыдущая карточка'),next:L('کارت بعدی','Next card','Sonraki kart','البطاقة التالية','Следующая карточка'),play:L('شروع گردش خودکار','Start slideshow','Slayt gösterisini başlat','بدء العرض التلقائي','Запустить показ'),pause:L('توقف گردش خودکار','Pause slideshow','Slayt gösterisini duraklat','إيقاف العرض التلقائي','Приостановить показ'),shuffle:L('کشف یک مورد دیگر','Discover another item','Başka bir öğe keşfet','اكتشف عنصرًا آخر','Открыть другой материал'),fullscreen:L('نمای تمام‌صفحه','Full screen','Tam ekran','ملء الشاشة','На весь экран'),exitFullscreen:L('خروج از تمام‌صفحه','Exit full screen','Tam ekrandan çık','الخروج من ملء الشاشة','Выйти из полного экрана'),controls:L('کنترل‌های کروسل','Carousel controls','Karusel kontrolleri','عناصر التحكم بالمعرض','Управление каруселью'),drag:L('بکشید · اسکرول افقی یا Shift + اسکرول','Drag · horizontal scroll or Shift + wheel','Sürükle · yatay kaydır veya Shift + tekerlek','اسحب · مرّر أفقيًا أو مع Shift','Перетащите · горизонтальная прокрутка или Shift'),source:L('منبع اصلی','Original source','Orijinal kaynak','المصدر الأصلي','Исходный источник'),close:L('بستن','Close','Kapat','إغلاق','Закрыть')};
function nodeText(node:ReactNode):string{if(typeof node==='string'||typeof node==='number')return String(node);if(Array.isArray(node))return node.map(nodeText).join(' ');return isValidElement<{children?:ReactNode}>(node)?nodeText(node.props.children):'';}
/** Explicit item metadata is preferred; existing children retain a safe React-only adapter. */
function inferItem(node:ReactNode,index:number,label:string,locale:keyof Localized):CarouselItem{
 let title='',image='',href='',subtitle='';
 if(isValidElement<{product?:Product}>(node)&&node.props.product){const p=node.props.product;return {id:p.id,title:p.name[locale],subtitle:p.brand,image:p.image,description:p.description[locale],href:localizedPath(locale,productPath(p)),sourceUrl:p.sourceUrl};}
 function visit(child:ReactNode){if(!isValidElement<Record<string,unknown>>(child))return;const props=child.props;if(!image&&child.type==='img'&&typeof props.src==='string')image=props.src;if(!href&&typeof props.href==='string')href=props.href;if(!title&&['h1','h2','h3','h4'].includes(String(child.type)))title=nodeText(props.children as ReactNode);Children.forEach(props.children as ReactNode,visit);}
 visit(node);return {id:String(index),title:title||`${label} ${index+1}`,image,href,subtitle};
}
function Poster({item,duplicate=false,priority=false}:{item:CarouselItem;duplicate?:boolean;priority?:boolean}){const [failed,setFailed]=useState(false);const src=carouselUrl(item.image,true);return src&&!failed?<PublicImage src={src} alt="" sizes="(max-width: 700px) 58vw, (max-width: 1100px) 36vw, 360px" loading={priority?'eager':'lazy'} fetchPriority={priority?'high':undefined} draggable={false} onError={()=>setFailed(true)} aria-hidden={duplicate||undefined}/>:<span className="gc-poster-fallback"><FileImage size={38}/><span>IDEAL MAKOO</span></span>;}

/** The original fan and staged gather/spread remain; details live in the viewport top layer. */
export default function Carousel({children,items:provided,label,initialIndex,className='',prioritizeInitialImage=false}:CarouselProps){
 const {locale,dir}=useApp();
 const id=useId(),portalTarget=useDialogPortalTarget();
 const detailChildren=Children.toArray(children);
 const items=useMemo(()=>provided!==undefined?provided:detailChildren.map((child,index)=>inferItem(child,index,label,locale)),[provided,children,label,locale]);
 const count=items.length,hasItems=count>0;
 const [selected,setSelected]=useState(()=>boundedIndex(initialIndex??Math.min(2,Math.floor(count/2)),count));
 const index=boundedIndex(selected,count),current=items[index];
 const initialImageId=items[boundedIndex(initialIndex??Math.min(2,Math.floor(count/2)),count)]?.id;
 const root=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null),deck=useRef<HTMLDivElement>(null);
 const dialog=useRef<HTMLDialogElement>(null),fullscreenDialog=useRef<HTMLDialogElement>(null);
 const cardButtons=useRef<(HTMLButtonElement|null)[]>([]),closeButton=useRef<HTMLButtonElement>(null),fullscreenButton=useRef<HTMLButtonElement>(null),fullscreenExitButton=useRef<HTMLButtonElement>(null);
 const [phase,setPhase]=useState<Phase>('idle'),[expanded,setExpanded]=useState(false);
 const [playing,setPlaying]=useState(false),[hovered,setHovered]=useState(false),[visible,setVisible]=useState(false),[reduced,setReduced]=useState(false);
 const [fullscreen,setFullscreen]=useState(false),[fallbackFullscreen,setFallbackFullscreen]=useState(false);
 const [dragOffset,setDragOffset]=useState(0),[dragging,setDragging]=useState(false),[size,setSize]=useState(()=>carouselSize(960,620,800));
 const [snapshot,setSnapshot]=useState<{item:CarouselItem;child:ReactNode}|null>(null);
 const stateRef=useRef({index,count,phase,reduced,dir,scale:size.scale*size.spread});stateRef.current={index,count,phase,reduced,dir,scale:size.scale*size.spread};
 const gesture=useRef<CarouselGestureBinding|null>(null),returnFocus=useRef<HTMLElement|null>(null),backdropDown=useRef(false);
 const wheel=useRef({sum:0,last:0,lock:0}),focusFrame=useRef<number|null>(null);
 const fullscreenReturn=useRef(false),placeholderHeight=useRef(620);
 const c=(key:keyof typeof copy)=>copy[key][locale];
 const changePhase=useCallback((value:Phase)=>{stateRef.current.phase=value;setPhase(value);},[]);
 const goTo=useCallback((value:number,focus=false)=>{
  const state=stateRef.current;
  if(state.phase!=='idle'||!Number.isFinite(value)||!state.count)return;
  gesture.current?.cancel();
  const next=boundedIndex(value,state.count);stateRef.current.index=next;setSelected(next);setDragOffset(0);
  if(focus){if(focusFrame.current!==null)cancelAnimationFrame(focusFrame.current);focusFrame.current=requestAnimationFrame(()=>{focusFrame.current=null;cardButtons.current[next]?.focus({preventScroll:true});});}
 },[]);
 const close=useCallback(()=>{
  const activePhase=stateRef.current.phase;
  if(['idle','contracting','spreading'].includes(activePhase))return;
  setExpanded(false);changePhase(activePhase==='gathering'?'spreading':'contracting');
 },[changePhase]);
 const leaveExpandedView=useCallback(()=>{fullscreenReturn.current=true;setFallbackFullscreen(false);},[]);
 const panelActive=hasItems&&['expanding','open','contracting'].includes(phase);
 useViewportDialog(dialog,panelActive,portalTarget,close,{initialFocus:closeButton,restoreFocus:false,width:780,height:760});
 useViewportDialog(fullscreenDialog,fallbackFullscreen&&hasItems,portalTarget,leaveExpandedView,{initialFocus:fullscreenExitButton,restoreFocus:false});
 const open=()=>{
  if(stateRef.current.phase!=='idle'||!current)return;
  returnFocus.current=document.activeElement as HTMLElement;
  setSnapshot({item:current,child:detailChildren[index]});setPlaying(false);
  root.current?.focus({preventScroll:true});gesture.current?.cancel();setDragOffset(0);setDragging(false);
  if(deck.current)deck.current.style.transform='none';
  setExpanded(false);changePhase('gathering');
 };
 useEffect(()=>{
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const update=()=>{const value=isReducedMotion(media.matches);setReduced(value);if(value)setPlaying(false);};
  update();media.addEventListener('change',update);window.addEventListener(DISPLAY_PREFERENCES_EVENT,update);return()=>{media.removeEventListener('change',update);window.removeEventListener(DISPLAY_PREFERENCES_EVENT,update);};
 },[]);
 useEffect(()=>{
  const host=root.current;if(!host)return;
  let frame=0;
  const measure=()=>{frame=0;if(host.clientWidth>0)setSize(carouselSize(host.clientWidth,host.clientHeight,window.visualViewport?.height||window.innerHeight));};
  const update=()=>{if(!frame)frame=requestAnimationFrame(measure);};
  const fullscreenChange=()=>{setFullscreen(document.fullscreenElement===root.current);update();};
  measure();const observer=new ResizeObserver(update);observer.observe(host);
  document.addEventListener('fullscreenchange',fullscreenChange);window.addEventListener('resize',update);window.visualViewport?.addEventListener('resize',update);
  // The portal target can change during fullscreenchange and rebind this
  // effect before its previous listener runs. Reconcile the current state too.
  setFullscreen(document.fullscreenElement===host);
  if(fullscreenReturn.current&&!fallbackFullscreen){fullscreenReturn.current=false;fullscreenButton.current?.focus({preventScroll:true});}
  return()=>{observer.disconnect();if(frame)cancelAnimationFrame(frame);document.removeEventListener('fullscreenchange',fullscreenChange);window.removeEventListener('resize',update);window.visualViewport?.removeEventListener('resize',update);};
 },[hasItems,fallbackFullscreen,portalTarget]);
 useEffect(()=>{
  const host=root.current;if(!host)return;
  let inView=false;const update=()=>setVisible(inView&&!document.hidden);
  const observer=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;update();},{threshold:.15});
  observer.observe(host);document.addEventListener('visibilitychange',update);
  return()=>{observer.disconnect();document.removeEventListener('visibilitychange',update);};
 },[hasItems,fallbackFullscreen,portalTarget]);
 useEffect(()=>{
  if(!playing||phase!=='idle'||hovered||!visible||reduced||count<2)return;
  const timer=setTimeout(()=>goTo((stateRef.current.index+1)%count),CAROUSEL_MOTION.autoplay);
  return()=>clearTimeout(timer);
 },[playing,phase,hovered,visible,reduced,count,index,goTo]);
 useEffect(()=>{if(selected>=count)setSelected(boundedIndex(selected,count));if(!count){changePhase('idle');setSnapshot(null);setPlaying(false);setFallbackFullscreen(false);}},[count,selected,changePhase]);
 useEffect(()=>{
  let timer:ReturnType<typeof setTimeout>|undefined,frame:number|undefined;
  const delay=(ms:number)=>reduced?1:ms;
  if(phase==='gathering')timer=setTimeout(()=>changePhase('expanding'),delay(CAROUSEL_MOTION.gather));
  if(phase==='expanding'){
   frame=requestAnimationFrame(()=>setExpanded(true));
   timer=setTimeout(()=>changePhase('open'),delay(CAROUSEL_MOTION.expand));
  }
  if(phase==='contracting')timer=setTimeout(()=>changePhase('spreading'),delay(CAROUSEL_MOTION.contract));
  if(phase==='spreading')timer=setTimeout(()=>{
   changePhase('idle');setSnapshot(null);
   const target=returnFocus.current?.isConnected?returnFocus.current:cardButtons.current[stateRef.current.index];
   target?.focus({preventScroll:true});
  },delay(CAROUSEL_MOTION.spread));
  return()=>{if(timer)clearTimeout(timer);if(frame)cancelAnimationFrame(frame);};
 },[phase,reduced,changePhase]);
 useEffect(()=>()=>{if(focusFrame.current!==null)cancelAnimationFrame(focusFrame.current);},[]);
 useEffect(()=>{
  const el=stage.current;if(!el)return;
  const binding=bindCarouselGesture(el,{
   getConfig:()=>{const state=stateRef.current;return {...state,enabled:state.phase==='idle',rtl:state.dir==='rtl'};},
   onStart:()=>setPlaying(false),
   onDrag:offset=>{setDragging(true);setDragOffset(offset);if(deck.current)deck.current.style.transform='none';},
   onReset:()=>{setDragging(false);setDragOffset(0);},
   onSelect:goTo,
  });
  gesture.current=binding;
  return()=>{binding.destroy();if(gesture.current===binding)gesture.current=null;};
 },[goTo,hasItems,fallbackFullscreen,portalTarget,dir]);
 useEffect(()=>{
  const el=stage.current;if(!el)return;
  const onWheel=(event:WheelEvent)=>{
   const state=stateRef.current;if(state.phase!=='idle'||state.count<2)return;
   const at=performance.now(),intent=wheelNavigationIntent(event.deltaX,event.deltaY,event.shiftKey,dir==='rtl');if(intent===null)return;
   const delta=intent*(event.deltaMode===1?18:event.deltaMode===2?120:1);
   if(boundedIndex(state.index+Math.sign(delta),state.count)===state.index)return;
   event.preventDefault();if(at<wheel.current.lock)return;
   if(at-wheel.current.last>180)wheel.current.sum=0;wheel.current.last=at;wheel.current.sum+=delta;
   if(Math.abs(wheel.current.sum)>=48){setPlaying(false);goTo(state.index+Math.sign(wheel.current.sum));wheel.current.sum=0;wheel.current.lock=at+380;}
  };
  el.addEventListener('wheel',onWheel,{passive:false});return()=>el.removeEventListener('wheel',onWheel);
 },[dir,goTo,hasItems,fallbackFullscreen,portalTarget]);
 const hoverDeck=(event:PointerEvent<HTMLDivElement>)=>{
  if(!gesture.current?.isTracking()&&event.pointerType==='mouse'&&!reduced&&phase==='idle'&&deck.current){
   const rect=event.currentTarget.getBoundingClientRect();
   const x=(event.clientX-rect.left)/rect.width-.5,y=(event.clientY-rect.top)/rect.height-.5;
   deck.current.style.transform=`rotateX(${-y*2.5}deg) rotateY(${x*3}deg)`;
  }
 };
 const keyboard=(event:KeyboardEvent<HTMLDivElement>)=>{
  if(event.defaultPrevented)return;
  if(event.key==='Escape'&&phase!=='idle'){event.preventDefault();close();return;}
  if(phase!=='idle'||event.altKey||event.ctrlKey||event.metaKey||/^(INPUT|TEXTAREA|SELECT)$/.test((event.target as HTMLElement).tagName))return;
  let next:number|undefined;
  if(event.key==='ArrowRight')next=index+(dir==='rtl'?-1:1);
  else if(event.key==='ArrowLeft')next=index+(dir==='rtl'?1:-1);
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=count-1;
  if(next!==undefined){event.preventDefault();setPlaying(false);goTo(next,true);}
 };
 const toggleFullscreen=async()=>{
  const host=root.current;if(!host||stateRef.current.phase!=='idle')return;
  setPlaying(false);
  if(fallbackFullscreen){leaveExpandedView();return;}
  try{
   if(document.fullscreenElement===host)await document.exitFullscreen();
   else if(host.requestFullscreen)await host.requestFullscreen();
   else {placeholderHeight.current=host.clientHeight;setFallbackFullscreen(true);}
  }catch{placeholderHeight.current=host.clientHeight;setFallbackFullscreen(true);}
 };
 if(!count||!current)return null;
 const gathered=!['idle','spreading'].includes(phase),morphing=['expanding','open','contracting'].includes(phase);
 const draggedIndex=index-dragOffset/(146*size.scale*size.spread)*(dir==='rtl'?-1:1);
 const boundedDrag=clamp(draggedIndex,Math.max(0,index-3),Math.min(count-1,index+3)),excess=draggedIndex-boundedDrag;
 const visualIndex=dragging&&!gathered?boundedDrag+excess/(1+Math.abs(excess)*4):index;
 const style={
  '--gc-scale':size.scale,'--gc-card-w':`${size.cardWidth}px`,'--gc-card-h':`${size.cardHeight}px`,
  '--gc-poster-gap':`${size.cardPadding}px`,'--gc-poster-h':`${size.posterHeight}px`,'--gc-center-y':`${size.centerY}px`,
  '--gc-dock-w':`${size.dockWidth}px`,'--gc-dock-h':`${size.dockHeight}px`,'--gc-dock-bottom':`${size.dockBottom}px`,
  '--gc-scene-h':`${Math.max(420,size.stageBottom+size.dockBottom+size.dockHeight+22)}px`,
 } as CSSProperties;
 const poster=(item:CarouselItem)=><><span className="gc-poster"><Poster key={item.image} item={item} priority={prioritizeInitialImage&&item.id===initialImageId}/><span className="gc-hover-play"><ArrowUpRight/></span><span className="gc-watch"><ArrowUpRight/><span>{item.actionLabel||c('open')}</span></span></span><span className="gc-card-copy"><span className="gc-title" dir="auto">{item.title}</span><span className="gc-meta" dir="auto">{item.subtitle||label}</span></span></>;
 const experience=<div ref={root} className={`gc gc-factory ${reduced?'gc-reduced':''} ${gathered?'is-gathered':''} ${morphing?'is-morphing':''} ${dragging?'is-dragging':''} ${playing&&!hovered&&visible?'is-playing':''} ${fallbackFullscreen?'gc-expanded-fallback':''} ${className}`}
  style={style} dir={dir} lang={locale} data-locale={locale} data-dir={dir} data-compact={size.compact} data-expanded-view={fullscreen||fallbackFullscreen} role="region" tabIndex={-1}
  aria-roledescription={c('carousel')} aria-label={label} aria-describedby={`${id}-help`} onKeyDown={keyboard}>
  {(fullscreen||fallbackFullscreen)&&<button ref={fullscreenExitButton} type="button" className="gc-immersive-close" disabled={gathered} onClick={()=>void toggleFullscreen()} aria-label={c('exitFullscreen')} title={c('exitFullscreen')}><X size={20}/></button>}
  <div className="gc-scene">
   <div className="gc-ambient" aria-hidden="true">{items.map((item,i)=><div className={`gc-glow ${i===index?'is-active':''}`} key={item.id} style={{'--glow':/^#[a-f\d]{3,8}$/i.test(item.glow||'')?item.glow:undefined,'--wash':/^#[a-f\d]{3,8}$/i.test(item.wash||'')?item.wash:undefined}as CSSProperties}/>)}<div className="gc-vignette"/><div className="gc-floor"/></div>
   <p className="gc-sr" id={`${id}-help`}>{c('help')}</p>
   <div className="gc-stage-caption"><span className="gc-status-dot"/><span className="gc-caption-text">{label}</span><bdi dir="ltr">{String(index+1).padStart(2,'0')} / {String(count).padStart(2,'0')}</bdi></div>
   <div className="gc-stage" ref={stage} inert={gathered||undefined} aria-hidden={gathered||undefined}
    onPointerMove={hoverDeck}
    onPointerEnter={event=>{if(event.pointerType==='mouse')setHovered(true);}}
    onPointerLeave={()=>{setHovered(false);if(deck.current)deck.current.style.transform='none';}}>
    <div className="gc-deck" ref={deck}>{items.map((item,i)=>{
     const distance=(i-visualIndex)*(dir==='rtl'?-1:1),pose=cardPose(distance,size.scale,gathered,size.spread);
     return <article className={`gc-card ${i===index?'is-active':''}`} key={item.id} role="group" aria-roledescription={c('slide')} aria-label={`${i+1} / ${count}`} aria-hidden={pose.opacity===0||undefined}
      style={{transform:`translate(-50%,-50%) translate3d(${pose.x}px,${pose.y}px,${pose.z}px) rotateY(${pose.rotateY}deg) scale(${pose.scale})`,opacity:pose.opacity,filter:`brightness(${pose.brightness})`,zIndex:pose.zIndex,pointerEvents:pose.opacity===0?'none':undefined}}>
      <button ref={node=>{cardButtons.current[i]=node;}} className="gc-card-button" type="button" draggable={false} tabIndex={i===index&&!gathered?0:-1} aria-current={i===index?'true':undefined}
       title={`${i===index?c('open'):c('select')}: ${item.title}`} onFocus={()=>setPlaying(false)} onClick={()=>i===index?open():goTo(i)}>{poster(item)}</button>
      <span className="gc-card-reflection" aria-hidden="true"><Poster key={item.image} item={item} duplicate/></span>
     </article>;
    })}</div>
   </div>
   <div className="gc-dock" role="group" aria-label={c('controls')} inert={gathered||undefined} aria-hidden={gathered||undefined}>
    <div className="gc-controls">
     <button className="gc-icon-button" type="button" disabled={index===0||count<2} onClick={()=>{setPlaying(false);goTo(index-1);}} aria-label={c('previous')} title={c('previous')}>{dir==='rtl'?<ChevronRight/>:<ChevronLeft/>}</button>
     <button className="gc-icon-button gc-autoplay" type="button" disabled={count<2||reduced} aria-pressed={playing} aria-label={playing?c('pause'):c('play')} title={playing?c('pause'):c('play')} onClick={()=>setPlaying(value=>!value)}>{playing?<Pause/>:<Play/>}</button>
     <button className="gc-icon-button" type="button" disabled={index===count-1||count<2} onClick={()=>{setPlaying(false);goTo(index+1);}} aria-label={c('next')} title={c('next')}>{dir==='rtl'?<ChevronLeft/>:<ChevronRight/>}</button>
    </div>
    <button className="gc-now" type="button" onClick={open} title={`${c('open')}: ${current.title}`}>
     <span className="gc-now-thumb"><Poster key={current.image} item={current}/></span>
     <span className="gc-now-copy"><span className="gc-now-title" dir="auto">{current.title}</span><span className="gc-now-genre" dir="auto">{current.subtitle||label}</span><span className="gc-progress"><span className="gc-progress-fill" style={{width:`${(index+1)/count*100}%`}}/></span></span>
     <span className="gc-equalizer" aria-hidden="true"><i/><i/><i/><i/><i/></span>
    </button>
    <div className="gc-utilities">
     <button ref={fullscreenButton} type="button" className="gc-icon-button gc-fullscreen" onClick={()=>void toggleFullscreen()} aria-label={fullscreen||fallbackFullscreen?c('exitFullscreen'):c('fullscreen')} title={fullscreen||fallbackFullscreen?c('exitFullscreen'):c('fullscreen')} aria-pressed={fullscreen||fallbackFullscreen}>{fullscreen||fallbackFullscreen?<Minimize2/>:<Maximize2/>}</button>
     <button type="button" className="gc-icon-button gc-shuffle" disabled={count<2} aria-label={c('shuffle')} title={c('shuffle')} onClick={()=>{setPlaying(false);goTo((index+1+Math.floor(Math.random()*(count-1)))%count);}}><Shuffle/></button>
    </div>
   </div>
   <span className="gc-gesture"><MoveHorizontal size={14}/><span>{c('drag')}</span></span>
   <span className="gc-sr" aria-live="polite" aria-atomic="true">{index+1} / {count} — {current.title}</span>
  </div>
  <noscript><ul>{items.filter(item=>carouselUrl(item.href)).map(item=><li key={item.id}><a href={item.href}>{item.title}</a></li>)}</ul></noscript>
 </div>;
 const item=snapshot?.item;
 const detail=item&&portalTarget?createPortal(<dialog ref={dialog} className={`gc-detail-dialog liquid-dialog ${expanded?'is-expanded':''}`} data-liquid-surface="true" data-reduced={reduced} data-viewport-dialog="true"
  aria-labelledby={`${id}-detail-title`} dir={dir} lang={locale} tabIndex={-1}
  onPointerDown={event=>{const rect=event.currentTarget.getBoundingClientRect();backdropDown.current=event.target===event.currentTarget&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom);}}
  onPointerCancel={()=>{backdropDown.current=false;}}
  onClick={event=>{const rect=event.currentTarget.getBoundingClientRect(),outside=event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom;if(backdropDown.current&&event.target===event.currentTarget&&outside)close();backdropDown.current=false;}}>
  <section className="gc-detail">
   <header className="gc-detail-header"><span className="gc-detail-label"><i className="gc-status-dot"/><span>{label}</span></span><div className="gc-detail-actions">
    {carouselUrl(item.href)&&<a className="gc-external" href={item.href} aria-label={c('open')} title={c('open')}><ExternalLink/></a>}
    <button ref={closeButton} type="button" className="gc-close" onClick={close}><X/><span>{c('close')}</span></button>
   </div></header>
   <div className="gc-detail-scroll" tabIndex={0} role="region" aria-labelledby={`${id}-detail-title`}>
    <h2 id={`${id}-detail-title`} className="gc-detail-title" dir="auto">{item.title}</h2>
    <div className="gc-detail-body">{snapshot?.child||<><div className="gc-detail-poster"><Poster key={item.image} item={item}/></div>{item.subtitle&&<span className="badge">{item.subtitle}</span>}{item.description&&<p>{item.description}</p>}{carouselUrl(item.href)&&<a href={item.href} className="btn btn-primary">{item.actionLabel||c('open')}<ArrowUpRight size={17}/></a>}</>}</div>
    {carouselUrl(item.sourceUrl)&&<footer className="gc-detail-source"><a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={15}/>{c('source')}</a></footer>}
   </div>
  </section>
 </dialog>,portalTarget):null;
 return <>
  {fallbackFullscreen&&portalTarget?<><div className="gc-fullscreen-placeholder" style={{height:placeholderHeight.current}} aria-hidden="true"/>{createPortal(<dialog ref={fullscreenDialog} className="gc-fullscreen-dialog" data-viewport-dialog="true" aria-label={label} dir={dir} lang={locale} tabIndex={-1}>{experience}</dialog>,portalTarget)}</>:experience}
  {detail}
 </>;
}
