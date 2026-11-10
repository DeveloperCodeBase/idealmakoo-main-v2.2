import type {ContentLocale} from '@/data/catalog';
export const uiLocales=['fa','en','tr','ar','ru'] as const;
export type UiText=readonly[string,string,string,string,string];
export function text(locale:string,value:UiText){return value[uiLocales.indexOf(locale as ContentLocale)]||value[1];}
export function contentLocale(locale:string):ContentLocale{return uiLocales.find(value=>value===locale)||'en';}
const common={
 title:['عنوان','Title','Başlık','العنوان','Название'],summary:['توضیح','Summary','Özet','الوصف','Описание'],slug:['شناسهٔ نشانی','Address slug','Adres kimliği','معرّف المسار','Адрес'],
 save:['ذخیره','Save','Kaydet','حفظ','Сохранить'],create:['ایجاد','Create','Oluştur','إنشاء','Создать'],refresh:['دریافت وضعیت تازه','Refresh status','Durumu yenile','تحديث الحالة','Обновить состояние'],
 loading:['در حال دریافت…','Loading…','Yükleniyor…','جارٍ التحميل…','Загрузка…'],empty:['موردی در دسترس نیست.','No items are available.','Kullanılabilir kayıt yok.','لا توجد عناصر متاحة.','Нет доступных записей.'],
 version:['نسخه','Version','Sürüm','الإصدار','Версия'],locale:['زبان محتوا','Content language','İçerik dili','لغة المحتوى','Язык материала'],reason:['دلیل / مرجع پرونده','Reason / case reference','Gerekçe / dosya referansı','السبب / مرجع الحالة','Причина / номер дела'],
 cancel:['انصراف','Cancel','Vazgeç','إلغاء','Отмена'],edit:['ویرایش','Edit','Düzenle','تعديل','Редактировать'],archive:['بایگانی','Archive','Arşivle','أرشفة','Архивировать'],restore:['بازگشت به پیش‌نویس','Restore draft','Taslağa dön','استعادة المسودة','Вернуть в черновики'],
 publish:['انتشار نسخهٔ بررسی‌شده','Publish reviewed version','Onaylı sürümü yayımla','نشر النسخة المراجعة','Опубликовать проверенную версию'],approve:['تأیید مستقل','Independent approval','Bağımsız onay','موافقة مستقلة','Независимое одобрение'],reject:['رد با دلیل','Reject with reason','Gerekçeyle reddet','رفض مع السبب','Отклонить с причиной'],
 download:['دریافت فایل','Download file','Dosyayı indir','تنزيل الملف','Скачать файл'],view:['مشاهده','View','Görüntüle','عرض','Просмотр'],status:['وضعیت','Status','Durum','الحالة','Состояние'],expires:['پایان اعتبار','Expires at','Bitiş zamanı','انتهاء الصلاحية','Срок действия'],
 revoke:['لغو مجوز','Revoke','İptal et','إلغاء الصلاحية','Отозвать'],history:['تاریخچهٔ نسخه‌ها','Version history','Sürüm geçmişi','سجل الإصدارات','История версий'],select:['انتخاب','Select','Seç','اختيار','Выбрать'],search:['جست‌وجو','Search','Ara','بحث','Поиск'],
 conflict:['فرم شما حفظ شده است. وضعیت سرور را دریافت و نسخهٔ ذخیره‌شده را صریحاً برای ادامه انتخاب کنید.','Your form is preserved. Refresh the server list and explicitly select the saved version before continuing.','Formunuz korundu. Sunucu listesini yenileyip devam etmek için kayıtlı sürümü açıkça seçin.','تم حفظ مدخلاتك. حدّث قائمة الخادم واختر النسخة المحفوظة صراحةً للمتابعة.','Ваши поля сохранены. Обновите список и явно выберите сохранённую версию для продолжения.'],
 unknown:['بدون شاهد کافی','Insufficient evidence','Yeterli kanıt yok','أدلة غير كافية','Недостаточно данных'],confirmed:['در سرور ثبت شد.','Saved by the server.','Sunucuya kaydedildi.','تم التسجيل في الخادم.','Сохранено на сервере.'],
 yes:['بله','Yes','Evet','نعم','Да'],no:['خیر','No','Hayır','لا','Нет'],
} satisfies Record<string,UiText>;
export function c(locale:string,key:keyof typeof common){return text(locale,common[key]);}
