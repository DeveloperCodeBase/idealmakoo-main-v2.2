import type {Locale} from './i18n';
import {notificationTemplateChannels,notificationTemplateKeys,type NotificationTemplateKey,type NotificationTemplateChannel,type NotificationTemplateDefinition,type NotificationTemplateCatalogEntry} from '../types/notification-templates';

const title=(fa:string,en:string,tr:string,ar:string,ru:string):Record<Locale,string>=>({fa,en,tr,ar,ru});
const entry=(key:NotificationTemplateKey,channels:NotificationTemplateChannel[],name:Record<Locale,string>,variables=['subject','message'],requiredBody=['message'],security=false):NotificationTemplateCatalogEntry=>({key,channels,title:name,variables,requiredBody,security,subjectForbidden:variables.filter(value=>['actionUrl','code'].includes(value))});
export const notificationTemplateCatalog:NotificationTemplateCatalogEntry[]=[
  entry('transactional_message',[...notificationTemplateChannels],title('پیام تراکنشی','Transactional message','İşlemsel mesaj','رسالة معاملاتیة','Служебное сообщение')),
  entry('request_received',['in-app'],title('دریافت درخواست','Request received','Talep alındı','استلام الطلب','Заявка получена'),['reference'],['reference']),
  entry('request_updated',['in-app'],title('به‌روزرسانی درخواست','Request updated','Talep güncellendi','تحديث الطلب','Заявка обновлена'),['reference'],['reference']),
  entry('task_reminder',['in-app'],title('یادآوری وظیفه','Task reminder','Görev hatırlatıcısı','تذكير بالمهمة','Напоминание о задаче')),
  entry('activity_reminder',['in-app'],title('یادآوری فعالیت','Activity reminder','Etkinlik hatırlatıcısı','تذكير بالنشاط','Напоминание о действии')),
  entry('certificate_expiring',['in-app'],title('نزدیک‌شدن انقضای گواهی','Certificate nearing expiry','Sertifika süresi dolmak üzere','اقتراب انتهاء الشهادة','Срок сертификата истекает')),
  entry('certificate_expired',['in-app'],title('انقضای گواهی','Certificate expired','Sertifikanın süresi doldu','انتهاء الشهادة','Срок сертификата истёк')),
  entry('password_reset',['email'],title('بازیابی گذرواژه','Password recovery','Şifre kurtarma','استعادة كلمة المرور','Восстановление пароля'),['actionUrl'],['actionUrl'],true),
  entry('email_verification',['email'],title('تأیید ایمیل','Email verification','E-posta doğrulama','تأكيد البريد الإلكتروني','Подтверждение почты'),['actionUrl'],['actionUrl'],true),
  entry('staff_invitation',['email'],title('دعوت همکار','Staff invitation','Personel daveti','دعوة موظف','Приглашение сотрудника'),['actionUrl','code','expiresAt'],['actionUrl','code','expiresAt'],true),
  entry('organization_invitation',['email'],title('دعوت به سازمان','Organization invitation','Kuruluş daveti','دعوة إلى المؤسسة','Приглашение в организацию'),['actionUrl','organization','inviter'],['actionUrl','organization'],true),
  entry('contact_verification',['email'],title('تأیید راه تماس','Contact verification','İletişim doğrulama','تأكيد جهة الاتصال','Подтверждение контакта'),['actionUrl'],['actionUrl'],true),
  entry('contact_preferences',['email'],title('مدیریت ترجیحات مخاطب','Contact preferences','İletişim tercihleri','تفضيلات جهة الاتصال','Настройки контакта'),['actionUrl'],['actionUrl'],true),
  entry('survey_invitation',['email','in-app'],title('دعوت به بازخورد','Feedback invitation','Geri bildirim daveti','دعوة لتقديم ملاحظات','Приглашение оставить отзыв'),['subject','message','actionUrl'],['message','actionUrl']),
];
export function templateCatalogEntry(key:unknown):NotificationTemplateCatalogEntry|undefined{return notificationTemplateCatalog.find(item=>item.key===key);}
export function templateLimits(channel:NotificationTemplateChannel){return channel==='sms'?{subject:120,body:400}:channel==='telegram'?{subject:200,body:2200}:channel==='push'?{subject:100,body:300}:{subject:200,body:10000};}
const requestCopy={fa:{received:'درخواست شما دریافت شد',updated:'درخواست شما به‌روزرسانی شد',body:'شمارهٔ پیگیری: {{reference}}'},en:{received:'Your request was received',updated:'Your request was updated',body:'Request reference: {{reference}}'},tr:{received:'Talebiniz alındı',updated:'Talebiniz güncellendi',body:'Talep numarası: {{reference}}'},ar:{received:'تم استلام طلبك',updated:'تم تحديث طلبك',body:'رقم الطلب: {{reference}}'},ru:{received:'Ваша заявка получена',updated:'Ваша заявка обновлена',body:'Номер заявки: {{reference}}'}};
const linkCopy:Record<Locale,string>={fa:'برای ادامه از پیوند امن زیر استفاده کنید:',en:'Use the secure link below to continue:',tr:'Devam etmek için aşağıdaki güvenli bağlantıyı kullanın:',ar:'استخدم الرابط الآمن أدناه للمتابعة:',ru:'Для продолжения используйте защищённую ссылку ниже:'};
const invitationCopy:Record<Locale,string>={fa:'دعوت را در حسابی با همین ایمیل تأییدشده بپذیرید. پس از پذیرش دوباره وارد شوید و احراز هویت دومرحله‌ای را تکمیل کنید.\n{{actionUrl}}\nکد دعوت: {{code}}\nانقضا: {{expiresAt}}',en:'Accept in the account with this verified email. Sign in again after accepting and complete multifactor authentication.\n{{actionUrl}}\nInvitation code: {{code}}\nExpires: {{expiresAt}}',tr:'Bu doğrulanmış e-postaya sahip hesapta kabul edin. Kabul ettikten sonra yeniden giriş yapın ve çok faktörlü doğrulamayı tamamlayın.\n{{actionUrl}}\nDavet kodu: {{code}}\nSon geçerlilik: {{expiresAt}}',ar:'اقبل الدعوة في الحساب الذي يحمل هذا البريد المؤكد. سجّل الدخول مجددًا بعد القبول وأكمل المصادقة متعددة العوامل.\n{{actionUrl}}\nرمز الدعوة: {{code}}\nانتهاء الصلاحية: {{expiresAt}}',ru:'Примите приглашение в аккаунте с этим подтверждённым адресом. Затем войдите снова и выполните многофакторную аутентификацию.\n{{actionUrl}}\nКод приглашения: {{code}}\nСрок действия: {{expiresAt}}'};
export function builtinTemplate(key:NotificationTemplateKey,channel:NotificationTemplateChannel,locale:Locale):NotificationTemplateDefinition{
  const item=templateCatalogEntry(key);if(!item||!item.channels.includes(channel)||!requestCopy[locale])throw new Error('TEMPLATE_CATALOG');
  if(key==='request_received'||key==='request_updated')return{subject:requestCopy[locale][key==='request_received'?'received':'updated'],body:requestCopy[locale].body};
  if(key==='staff_invitation')return{subject:'Ideal Makoo — '+item.title[locale],body:invitationCopy[locale]};
  if(key==='organization_invitation')return{subject:'Ideal Makoo — '+item.title[locale],body:'{{organization}}\n{{inviter}}\n'+linkCopy[locale]+'\n{{actionUrl}}'};
  if(item.security)return{subject:'Ideal Makoo — '+item.title[locale],body:linkCopy[locale]+'\n{{actionUrl}}'};
  if(key==='survey_invitation')return{subject:'{{subject}}',body:'{{message}}\n{{actionUrl}}'};
  return{subject:'{{subject}}',body:'{{message}}'};
}
export function templateSampleValues(key:NotificationTemplateKey):Record<string,string>{const values:Record<string,string>={subject:'Ideal Makoo — SAMPLE',message:'SAMPLE / نمونه — No real recipient data.',reference:'SAMPLE-000001',actionUrl:'https://example.invalid/sample',code:'SAMPLE-CODE-NOT-VALID',expiresAt:'2030-01-01T12:00:00.000Z',organization:'SAMPLE organization',inviter:'SAMPLE operator'};return Object.fromEntries((templateCatalogEntry(key)?.variables||[]).map(name=>[name,values[name]]));}
const placeholder=/\{\{([a-z][a-zA-Z0-9_]*)\}\}/g;
export function validateTemplateDefinition(value:unknown,key:NotificationTemplateKey,channel:NotificationTemplateChannel):string[]{
  const catalog=templateCatalogEntry(key);if(!catalog||!catalog.channels.includes(channel))return['TEMPLATE_CATALOG'];
  if(!value||typeof value!=='object'||Array.isArray(value))return['TEMPLATE_DEFINITION'];const v=value as Record<string,unknown>;
  if(Object.keys(v).sort().join(',')!=='body,subject'||typeof v.subject!=='string'||typeof v.body!=='string')return['TEMPLATE_DEFINITION'];
  const errors:string[]=[],limits=templateLimits(channel);
  for(const field of ['subject','body'] as const){const text=v[field] as string;if(!text.trim()||[...text].length>limits[field])errors.push('TEMPLATE_LENGTH');if((field==='subject'?/[\x00-\x1f\x7f]/:/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/).test(text))errors.push('TEMPLATE_CONTROL');if(/[<>]/.test(text)||/(?:https?:|www\.|javascript:|data:|mailto:)/i.test(text))errors.push('TEMPLATE_LITERAL_LINK');
    const names=[...text.matchAll(placeholder)].map(match=>match[1]);if(names.some(name=>!catalog.variables.includes(name))||/[{}]/.test(text.replace(placeholder,'')))errors.push('TEMPLATE_PLACEHOLDER');if(field==='subject'&&names.some(name=>catalog.subjectForbidden.includes(name)))errors.push('TEMPLATE_SECRET_SUBJECT');if(field==='body'&&catalog.requiredBody.some(name=>names.filter(value=>value===name).length!==1))errors.push('TEMPLATE_REQUIRED_BINDING');
  }return[...new Set(errors)];
}
export function renderNotificationTemplate(definition:NotificationTemplateDefinition,key:NotificationTemplateKey,channel:NotificationTemplateChannel,values:Record<string,string>):{value:NotificationTemplateDefinition|null;errors:string[]}{
  const errors=validateTemplateDefinition(definition,key,channel),catalog=templateCatalogEntry(key);if(errors.length||!catalog)return{value:null,errors};
  if(catalog.variables.some(name=>typeof values[name]!=='string')||Object.keys(values).some(name=>!catalog.variables.includes(name)))return{value:null,errors:['TEMPLATE_VALUES']};
  const value={subject:definition.subject.replace(placeholder,(_,name:string)=>values[name]),body:definition.body.replace(placeholder,(_,name:string)=>values[name])},limits=templateLimits(channel);
  if(!value.subject.trim()||!value.body.trim()||[...value.subject].length>limits.subject||[...value.body].length>limits.body||/[\x00-\x1f\x7f]/.test(value.subject)||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.body))return{value:null,errors:['TEMPLATE_RENDER_LENGTH']};return{value,errors:[]};
}
export {notificationTemplateKeys,notificationTemplateChannels};
