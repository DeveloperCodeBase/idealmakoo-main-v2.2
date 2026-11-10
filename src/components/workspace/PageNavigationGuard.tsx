'use client';
import {useEffect,useRef,useState} from 'react';
import {useRouter} from 'next/navigation';
import {L,localized,type WorkspaceLocale} from './i18n';
import {Modal} from './ui';
import {guardedPageDestination} from './page-navigation';

const copy={
 title:L('خروج از ویرایشگر صفحه','Leave the page editor','Sayfa editöründen çık','مغادرة محرر الصفحة','Покинуть редактор страницы'),
 unsaved:L(
  'تغییرات این صفحه هنوز ذخیره نشده‌اند. برای نگه‌داشتن متن، در صفحه بمانید و پیش‌نویس را ذخیره کنید. ادامهٔ خروج، تغییرات ذخیره‌نشدهٔ این ویرایشگر را کنار می‌گذارد.',
  'This page has unsaved changes. Stay here and save the draft to keep your text. Leaving discards this editor’s unsaved changes.',
  'Bu sayfada kaydedilmemiş değişiklikler var. Metni korumak için burada kalıp taslağı kaydedin. Ayrılmak bu editördeki kaydedilmemiş değişiklikleri siler.',
  'توجد تغييرات غير محفوظة في هذه الصفحة. ابقَ هنا واحفظ المسودة للاحتفاظ بالنص. المغادرة تتجاهل تغييرات هذا المحرر غير المحفوظة.',
  'На странице есть несохранённые изменения. Останьтесь и сохраните черновик, чтобы не потерять текст. Выход удалит несохранённые изменения этого редактора.'),
 pending:L(
  'ذخیره یا عملیات صفحه هنوز منتظر پاسخ سرور است. تا مشخص‌شدن نتیجه، خروج از این مسیر غیرفعال است. می‌توانید این پنجره را ببندید و منتظر نتیجه بمانید.',
  'A page operation is still waiting for the server response. Leaving through this link is paused until its result is known. You can close this dialog and wait for the result.',
  'Sayfa işlemi hâlâ sunucu yanıtını bekliyor. Sonuç belli olana kadar bu bağlantıdan ayrılma durdurulur. Pencereyi kapatıp sonucu bekleyebilirsiniz.',
  'ما زالت عملية الصفحة تنتظر استجابة الخادم. تتوقف المغادرة عبر هذا الرابط حتى تُعرف النتيجة. يمكنك إغلاق هذه النافذة وانتظار النتيجة.',
  'Операция страницы ещё ожидает ответа сервера. Переход по ссылке приостановлен до получения результата. Можно закрыть это окно и дождаться ответа.'),
 saved:L('پاسخ سرور دریافت شد و تغییر ذخیره‌نشده‌ای باقی نمانده است. می‌توانید ادامه دهید.','The server responded and no unsaved changes remain. You can continue.','Sunucu yanıtladı ve kaydedilmemiş değişiklik kalmadı. Devam edebilirsiniz.','استجاب الخادم ولم تعد هناك تغييرات غير محفوظة. يمكنك المتابعة.','Ответ сервера получен, несохранённых изменений нет. Можно продолжить.'),
 stay:L('ماندن در صفحه','Stay on page','Sayfada kal','البقاء في الصفحة','Остаться на странице'),
 discard:L('کنارگذاشتن تغییرات و خروج','Discard changes and leave','Değişiklikleri sil ve ayrıl','تجاهل التغييرات والمغادرة','Отменить изменения и выйти'),
 continue:L('ادامه به صفحهٔ انتخاب‌شده','Continue to selected page','Seçilen sayfaya devam et','المتابعة إلى الصفحة المختارة','Перейти на выбранную страницу'),
};

export default function PageNavigationGuard({dirty,busy,isPending,locale}:{dirty:boolean;busy:boolean;isPending:()=>boolean;locale:WorkspaceLocale}){
 const router=useRouter(),[destination,setDestination]=useState<string|null>(null);
 const state=useRef({dirty,busy,isPending});state.current={dirty,busy,isPending};
 useEffect(()=>{
  const intercept=(event:MouseEvent)=>{
   const current=state.current;if(!current.dirty&&!current.busy&&!current.isPending())return;
   const target=event.target instanceof Element?event.target:event.target instanceof Node?event.target.parentElement:null;
   const anchor=target?.closest<HTMLAnchorElement>('a[href]');if(!anchor)return;
   const destination=guardedPageDestination({href:anchor.href,currentHref:window.location.href,target:anchor.getAttribute('target'),download:anchor.hasAttribute('download'),defaultPrevented:event.defaultPrevented,button:event.button,altKey:event.altKey,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey});
   if(destination===null)return;
   event.preventDefault();event.stopPropagation();setDestination(destination);
  };
  document.addEventListener('click',intercept,true);
  return()=>document.removeEventListener('click',intercept,true);
 },[]);
 if(destination===null)return null;
 const pending=busy||isPending(),text=(key:keyof typeof copy)=>localized(copy[key],locale);
 const leave=()=>{if(state.current.busy||state.current.isPending())return;setDestination(null);router.push(destination);};
 return <Modal title={text('title')} onClose={()=>setDestination(null)}><div className="ws-edit-form" data-page-navigation-guard><p role={pending?'status':undefined}>{text(pending?'pending':dirty?'unsaved':'saved')}</p><div className="ws-row-actions"><button type="button" className="btn btn-primary" onClick={()=>setDestination(null)}>{text('stay')}</button><button type="button" className="btn" disabled={pending} onClick={leave}>{text(dirty?'discard':'continue')}</button></div></div></Modal>;
}
