'use client';
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import type {ContentLocale} from '@/data/catalog';
import {DISPLAY_PREFERENCES_EVENT,isReducedMotion} from '@/lib/display-preferences';

const signatures:Record<ContentLocale,string[]>={
 fa:['فرمِ طبیعی، در هر جزئیات','از تجربهٔ ساخت، تا انتخابِ متخصص','ایده‌آل ماکو؛ همراه دنیای دندان‌پزشکی'],
 en:['Natural form. Considered in every detail.','Made with experience. Chosen with care.','Ideal Makoo. Dedicated to dentistry.'],
 tr:['Doğal form. Her ayrıntıda özen.','Deneyimle üretilir. Özenle seçilir.','Ideal Makoo. Diş hekimliğine adanmış.'],
 ar:['شكل طبيعي، وعناية بكل تفصيل','خبرة في التصنيع، وعناية في الاختيار','إيديال ماكو؛ شريك عالم طب الأسنان'],
 ru:['Естественная форма. Внимание к деталям.','Опыт в производстве. Внимание к выбору.','Ideal Makoo. Для мира стоматологии.'],
};

/** Animate complete shaped lines, never individual Arabic/Persian letters. */
export default function HeroHeadline({title,locale}:{title:string;locale:ContentLocale}){
 const root=useRef<HTMLDivElement>(null);const[index,setIndex]=useState(0);const[active,setActive]=useState(false);
 useEffect(()=>{
  setIndex(0);const motion=window.matchMedia('(prefers-reduced-motion: reduce)');let visible=true;let timer:ReturnType<typeof setInterval>|undefined;
  const schedule=()=>{if(timer)clearInterval(timer);timer=undefined;const enabled=!isReducedMotion(motion.matches)&&!document.hidden&&visible;setActive(enabled);if(enabled)timer=setInterval(()=>setIndex(i=>(i+1)%signatures[locale].length),5600);};
  const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;schedule();},{threshold:.15});if(root.current)observer.observe(root.current);
  document.addEventListener('visibilitychange',schedule);motion.addEventListener('change',schedule);window.addEventListener(DISPLAY_PREFERENCES_EVENT,schedule);schedule();
  return()=>{if(timer)clearInterval(timer);observer.disconnect();document.removeEventListener('visibilitychange',schedule);motion.removeEventListener('change',schedule);window.removeEventListener(DISPLAY_PREFERENCES_EVENT,schedule);};
 },[locale]);
 const lines=title.split('\n');
 return <div ref={root} className="hero-headline" key={locale} data-motion-active={active}>
  {title.trim()&&<h1>{lines.map((line,i)=><span className="hero-line-mask" key={`${title}-${i}`}><span className={`hero-line ${i?'hero-line-accent':''}`} style={{'--line-delay':`${i*170+80}ms`} as CSSProperties}>{line}</span>{i<lines.length-1?' ':null}</span>)}</h1>}
  <div className="hero-signature-motion" aria-hidden="true"><span className="hero-signature-rule"/><span key={`${locale}-${index}`} className="hero-signature-phrase">{signatures[locale][index]}</span></div>
 </div>;
}
