import type {Metadata} from 'next';
import {isLocale,translate,type Locale} from './i18n';

/** Only the actual first path segment selects the error page's language. */
export function notFoundLocale(pathname:string|null|undefined):Locale {
  let candidate=pathname?.split('/')[1];
  try{if(candidate)candidate=decodeURIComponent(candidate);}catch{return 'fa';}
  return candidate&&isLocale(candidate)?candidate:'fa';
}

export const notFoundDescriptions:Record<Locale,string>={
  fa:'این نشانی معتبر نیست یا صفحه دیگر در دسترس نیست. می‌توانید به صفحهٔ اصلی بازگردید.',
  en:'This address is unavailable or the page has been removed. You can return to the home page.',
  tr:'Bu adres geçerli değil veya sayfa artık kullanılamıyor. Ana sayfaya dönebilirsiniz.',
  ar:'هذا العنوان غير متاح أو تمت إزالة الصفحة. يمكنك العودة إلى الصفحة الرئيسية.',
  ru:'Этот адрес недоступен или страница была удалена. Вы можете вернуться на главную страницу.',
};

export function notFoundMetadata(locale:Locale):Metadata {
  return {
    title:{absolute:`${translate(locale,'notFound')} | ${translate(locale,'brand')}`},
    description:notFoundDescriptions[locale],
    robots:{index:false,follow:false,noarchive:true},
    referrer:'no-referrer',
  };
}
