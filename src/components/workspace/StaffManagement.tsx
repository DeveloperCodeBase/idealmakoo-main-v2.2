'use client';
import {useCallback,useEffect,useId,useRef,useState,type FormEvent} from 'react';
import {Plus,Save,ShieldCheck,UserRound,LockKeyhole,RefreshCw} from 'lucide-react';
import {apiClient,networkError} from '@/lib/api';
import {roles,type FrontSession} from '@/lib/auth';
import {localeNames,type Locale} from '@/lib/i18n';
import {useApp} from '@/components/providers/AppProvider';
import {L,localized,roleNames,workspaceLocales,wt} from './i18n';
import type {WorkspaceStore} from './store';
import {Field,Modal,SearchInput} from './ui';
import type {ManagedUser,ManagedUserDetail,ManagedUserProfile,ManagedUserMutation,ManagedUserPasswordResetInput,ManagedUserPasswordResetResult,ManagedUserMfaResetInput,ManagedUserMfaResetResult,UserDirectoryResponse} from '@/types/user-management';
import type {CrmScope,CrmPermissions} from '@/types/crm';
import {USER_PROFILE_LIMITS} from '@/lib/user-settings';
import {personalSettingsText} from '@/components/account/personal-settings-copy';
interface Draft {name:string;email:string;password:string;confirmPassword:string;role:FrontSession['role'];active:boolean;allowedLocales:Locale[];qualityScope:boolean;crmScope:CrmScope;crmPermissions:CrmPermissions;profile:ManagedUserProfile}
const profileKeys=['phone','contactEmail','organization','profession','bio','website','country','city','address'] as const;
const blankProfile=():ManagedUserProfile=>({phone:'',contactEmail:'',organization:'',profession:'',bio:'',website:'',country:'',city:'',address:''});
const noPermissions=():CrmPermissions=>({contact:false,financial:false,baseCost:false,assign:false,intake:false});
const permissionKeys=['contact','financial','baseCost','assign','intake'] as const;
const fresh=():Draft=>({name:'',email:'',password:'',confirmPassword:'',role:'customer',active:true,allowedLocales:['fa','en','tr','ar','ru'],qualityScope:false,crmScope:'assigned',crmPermissions:noPermissions(),profile:blankProfile()});
interface MfaRecoveryDraft {actorPassword:string;actorCode:string;password:string;confirmPassword:string;confirmed:boolean}
const freshMfaRecovery=():MfaRecoveryDraft=>({actorPassword:'',actorCode:'',password:'',confirmPassword:'',confirmed:false});
interface DirectoryState extends UserDirectoryResponse {key:string;loaded:boolean;pending:boolean;error:string}
const emptyDirectory=(key:string):DirectoryState=>({key,items:[],nextCursor:null,provisioningMode:'env',canCreate:false,canManageGrants:false,loaded:false,pending:false,error:''});
const directoryCopy={
 identity:L('ایمیل / تلفن ورود','Sign-in email / phone','Giriş e-postası / telefon','بريد / هاتف الدخول','Email / телефон для входа'),
 verifiedPhone:L('شمارهٔ تأییدشدهٔ ورود','Verified sign-in phone','Doğrulanmış giriş telefonu','هاتف الدخول المتحقق','Подтверждённый телефон для входа'),
 phoneHint:L('تغییر تلفن تماس در پروفایل، شمارهٔ ورود تأییدشده را تغییر نمی‌دهد.','Changing the profile contact phone does not change the verified sign-in number.','Profil iletişim telefonunu değiştirmek doğrulanmış giriş numarasını değiştirmez.','تغيير هاتف الاتصال في الملف لا يغير رقم الدخول المتحقق.','Изменение контактного телефона профиля не меняет подтверждённый номер для входа.'),
 allRoles:L('همه نقش‌ها','All roles','Tüm roller','كل الأدوار','Все роли'),
 loadMore:L('نمایش کاربران بیشتر','Load more users','Daha fazla kullanıcı yükle','تحميل المزيد من المستخدمين','Загрузить ещё пользователей'),
 loading:L('در حال بارگیری…','Loading…','Yükleniyor…','جارٍ التحميل…','Загрузка…'),
 empty:L('کاربری مطابق جستجو یافت نشد.','No users match this search.','Bu aramayla eşleşen kullanıcı yok.','لا يوجد مستخدمون يطابقون هذا البحث.','По этому запросу пользователи не найдены.'),
 hybrid:L('حساب‌های اولیه از تنظیمات محیط ساخته می‌شوند. تغییرات مجاز این پنل در پایگاه داده ذخیره می‌شوند و با راه‌اندازی دوباره از بین نمی‌روند.','Initial accounts are created from the server environment. Authorized panel changes are stored in the database and survive restarts.','İlk hesaplar sunucu ortamından oluşturulur. Yetkili panel değişiklikleri veritabanında saklanır ve yeniden başlatmada korunur.','تُنشأ الحسابات الأولية من بيئة الخادم. تُحفظ تغييرات اللوحة المصرّح بها في قاعدة البيانات وتبقى بعد إعادة التشغيل.','Начальные аккаунты создаются из окружения сервера. Разрешённые изменения панели хранятся в базе данных и сохраняются после перезапуска.'),
 newPassword:L('رمز عبور جدید','New password','Yeni parola','كلمة المرور الجديدة','Новый пароль'),
 confirmPassword:L('تکرار رمز عبور جدید','Confirm new password','Yeni parolayı doğrulayın','تأكيد كلمة المرور الجديدة','Повторите новый пароль'),
 resetPassword:L('تعیین رمز عبور جدید','Set new password','Yeni parola belirle','تعيين كلمة مرور جديدة','Установить новый пароль'),
 passwordMismatch:L('رمز عبور و تکرار آن یکسان نیستند.','The password and confirmation do not match.','Parola ve doğrulama eşleşmiyor.','كلمة المرور وتأكيدها غير متطابقين.','Пароль и подтверждение не совпадают.'),
 passwordLength:L('رمز عبور باید بین ۱۲ تا ۱۲۸ نویسه باشد.','Use a password between 12 and 128 characters.','12 ile 128 karakter arasında bir parola kullanın.','استخدم كلمة مرور بين ١٢ و١٢٨ حرفًا.','Используйте пароль длиной от 12 до 128 символов.'),
 passwordHint:L('رمز قبلی نمایش داده نمی‌شود. تعیین رمز جدید، نشست‌های فعال این کاربر را پایان می‌دهد. احراز هویت دومرحله‌ای حفظ می‌شود.','The existing password cannot be displayed. Setting a new password ends this user’s active sessions. Two-factor authentication stays enabled.','Mevcut parola gösterilemez. Yeni parola bu kullanıcının etkin oturumlarını sonlandırır. İki faktörlü doğrulama korunur.','لا يمكن عرض كلمة المرور الحالية. يؤدي تعيين كلمة مرور جديدة إلى إنهاء جلسات هذا المستخدم النشطة مع إبقاء المصادقة الثنائية.','Текущий пароль не отображается. Новый пароль завершает активные сеансы пользователя. Двухфакторная аутентификация сохраняется.'),
 passwordSaved:L('رمز عبور تغییر کرد و نشست‌های فعال کاربر پایان یافت.','Password changed and the user’s active sessions ended.','Parola değiştirildi ve kullanıcının etkin oturumları sonlandırıldı.','تم تغيير كلمة المرور وإنهاء جلسات المستخدم النشطة.','Пароль изменён, активные сеансы пользователя завершены.'),
 ownPassword:L('برای تغییر رمز عبور خود، بخش امنیت حساب را باز کنید.','To change your own password, open account security.','Kendi parolanızı değiştirmek için hesap güvenliğini açın.','لتغيير كلمة مرورك افتح أمان الحساب.','Для изменения своего пароля откройте настройки безопасности аккаунта.'),
 emailHint:L('تغییر ایمیل، نشست‌های قبلی کاربر را پایان می‌دهد.','Changing the email address ends the user’s previous sessions.','E-posta adresini değiştirmek kullanıcının önceki oturumlarını sonlandırır.','يؤدي تغيير البريد الإلكتروني إلى إنهاء جلسات المستخدم السابقة.','Изменение email завершает предыдущие сеансы пользователя.'),
 scope:L('محدوده دسترسی CRM','CRM access scope','CRM erişim kapsamı','نطاق الوصول إلى CRM','Область доступа CRM'),
 assigned:L('فقط موارد واگذارشده','Assigned records only','Yalnızca atanmış kayıtlar','السجلات المسندة فقط','Только назначенные записи'),
 team:L('موارد تیم','Team records','Ekip kayıtları','سجلات الفريق','Записи команды'),
 all:L('همه موارد','All records','Tüm kayıtlar','كل السجلات','Все записи'),
 contact:L('اطلاعات تماس','Contact information','İletişim bilgileri','معلومات الاتصال','Контактные данные'),
 financial:L('اطلاعات مالی','Financial information','Mali bilgiler','المعلومات المالية','Финансовые данные'),
 baseCost:L('بهای پایه','Base cost','Taban maliyet','التكلفة الأساسية','Себестоимость'),
 assign:L('واگذاری مسئولیت','Assign records','Kayıt atama','إسناد السجلات','Назначение записей'),
 intake:L('دریافت درخواست جدید','New request intake','Yeni talep alımı','استقبال الطلبات الجديدة','Приём новых запросов')
};
const mfaRecoveryCopy={
 title:L('بازیابی دسترسی دومرحله‌ای ازدست‌رفته','Recover lost two-factor access','Kaybedilen iki faktörlü erişimi kurtar','استعادة الوصول الثنائي المفقود','Восстановить доступ при утрате второго фактора'),
 actorPassword:L('رمز عبور فعلی شما به‌عنوان مدیر ارشد','Your current super administrator password','Süper yönetici hesabınızın mevcut parolası','كلمة مرورك الحالية بصفتك مديرًا أعلى','Ваш текущий пароль суперадминистратора'),
 actorCode:L('کد فعلی برنامهٔ احراز هویت شما','Current code from your authenticator','Kimlik doğrulama uygulamanızdaki güncel kod','الرمز الحالي من تطبيق المصادقة لديك','Текущий код из вашего приложения-аутентификатора'),
 codeHint:L('کد شش‌رقمی فعلی برنامهٔ احراز هویت خود را وارد کنید؛ کد بازیابی برای این عملیات پذیرفته نمی‌شود.','Enter your current six-digit authenticator code. A recovery code cannot be used for this action.','Kimlik doğrulama uygulamanızdaki güncel altı haneli kodu girin. Bu işlem için kurtarma kodu kullanılamaz.','أدخل الرمز الحالي المكوّن من ستة أرقام من تطبيق المصادقة. لا يُقبل رمز الاسترداد لهذه العملية.','Введите текущий шестизначный код из приложения-аутентификатора. Код восстановления для этой операции не подходит.'),
 consequences:L('این عملیات رمز کارمند انتخاب‌شده را تغییر می‌دهد، همهٔ نشست‌ها و چالش‌های ورود و کدهای بازیابی او و دعوت‌نامه‌های در انتظار کارکنان و سازمانِ مرتبط با او را لغو می‌کند و ثبت دوبارهٔ احراز هویت دومرحله‌ای را در ورود بعدی الزامی می‌سازد. نقش و دسترسی‌ها تغییر نمی‌کنند. اعلان امنیتی بدون رمز عبور، کد احراز هویت یا کد بازیابی، مطابق پیکربندی و سیاست ارسال سرور در صف ایمیل قرار می‌گیرد؛ قرارگرفتن در صف به‌معنای تحویل قطعی نیست.','This changes the selected staff account’s password, revokes all of its sessions, sign-in challenges, recovery codes and pending staff or organization invitations, and requires two-factor enrollment at the next sign-in. Its role and grants stay unchanged. A security email containing no password, authenticator code or recovery code is queued according to the server’s delivery configuration and policy. Queuing does not guarantee delivery.','Bu işlem seçili personel hesabının parolasını değiştirir; tüm oturumlarını, giriş doğrulama isteklerini, kurtarma kodlarını ve bekleyen personel veya kuruluş davetlerini iptal eder. Sonraki girişte iki faktörlü doğrulamanın yeniden kurulması gerekir. Rol ve yetkiler değişmez. Parola, kimlik doğrulama kodu veya kurtarma kodu içermeyen bir güvenlik e-postası, sunucunun gönderim yapılandırmasına ve politikasına göre kuyruğa alınır. Kuyruğa alınması teslimatı garanti etmez.','تغيّر هذه العملية كلمة مرور حساب الموظف المحدد، وتلغي جميع جلساته وتحديات تسجيل دخوله ورموز استرداده ودعوات الموظفين أو المؤسسات المعلّقة المرتبطة به، وتُلزمه بإعداد المصادقة الثنائية مجددًا عند الدخول التالي. لا يتغير دوره أو صلاحياته. يوضع إشعار أمني بالبريد، لا يحتوي على كلمة مرور أو رمز مصادقة أو رمز استرداد، في قائمة الإرسال وفق إعدادات الخادم وسياسة التسليم. لا يعني الإدراج في القائمة ضمان وصوله.','Операция меняет пароль выбранного сотрудника, отзывает все его сеансы, запросы подтверждения входа, коды восстановления и ожидающие приглашения сотрудников или организаций. При следующем входе потребуется заново настроить двухфакторную аутентификацию. Роль и права не меняются. Уведомление безопасности по email без пароля, кода аутентификатора или кода восстановления ставится в очередь согласно настройкам и политике отправки сервера. Постановка в очередь не гарантирует доставку.'),
 confirmation:L('هویت این کارمند را به‌طور مستقل بررسی کرده‌ام، رمز جدید را از کانالی امن به او تحویل می‌دهم و تغییر رمز، لغو موارد بالا و الزام ثبت دوبارهٔ احراز هویت دومرحله‌ای را تأیید می‌کنم.','I have independently verified this staff member’s identity, will provide the new password through a secure channel, and confirm the password change, the revocations above and the required two-factor enrollment.','Bu personelin kimliğini bağımsız olarak doğruladım; yeni parolayı güvenli bir kanaldan ileteceğim. Parola değişikliğini, yukarıdaki iptalleri ve iki faktörlü doğrulamanın yeniden kurulma zorunluluğunu onaylıyorum.','تحققتُ من هوية هذا الموظف بشكل مستقل، وسأسلّمه كلمة المرور الجديدة عبر قناة آمنة، وأؤكد تغيير كلمة المرور والإلغاءات المذكورة وإلزامه بإعداد المصادقة الثنائية مجددًا.','Я независимо проверил(а) личность этого сотрудника, передам новый пароль по защищённому каналу и подтверждаю смену пароля, перечисленные отзывы доступа и обязательную повторную настройку второго фактора.'),
 submit:L('بازیابی MFA و تعیین رمز جدید','Recover MFA and set new password','MFA erişimini kurtar ve yeni parola belirle','استعادة MFA وتعيين كلمة مرور جديدة','Восстановить MFA и установить новый пароль'),
 saved:L('بازیابی انجام شد. نشست‌ها، چالش‌ها، کدهای بازیابی و دعوت‌نامه‌های در انتظار این کاربر لغو شدند؛ در ورود بعدی باید MFA را دوباره ثبت کند. اعلان امنیتی بدون رمز و کد در صف ایمیل قرار گرفت؛ تحویل آن به پیکربندی و سیاست ارسال سرور وابسته است و تضمین نمی‌شود.','Recovery completed. This user’s sessions, challenges, recovery codes and pending invitations were revoked. They must enroll MFA again at the next sign-in. A secret-free security email was queued; delivery depends on server configuration and policy and is not guaranteed.','Kurtarma tamamlandı. Kullanıcının oturumları, doğrulama istekleri, kurtarma kodları ve bekleyen davetleri iptal edildi. Sonraki girişte MFA yeniden kurulmalıdır. Gizli bilgi içermeyen güvenlik e-postası kuyruğa alındı; teslimat sunucu yapılandırmasına ve politikasına bağlıdır ve garanti edilmez.','اكتملت الاستعادة. أُلغيت جلسات هذا المستخدم وتحديات دخوله ورموز استرداده ودعواته المعلّقة. يجب إعداد MFA مجددًا عند الدخول التالي. وُضع إشعار أمني خالٍ من كلمات المرور والرموز في قائمة البريد؛ يعتمد التسليم على إعدادات الخادم وسياسته ولا يُضمن.','Восстановление завершено. Сеансы пользователя, запросы подтверждения, коды восстановления и ожидающие приглашения отозваны. При следующем входе потребуется заново настроить MFA. Уведомление безопасности без паролей и кодов поставлено в очередь email; доставка зависит от настроек и политики сервера и не гарантируется.'),
 passwordRequired:L('رمز عبور فعلی خود را وارد کنید.','Enter your current password.','Mevcut parolanızı girin.','أدخل كلمة مرورك الحالية.','Введите свой текущий пароль.'),
 codeRequired:L('کد شش‌رقمی برنامهٔ احراز هویت خود را وارد کنید.','Enter your six-digit authenticator code.','Kimlik doğrulama uygulamanızdaki altı haneli kodu girin.','أدخل رمز تطبيق المصادقة المكوّن من ستة أرقام.','Введите шестизначный код из приложения-аутентификатора.'),
 confirmationRequired:L('پیش از ادامه، پیامدهای بازیابی را تأیید کنید.','Confirm the recovery consequences before continuing.','Devam etmeden önce kurtarmanın sonuçlarını onaylayın.','أكّد نتائج الاستعادة قبل المتابعة.','Перед продолжением подтвердите последствия восстановления.')
};
export default function StaffManagement({store}:{store:WorkspaceStore}){
 const app=useApp();
 return <StaffManagementBody key={JSON.stringify([app.session?.id,app.session?.role,store.role,store.locale])} store={store}/>;
}
function StaffManagementBody({store}:{store:WorkspaceStore}){
 const app=useApp();const {locale,role}=store;const senior=role==='superAdmin';
 const [query,setQuery]=useState(''),[roleFilter,setRoleFilter]=useState<FrontSession['role']|''>('');
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [open,setOpen]=useState(false);const [selected,setSelected]=useState<ManagedUserDetail|null>(null);const [draft,setDraft]=useState<Draft>(fresh);
 const [mfaRecoveryOpen,setMfaRecoveryOpen]=useState(false),[mfaRecovery,setMfaRecovery]=useState<MfaRecoveryDraft>(freshMfaRecovery);
 const mfaFormId=useId(),mfaTrigger=useRef<HTMLButtonElement|null>(null),profileForm=useRef<HTMLFormElement|null>(null),focusAfterMfa=useRef(false);
 const modalOpener=useRef<HTMLElement|null>(null);
 const clearMfaRecovery=useCallback(()=>{setMfaRecoveryOpen(false);setMfaRecovery(freshMfaRecovery());},[]);
 const identity=JSON.stringify([app.session?.id,app.session?.role,role,locale]),search=query.trim(),key=JSON.stringify([identity,search,roleFilter]);
 const identityRef=useRef(identity),keyRef=useRef(key),mounted=useRef(false);
 identityRef.current=identity;keyRef.current=key;
 const [page,setPage]=useState<DirectoryState>(()=>emptyDirectory(key)),pageRef=useRef(page);
 // The identity-keyed body owns this latch; ordinary searches never reset it.
 const [initialDirectoryReady,setInitialDirectoryReady]=useState(false);
 const requestRef=useRef<{key:string;controller:AbortController}|null>(null),mutationRef=useRef<AbortController|null>(null);
 const remember=useCallback((value:DirectoryState)=>{pageRef.current=value;setPage(value);if(value.loaded)setInitialDirectoryReady(true);},[]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;requestRef.current?.controller.abort();mutationRef.current?.abort();};},[]);
 const load=useCallback(async(append=false,force=false)=>{
  if(!mounted.current||keyRef.current!==key)return;
  if(requestRef.current?.key===key&&!force)return;
  const previous=pageRef.current,cursor=append&&previous.key===key?previous.nextCursor:null;
  if(append&&!cursor)return;
  requestRef.current?.controller.abort();
  const request={key,controller:new AbortController()};requestRef.current=request;
  const current=()=>mounted.current&&keyRef.current===key&&requestRef.current===request&&!request.controller.signal.aborted;
  remember(append?{...previous,pending:true,error:''}:{...emptyDirectory(key),pending:true});
  const params=new URLSearchParams({kind:'all',limit:'50'});
  if(search)params.set('q',search);if(roleFilter)params.set('role',roleFilter);if(cursor)params.set('cursor',cursor);
  try{
   const result=await apiClient.request<UserDirectoryResponse>('/users?'+params,{signal:request.controller.signal});
   if(!current())return;
   const items=append?[...new Map([...previous.items,...result.items].map(user=>[user.id,user])).values()]:result.items;
   remember({...result,canCreate:result.canCreate===true,canManageGrants:result.canManageGrants===true,items,key,loaded:true,pending:false,error:''});
  }catch(reason){if(current())remember({...pageRef.current,pending:false,error:networkError(reason,locale)});}
  finally{if(requestRef.current===request)requestRef.current=null;}
 },[key,search,roleFilter,locale,remember]);
 const reload=useRef(load);reload.current=load;
 useEffect(()=>{void load();return()=>{if(requestRef.current?.key===key){requestRef.current.controller.abort();requestRef.current=null;}};},[key,load]);
 const directory=page.key===key?page:emptyDirectory(key),rows=directory.items,policy=directory;
 const permitted=(user:ManagedUser)=>user.capabilities?.canEdit??(senior||!['superAdmin','admin'].includes(user.role));
 const canEdit=selected?permitted(selected):policy.canCreate;
 const canManageGrants=selected?(selected.capabilities?.canManageGrants??policy.canManageGrants):policy.canManageGrants;
 const canChangeEmail=selected?selected.capabilities?.canChangeEmail===true:true;
 const canChangeActive=selected?selected.id!==app.session?.id&&(selected.active?(selected.capabilities?.canDeactivate??canEdit):(selected.capabilities?.canReactivate??canEdit)):true;
 const canResetPassword=!!selected&&selected.id!==app.session?.id&&selected.capabilities?.canResetPassword===true;
 const canResetMfa=senior&&app.session?.role==='superAdmin'&&!!selected&&selected.active&&selected.role!=='customer'&&selected.mfaEnabled&&selected.id!==app.session?.id&&selected.capabilities?.canResetMfa===true&&(policy.provisioningMode==='hybrid'||policy.provisioningMode==='panel');
 useEffect(()=>{if(!open||!canResetMfa)clearMfaRecovery();},[open,canResetMfa,clearMfaRecovery]);
 useEffect(()=>{if(focusAfterMfa.current&&!busy&&!mfaRecoveryOpen){focusAfterMfa.current=false;profileForm.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus();}},[busy,mfaRecoveryOpen]);
 const start=async(user:ManagedUser|null,trigger:HTMLButtonElement)=>{
  if(mutationRef.current||(!user&&!policy.canCreate)||user&&!permitted(user)||!mounted.current)return;
  modalOpener.current=trigger;
  setError('');clearMfaRecovery();if(!user){setSelected(null);setDraft(fresh());setOpen(true);return;}
  const controller=new AbortController();mutationRef.current=controller;
  const current=()=>mounted.current&&identityRef.current===identity&&mutationRef.current===controller&&!controller.signal.aborted;
  setBusy(true);
  try{const detail=await apiClient.request<ManagedUserDetail>(`/users/${encodeURIComponent(user.id)}`,{signal:controller.signal});if(!current())return;setSelected(detail);setDraft({name:detail.name,email:detail.email,password:'',confirmPassword:'',role:detail.role,active:detail.active,allowedLocales:detail.allowedLocales||workspaceLocales,qualityScope:!!detail.qualityScope,crmScope:detail.crmScope,crmPermissions:{...noPermissions(),...detail.crmPermissions},profile:{...blankProfile(),...detail.profile}});setOpen(true);}
  catch(reason){if(current())setError(networkError(reason,locale));}
  finally{if(mutationRef.current===controller){mutationRef.current=null;if(mounted.current&&identityRef.current===identity)setBusy(false);}}
 };
 const save=async(event:FormEvent)=>{event.preventDefault();if(mutationRef.current||!mounted.current||!canEdit||!selected&&!policy.canCreate)return;
  if(!selected&&draft.password!==draft.confirmPassword){setError(localized(directoryCopy.passwordMismatch,locale));return;}
  const controller=new AbortController();mutationRef.current=controller;
  const current=()=>mounted.current&&identityRef.current===identity&&mutationRef.current===controller&&!controller.signal.aborted;
  setBusy(true);setError('');try{
  let payload:Record<string,unknown>;
  if(selected){payload={};if(draft.name!==selected.name)payload.name=draft.name;if(canChangeEmail&&draft.email!==selected.email)payload.email=draft.email;if(canChangeActive&&draft.active!==selected.active)payload.active=draft.active;if(selected.profile&&profileKeys.some(key=>draft.profile[key]!==selected.profile[key])){payload.profile=Object.fromEntries(profileKeys.filter(key=>draft.profile[key]!==selected.profile[key]).map(key=>[key,draft.profile[key]]));payload.profileRevision=selected.profileRevision;}if(canManageGrants){if(draft.role!==selected.role)payload.role=draft.role;if(JSON.stringify(draft.allowedLocales)!==JSON.stringify(selected.allowedLocales))payload.allowedLocales=draft.allowedLocales;if(draft.qualityScope!==selected.qualityScope)payload.qualityScope=draft.qualityScope;if(draft.crmScope!==selected.crmScope)payload.crmScope=draft.crmScope;if(permissionKeys.some(key=>draft.crmPermissions[key]!==!!selected.crmPermissions[key]))payload.crmPermissions=draft.crmPermissions;}if(!Object.keys(payload).length){setOpen(false);return;}payload.expectedUpdatedAt=selected.updatedAt;}
  else{const {confirmPassword:_confirmation,...fields}=draft;payload={...fields,...(!senior?{role:'customer',qualityScope:false,crmScope:'assigned',crmPermissions:noPermissions()}:{}),...(draft.role==='translator'?{allowedLocales:draft.allowedLocales.filter(lang=>lang!=='fa')}:{})};}
  const result=await apiClient.request<ManagedUserMutation>(selected?`/users/${encodeURIComponent(selected.id)}`:'/users',{method:selected?'PATCH':'POST',body:JSON.stringify(payload),signal:controller.signal});
  if(!current())return;
  if(result.requiresReauthentication){setDraft(fresh());setOpen(false);window.location.assign(app.href('auth/login'));return;}
  await reload.current(false,true);if(!current())return;setDraft(fresh());setOpen(false);store.notify(wt('saved',locale));
 }catch(reason){if(current())setError(networkError(reason,locale));}finally{if(mutationRef.current===controller){mutationRef.current=null;if(mounted.current&&identityRef.current===identity)setBusy(false);}}};
 const savePassword=async(event:FormEvent)=>{
  event.preventDefault();if(!selected||!canResetPassword||mutationRef.current||!mounted.current)return;
  if(draft.password.length<12||draft.password.length>128){setError(localized(directoryCopy.passwordLength,locale));return;}
  if(draft.password!==draft.confirmPassword){setError(localized(directoryCopy.passwordMismatch,locale));return;}
  const controller=new AbortController();mutationRef.current=controller;
  const current=()=>mounted.current&&identityRef.current===identity&&mutationRef.current===controller&&!controller.signal.aborted;
  setBusy(true);setError('');
  try{const result=await apiClient.request<ManagedUserPasswordResetResult>(`/users/${encodeURIComponent(selected.id)}/password`,{method:'POST',body:JSON.stringify({password:draft.password,expectedUpdatedAt:selected.updatedAt} satisfies ManagedUserPasswordResetInput),signal:controller.signal});if(!current())return;setDraft(value=>({...value,password:'',confirmPassword:''}));if(result.updatedAt)setSelected(value=>value?.id===selected.id?{...value,updatedAt:result.updatedAt!}:value);store.notify(localized(directoryCopy.passwordSaved,locale));}
  catch(reason){if(current())setError(networkError(reason,locale));}
  finally{if(mutationRef.current===controller){mutationRef.current=null;if(mounted.current&&identityRef.current===identity)setBusy(false);}}
 };
 const recoverMfa=async(event:FormEvent)=>{
  event.preventDefault();if(!selected||!canResetMfa||mutationRef.current||!mounted.current)return;
  if(!mfaRecovery.actorPassword||mfaRecovery.actorPassword.length>128){setError(localized(mfaRecoveryCopy.passwordRequired,locale));return;}
  if(!/^[0-9]{6}$/.test(mfaRecovery.actorCode)){setError(localized(mfaRecoveryCopy.codeRequired,locale));return;}
  if(mfaRecovery.password.length<12||mfaRecovery.password.length>128){setError(localized(directoryCopy.passwordLength,locale));return;}
  if(mfaRecovery.password!==mfaRecovery.confirmPassword){setError(localized(directoryCopy.passwordMismatch,locale));return;}
  if(!mfaRecovery.confirmed){setError(localized(mfaRecoveryCopy.confirmationRequired,locale));return;}
  const target=selected,controller=new AbortController();mutationRef.current=controller;
  const current=()=>mounted.current&&identityRef.current===identity&&mutationRef.current===controller&&!controller.signal.aborted;
  const payload:ManagedUserMfaResetInput={actorPassword:mfaRecovery.actorPassword,actorCode:mfaRecovery.actorCode,password:mfaRecovery.password,expectedUpdatedAt:target.updatedAt,profileRevision:target.profileRevision};
  setBusy(true);setError('');
  try{
   const result=await apiClient.request<ManagedUserMfaResetResult>(`/users/${encodeURIComponent(target.id)}/mfa-reset`,{method:'POST',body:JSON.stringify(payload),signal:controller.signal});
   if(!current())return;
   setSelected(value=>value?.id===target.id?{...value,updatedAt:result.updatedAt,profileRevision:result.profileRevision,mfaEnabled:false,capabilities:value.capabilities?{...value.capabilities,canResetMfa:false}:value.capabilities}:value);
   remember({...pageRef.current,items:pageRef.current.items.map(user=>user.id===target.id?{...user,updatedAt:result.updatedAt,mfaEnabled:false,capabilities:user.capabilities?{...user.capabilities,canResetMfa:false}:user.capabilities}:user)});
   setDraft(value=>({...value,password:'',confirmPassword:''}));focusAfterMfa.current=true;clearMfaRecovery();store.notify(localized(mfaRecoveryCopy.saved,locale));
  }catch(reason){if(current()){setMfaRecovery(value=>({...value,actorCode:''}));setError(networkError(reason,locale));}}
  finally{if(mutationRef.current===controller){mutationRef.current=null;if(mounted.current&&identityRef.current===identity)setBusy(false);}}
 };
 return <section data-user-directory data-directory-initial={!initialDirectoryReady&&!directory.loaded&&!directory.error} aria-busy={directory.pending}>
  <div className="ws-toolbar"><SearchInput value={query} onChange={setQuery} locale={locale}/><select className="input" aria-label={wt('role',locale)} value={roleFilter} onChange={event=>setRoleFilter(event.target.value as FrontSession['role']|'')}><option value="">{localized(directoryCopy.allRoles,locale)}</option>{roles.map(item=><option key={item} value={item}>{localized(roleNames[item],locale)}</option>)}</select><div className="ws-toolbar-end"><button className="btn ws-small-btn" disabled={directory.pending} onClick={()=>void load(false,true)}><RefreshCw size={16}/>{wt('refresh',locale)}</button>{policy.canCreate&&<button className="btn btn-primary ws-small-btn" disabled={busy} onClick={event=>void start(null,event.currentTarget)}><Plus size={17}/>{wt('create',locale)}</button>}</div></div>
  {directory.loaded&&policy.provisioningMode==='env'&&<p className="ws-inline-note"><LockKeyhole size={17}/>{localized(L('ساخت کارکنان و تعیین نقش، زبان و سطح دسترسی از تنظیمات محیط سرور انجام می‌شود. ثبت‌نام مشتری از وب‌سایت در دسترس است.','Staff creation, roles, languages and grants are configured in the server environment. Customers can register on the website.','Personel oluşturma, rol, dil ve yetkiler sunucu ortamından yapılandırılır. Müşteriler siteden kayıt olabilir.','يتم إنشاء الموظفين وتحديد الأدوار واللغات والصلاحيات من بيئة الخادم. يمكن للعملاء التسجيل عبر الموقع.','Создание сотрудников, роли, языки и права задаются в окружении сервера. Клиенты могут зарегистрироваться на сайте.'),locale)}</p>}
  {directory.loaded&&policy.provisioningMode==='hybrid'&&<p className="ws-inline-note"><LockKeyhole size={17}/>{localized(directoryCopy.hybrid,locale)}</p>}
  {directory.error&&<p className="ws-storage-error" role="alert">{directory.error}</p>}{error&&!open&&<p className="ws-storage-error" role="alert">{error}</p>}{directory.pending&&<p role="status">{localized(directoryCopy.loading,locale)}</p>}
  <div className="ws-card ws-table-wrap"><table className="ws-table"><thead><tr><th>{wt('name',locale)}</th><th>{localized(directoryCopy.identity,locale)}</th><th>{wt('role',locale)}</th><th>{wt('status',locale)}</th><th>{app.t('mfa')}</th><th>{wt('edit',locale)}</th></tr></thead><tbody>{rows.map(user=><tr key={user.id} data-user-id={user.id}><td dir="auto">{user.name}</td><td><bdi>{user.email||user.phone||'—'}</bdi></td><td>{localized(roleNames[user.role],locale)}</td><td>{wt(user.active?'active':'inactive',locale)}</td><td><ShieldCheck size={18} color={user.mfaEnabled?'var(--color-success)':'currentColor'}/>{user.mfaEnabled?'✓':'—'}</td><td><button className="btn ws-small-btn" disabled={busy||!permitted(user)} onClick={event=>void start(user,event.currentTarget)}><UserRound size={16}/>{wt('edit',locale)}</button></td></tr>)}</tbody></table></div>
  {directory.loaded&&!directory.pending&&rows.length===0&&<p className="ws-muted">{localized(directoryCopy.empty,locale)}</p>}{directory.nextCursor&&<button className="btn ws-small-btn" disabled={directory.pending} onClick={()=>void load(true)}>{localized(directoryCopy.loadMore,locale)}</button>}
  {open&&<Modal title={wt(selected?'edit':'create',locale)} restoreFocusTarget={modalOpener} onClose={()=>{if(!busy){setOpen(false);setDraft(fresh());clearMfaRecovery();setError('');}}}>
   <form ref={profileForm} className="ws-edit-form" onSubmit={save} data-user-profile-form>
    <Field label={wt('name',locale)}><input className="input" value={draft.name} disabled={busy||!canEdit} minLength={2} maxLength={100} required onChange={event=>setDraft(value=>({...value,name:event.target.value}))}/></Field>
    <Field label={wt('email',locale)}><input className="input" dir="ltr" type="email" autoComplete="off" value={draft.email} disabled={busy||!canChangeEmail} maxLength={254} required={!selected||!!selected.email||!selected.phoneVerified||draft.role!=='customer'} onChange={event=>setDraft(value=>({...value,email:event.target.value}))}/></Field>
    {selected?.phoneVerified&&<Field label={localized(directoryCopy.verifiedPhone,locale)}><input className="input" type="tel" dir="ltr" readOnly value={selected.phone||''}/><small>{localized(directoryCopy.phoneHint,locale)}</small></Field>}
    {selected&&canChangeEmail&&<p className="ws-muted">{localized(directoryCopy.emailHint,locale)}</p>}
    {!selected&&<><Field label={app.t('password')}><input className="input" dir="ltr" type="password" autoComplete="new-password" value={draft.password} disabled={busy} minLength={12} maxLength={128} required onChange={event=>setDraft(value=>({...value,password:event.target.value}))}/></Field><Field label={localized(directoryCopy.confirmPassword,locale)}><input className="input" dir="ltr" type="password" autoComplete="new-password" value={draft.confirmPassword} disabled={busy} minLength={12} maxLength={128} required onChange={event=>setDraft(value=>({...value,confirmPassword:event.target.value}))}/></Field></>}
    <div className="ws-form-grid">{profileKeys.map(key=><Field key={key} label={personalSettingsText(locale,key)}>{['bio','address'].includes(key)?<textarea className="input" rows={3} value={draft.profile?.[key]||''} maxLength={USER_PROFILE_LIMITS[key]} disabled={busy||!canEdit} onChange={event=>setDraft(value=>({...value,profile:{...value.profile,[key]:event.target.value}}))}/>:<input className="input" dir={['phone','contactEmail','website'].includes(key)?'ltr':'auto'} type={key==='contactEmail'?'email':key==='website'?'url':key==='phone'?'tel':'text'} autoComplete="off" value={draft.profile?.[key]||''} maxLength={USER_PROFILE_LIMITS[key]} disabled={busy||!canEdit} onChange={event=>setDraft(value=>({...value,profile:{...value.profile,[key]:event.target.value}}))}/>}</Field>)}</div>
    <Field label={wt('role',locale)}><select className="input" disabled={!canManageGrants||busy||selected?.id===app.session?.id} value={draft.role} onChange={event=>setDraft(value=>({...value,role:event.target.value as Draft['role'],allowedLocales:event.target.value==='translator'?value.allowedLocales.filter(lang=>lang!=='fa'):value.allowedLocales,...event.target.value==='customer'?{qualityScope:false,crmScope:'assigned',crmPermissions:noPermissions()}: {}}))}>{(senior?roles:selected?[selected.role]:['customer'] as const).map(item=><option key={item} value={item}>{localized(roleNames[item],locale)}</option>)}</select></Field>
    <label className="ws-checkbox-label"><input type="checkbox" disabled={busy||!canChangeActive} checked={draft.active} onChange={event=>setDraft(value=>({...value,active:event.target.checked}))}/>{wt('active',locale)}</label>
    {canManageGrants&&<>
     <Field label={wt('language',locale)}><div className="ws-form-grid">{workspaceLocales.map(lang=><label className="ws-checkbox-label" key={lang}><input type="checkbox" checked={draft.allowedLocales.includes(lang)} disabled={busy||draft.role==='translator'&&lang==='fa'} onChange={event=>setDraft(value=>({...value,allowedLocales:event.target.checked?[...value.allowedLocales,lang]:value.allowedLocales.filter(item=>item!==lang)}))}/>{localeNames[lang]}</label>)}</div></Field>
     {draft.role!=='customer'&&<><label className="ws-checkbox-label"><input type="checkbox" checked={draft.qualityScope} disabled={busy} onChange={event=>setDraft(value=>({...value,qualityScope:event.target.checked}))}/>{localized(L('دسترسی به گزارش‌های محرمانه کیفیت','Access confidential quality reports','Gizli kalite raporlarına erişim','الوصول إلى تقارير الجودة السرية','Доступ к конфиденциальным отчётам качества'),locale)}</label>
     <Field label={localized(directoryCopy.scope,locale)}><select className="input" disabled={busy} value={draft.crmScope} onChange={event=>setDraft(value=>({...value,crmScope:event.target.value as CrmScope}))}>{(['assigned','team','all'] as const).map(scope=><option value={scope} key={scope}>{localized(directoryCopy[scope],locale)}</option>)}</select></Field>
     <div className="ws-form-grid">{permissionKeys.map(key=><label className="ws-checkbox-label" key={key}><input type="checkbox" disabled={busy} checked={draft.crmPermissions[key]} onChange={event=>setDraft(value=>({...value,crmPermissions:{...value.crmPermissions,[key]:event.target.checked}}))}/>{localized(directoryCopy[key],locale)}</label>)}</div></>}
    </>}
    <p className="ws-muted"><LockKeyhole size={16}/>{localized(L('کارکنان در اولین ورود احراز هویت دومرحله‌ای را فعال می‌کنند.','Staff enable two-factor authentication on their first sign-in.','Personel ilk girişte iki faktörlü doğrulamayı etkinleştirir.','يفعّل الموظفون المصادقة الثنائية عند أول دخول.','При первом входе сотрудники включают двухфакторную аутентификацию.'),locale)}</p>
    <button className="btn btn-primary" disabled={busy||!canEdit||!draft.allowedLocales.length}><Save size={16}/>{busy?'…':wt('save',locale)}</button>
   </form>
   {selected&&canResetPassword&&<form className="ws-edit-form" onSubmit={savePassword} data-user-password-form><hr/><h3>{localized(directoryCopy.resetPassword,locale)}</h3><p className="ws-muted">{localized(directoryCopy.passwordHint,locale)}</p><Field label={localized(directoryCopy.newPassword,locale)}><input className="input" dir="ltr" type="password" autoComplete="new-password" value={draft.password} minLength={12} maxLength={128} disabled={busy} required onChange={event=>setDraft(value=>({...value,password:event.target.value}))}/></Field><Field label={localized(directoryCopy.confirmPassword,locale)}><input className="input" dir="ltr" type="password" autoComplete="new-password" value={draft.confirmPassword} minLength={12} maxLength={128} disabled={busy} required onChange={event=>setDraft(value=>({...value,confirmPassword:event.target.value}))}/></Field><button className="btn" disabled={busy}><LockKeyhole size={16}/>{localized(directoryCopy.resetPassword,locale)}</button></form>}
   {canResetMfa&&<div><hr/><button ref={mfaTrigger} type="button" className="btn" disabled={busy} aria-expanded={mfaRecoveryOpen} aria-controls={mfaRecoveryOpen?mfaFormId:undefined} onClick={()=>{setError('');setMfaRecovery(freshMfaRecovery());setMfaRecoveryOpen(value=>!value);}}><ShieldCheck size={16}/>{localized(mfaRecoveryCopy.title,locale)}</button>
    {mfaRecoveryOpen&&<form id={mfaFormId} className="ws-edit-form" onSubmit={recoverMfa} aria-labelledby={`${mfaFormId}-title`} aria-describedby={`${mfaFormId}-consequences`} data-user-mfa-recovery-form>
     <h3 id={`${mfaFormId}-title`}>{localized(mfaRecoveryCopy.title,locale)}</h3><p id={`${mfaFormId}-consequences`} className="ws-muted">{localized(mfaRecoveryCopy.consequences,locale)}</p>
     <Field label={localized(mfaRecoveryCopy.actorPassword,locale)}><input className="input" name="actorPassword" dir="ltr" type="password" autoComplete="current-password" value={mfaRecovery.actorPassword} maxLength={128} disabled={busy} required onChange={event=>setMfaRecovery(value=>({...value,actorPassword:event.target.value}))}/></Field>
     <Field label={localized(mfaRecoveryCopy.actorCode,locale)}><input className="input" name="actorCode" dir="ltr" type="text" inputMode="numeric" autoComplete="one-time-code" spellCheck={false} value={mfaRecovery.actorCode} minLength={6} maxLength={6} pattern="[0-9]{6}" aria-describedby={`${mfaFormId}-code-hint`} disabled={busy} required onChange={event=>setMfaRecovery(value=>({...value,actorCode:event.target.value}))}/></Field><p id={`${mfaFormId}-code-hint`} className="ws-muted">{localized(mfaRecoveryCopy.codeHint,locale)}</p>
     <Field label={localized(directoryCopy.newPassword,locale)}><input className="input" name="password" dir="ltr" type="password" autoComplete="new-password" value={mfaRecovery.password} minLength={12} maxLength={128} disabled={busy} required onChange={event=>setMfaRecovery(value=>({...value,password:event.target.value}))}/></Field>
     <Field label={localized(directoryCopy.confirmPassword,locale)}><input className="input" name="confirmPassword" dir="ltr" type="password" autoComplete="new-password" value={mfaRecovery.confirmPassword} minLength={12} maxLength={128} disabled={busy} required onChange={event=>setMfaRecovery(value=>({...value,confirmPassword:event.target.value}))}/></Field>
     <label className="ws-checkbox-label"><input type="checkbox" checked={mfaRecovery.confirmed} disabled={busy} required onChange={event=>setMfaRecovery(value=>({...value,confirmed:event.target.checked}))}/>{localized(mfaRecoveryCopy.confirmation,locale)}</label>
     <div className="ws-form-grid"><button type="submit" className="btn btn-primary" disabled={busy||!mfaRecovery.confirmed}><LockKeyhole size={16}/>{busy?'…':localized(mfaRecoveryCopy.submit,locale)}</button><button type="button" className="btn" disabled={busy} onClick={()=>{clearMfaRecovery();setError('');mfaTrigger.current?.focus();}}>{wt('cancel',locale)}</button></div>
    </form>}
   </div>}
   {selected?.id===app.session?.id&&<p className="ws-muted"><a href={app.href('account/security')}>{localized(directoryCopy.ownPassword,locale)}</a></p>}
   {error&&<p className="ws-storage-error" role="alert">{error}</p>}
  </Modal>}
 </section>;
}
