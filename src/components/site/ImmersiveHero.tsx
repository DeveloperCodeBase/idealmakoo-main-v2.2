'use client';

import Link from 'next/link';
import {useRef,useState} from 'react';
import {ArrowDown, ArrowUpRight, Download, ImageIcon, Keyboard, MousePointer2} from 'lucide-react';
import ToothExperience, {ToothExperienceFallback,type ExperienceState,type ExperienceTheme} from '@/components/experience/ToothExperience';
import type {ContentLocale, Localized} from '@/data/catalog';
import HeroHeadline from './HeroHeadline';

const L = (fa:string,en:string,tr:string,ar:string,ru:string):Localized => ({fa,en,tr,ar,ru});
const copy = {
  explore: L('لمس کنید. بچرخانید. کشف کنید.','Touch. Turn. Discover.','Dokunun. Döndürün. Keşfedin.','المس. دوّر. اكتشف.','Прикоснитесь. Поверните. Откройте.'),
  hint: L('دندان را بگیرید و رها کنید؛ دستیار هوشمند آرام به جایش برمی‌گرداند.','Drag a tooth and let go. The AI assistant gently brings it home.','Dişi sürükleyip bırakın. Akıllı yardımcı onu nazikçe yerine getirir.','اسحب السن وأفلته؛ يعيده المساعد الذكي برفق إلى مكانه.','Перетащите зуб и отпустите. ИИ-помощник плавно вернёт его на место.'),
  continuation: L('مجموعه‌های ایده‌آل ماکو','The Ideal Makoo collections','Ideal Makoo koleksiyonları','مجموعات إيديال ماكو','Коллекции Ideal Makoo'),
  industry: L('صنایع دندان‌پزشکی','DENTAL INDUSTRIES','DENTAL ÜRETİM','صناعات طب الأسنان','СТОМАТОЛОГИЧЕСКОЕ ПРОИЗВОДСТВО'),
  keyboard: L('کلیدها','Keys','Tuşlar','المفاتيح','Клавиши'),
  keyboardLabel: L('راهنمای صفحه‌کلید','Keyboard guide','Klavye rehberi','دليل لوحة المفاتيح','Управление клавиатурой'),
  keyboardGuide: L('با Tab وارد صحنه شوید. ۱ یا ۲: انتخاب دندان؛ جهت بالا: بالا بردن؛ چپ و راست: جابه‌جایی؛ Shift و جهت‌ها: چرخش دید؛ R: بازگشت آرام؛ Esc: رها کردن.','Tab into the scene. 1 or 2: select a tooth; Up: lift; Left or Right: move; Shift + arrows: orbit; R: return gently; Esc: release.','Tab ile sahneye geçin. 1 veya 2: dişi seçin; Yukarı: kaldırın; Sol veya Sağ: hareket ettirin; Shift + oklar: görünümü döndürün; R: nazikçe geri getirin; Esc: bırakın.','انتقل إلى المشهد بزر Tab. ‏1 أو 2: اختيار السن؛ أعلى: رفع؛ يسار أو يمين: تحريك؛ Shift مع الأسهم: تدوير الرؤية؛ R: عودة برفق؛ Esc: إفلات.','Перейдите к сцене клавишей Tab. 1 или 2: выбрать зуб; Вверх: поднять; Влево или Вправо: сдвинуть; Shift + стрелки: вращать вид; R: плавно вернуть; Esc: отпустить.'),
  fallbackTitle: L('نمای ثابت دندان‌ها','Static tooth preview','Sabit diş görünümü','معاينة ثابتة للأسنان','Статичный вид зубов'),
  fallbackBody: L('نمای سه‌بعدی در این مرورگر فعال نشد؛ محصولات و کاتالوگ‌ها در دسترس‌اند.','3D is unavailable in this browser. Products and catalogues are still available.','Bu tarayıcıda 3D görüntü kullanılamıyor. Ürünler ve kataloglara erişebilirsiniz.','العرض ثلاثي الأبعاد غير متاح في هذا المتصفح. المنتجات والكتالوجات متاحة.','3D недоступно в этом браузере. Продукция и каталоги по-прежнему доступны.'),
};

interface ImmersiveHeroProps {
  locale: ContentLocale;
  theme: ExperienceTheme;
  eyebrow: string;
  title: string;
  description: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
  continuationHref: string;
  image?: string;
}

/** One scene and one foreground. The measured open area frames the same
 * physical teeth without putting a second header above the ocean. */
export default function ImmersiveHero({locale,theme,eyebrow,title,description,primaryHref,primaryLabel,secondaryHref,secondaryLabel,continuationHref,image}:ImmersiveHeroProps) {
  const framingRegionRef = useRef<HTMLDivElement>(null);
  const [sceneState,setSceneState] = useState<ExperienceState>('loading');
  return (
    <div className={`home-immersive-stage ${image ? 'home-immersive-image' : ''}`} lang={locale} dir={locale==='fa'||locale==='ar'?'rtl':'ltr'} data-liquid-surface="" data-hero-composition="immersive" data-hero-scene-state={image?'image':sceneState}>
      {image ? <img className="home-hero-image" src={image} alt="" fetchPriority="high"/> :
        <ToothExperience variant="hero" composition="landing" framingRegionRef={framingRegionRef} externalFallback onSceneStateChange={setSceneState} theme={theme} locale={locale} className="home-ocean-experience" showHint={false}/>
      }
      <div className="home-hero-scrim" aria-hidden="true"/>
      <div className="home-optical-flare" aria-hidden="true"/>
      <div className="home-immersive-overlay">
        <div className="home-hero-copy">
          <p className="home-hero-eyebrow"><span className="home-pearl-light" aria-hidden="true"/>{eyebrow}</p>
          <HeroHeadline title={title} locale={locale}/>
          {description && <p className="home-hero-description">{description}</p>}
          <div className="home-hero-ctas">
            <Link href={primaryHref} className="btn btn-primary btn-large home-discover-button">{primaryLabel}<ArrowUpRight size={20} className="directional"/></Link>
            <Link href={secondaryHref} className="btn btn-large home-catalogue-button"><Download size={18}/>{secondaryLabel}</Link>
          </div>
        </div>
        <div className="home-visual-column">
          <div ref={framingRegionRef} className="home-scene-framing">
            {!image && <ToothExperienceFallback theme={theme} locale={locale} state={sceneState}/>}
          </div>
          {!image && sceneState!=='fallback' && <div className="home-interaction-cue" data-cue-state={sceneState} aria-hidden={sceneState!=='ready'} inert={sceneState!=='ready'}>
            <span className="home-cursor-pearl" aria-hidden="true"><MousePointer2 size={20} strokeWidth={1.5}/></span>
            <div><div className="home-cue-heading"><strong>{copy.explore[locale]}</strong><details className="home-keyboard-guide" onKeyDown={event=>{if(event.key==='Escape')event.currentTarget.open=false;}}><summary title={copy.keyboardLabel[locale]}><Keyboard size={14}/><span>{copy.keyboard[locale]}</span></summary><p>{copy.keyboardGuide[locale]}</p></details></div><p>{copy.hint[locale]}</p></div>
          </div>}
          {!image && sceneState==='fallback' && <div className="home-interaction-cue home-scene-fallback-cue">
            <span className="home-cursor-pearl" aria-hidden="true"><ImageIcon size={19}/></span>
            <div><strong>{copy.fallbackTitle[locale]}</strong><p>{copy.fallbackBody[locale]}</p></div>
          </div>}
        </div>
      </div>
      <div className="home-hero-baseline">
        <span className="home-baseline-brand" aria-hidden="true"><bdi>IDEAL MAKOO</bdi><i/>{copy.industry[locale]}</span>
        <Link href={continuationHref} className="home-scroll-link">{copy.continuation[locale]}<ArrowDown size={15}/></Link>
      </div>
    </div>
  );
}
