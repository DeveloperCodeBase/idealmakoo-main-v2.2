'use client';
import {useCallback,useEffect,useRef,useState,type FormEvent} from 'react';
import {MailPlus,RefreshCw,ShieldCheck,UserRoundCheck} from 'lucide-react';
import {useApp} from '@/components/providers/AppProvider';
import {apiClient,ApiError,networkError} from '@/lib/api';
import {roles,type FrontSession} from '@/lib/auth';
import {localized,localeNames,type Locale} from '@/lib/i18n';
import type {RoleKey} from '@/types/domain';
import type {CrmPermissions,CrmScopeDirectory} from '@/types/crm';
import type {StaffInvitation,StaffInvitationInput,StaffHandoverPlan,StaffPerson} from '@/types/staff-lifecycle';
import type {UserDirectoryResponse} from '@/types/user-management';
import {roleNames,wt} from './i18n';

const copy={
 envManaged:localized('ایجاد کارکنان و سطح دسترسی از env سرور مدیریت می‌شود. دعوت جدید از پنل غیرفعال است؛ تحویل مسئولیت و خروج امن کارکنان همچنان در همین بخش انجام می‌شود.','Staff creation and grants are managed in the server environment. New panel invitations are disabled; responsibility handover and secure offboarding remain available here.','Personel oluşturma ve yetkiler sunucu ortamından yönetilir. Panel davetleri kapalıdır; sorumluluk devri ve güvenli işten ayrılma burada yapılabilir.','تُدار حسابات الموظفين وصلاحياتهم من بيئة الخادم. دعوات اللوحة معطلة؛ يبقى تسليم المسؤوليات والمغادرة الآمنة متاحين هنا.','Создание сотрудников и права управляются через окружение сервера. Приглашения из панели отключены; передача обязанностей и безопасное увольнение доступны здесь.'),
 title:localized('دعوت و تحویل مسئولیت کارکنان','Staff invitations and handover','Personel davetleri ve devir','دعوات الموظفين وتسليم المسؤوليات','Приглашения сотрудников и передача дел'),
 invitation:localized('دعوت کارمند','Invite a staff member','Personel davet et','دعوة موظف','Пригласить сотрудника'),
 invitationNote:localized('دعوت فقط به ایمیل انتخاب‌شده متصل است. گیرنده باید همان ایمیل را تأیید کند؛ پس از پذیرش، ورود مجدد و MFA لازم است.','The invitation is bound to the selected email. The recipient verifies that email, accepts, then signs in again with MFA.','Davet seçilen e-postaya bağlıdır. Alıcı adresi doğrular, kabul eder ve MFA ile yeniden giriş yapar.','ترتبط الدعوة بالبريد المحدد. يؤكد المستلم البريد ويقبل ثم يدخل مجددًا باستخدام MFA.','Приглашение связано с выбранной почтой. Получатель подтверждает её, принимает и заново входит с MFA.'),
 pending:localized('در انتظار پذیرش','Awaiting acceptance','Kabul bekleniyor','بانتظار القبول','Ожидает принятия'),
 accepted:localized('پذیرفته‌شده','Accepted','Kabul edildi','مقبولة','Принято'),
 revoked:localized('لغوشده','Revoked','İptal edildi','ملغاة','Отозвано'),
 expired:localized('منقضی','Expired','Süresi doldu','منتهية','Истекло'),
 expires:localized('اعتبار دعوت، ساعت','Invitation lifetime, hours','Davet süresi, saat','صلاحية الدعوة بالساعات','Срок приглашения, часы'),
 deliveryLocale:localized('زبان پیام دعوت','Invitation language','Davet dili','لغة الدعوة','Язык приглашения'),
 scope:localized('دامنه دسترسی CRM','CRM access scope','CRM erişim kapsamı','نطاق وصول CRM','Область доступа CRM'),
 assigned:localized('موارد محول‌شده','Assigned records','Atanan kayıtlar','السجلات المسندة','Назначенные записи'),
 team:localized('تیم و قلمرو','Teams and territories','Ekipler ve bölgeler','الفرق والمناطق','Команды и территории'),
 all:localized('تمام موارد مجاز نقش','All records allowed by role','Rolün izin verdiği tüm kayıtlar','كل السجلات التي يسمح بها الدور','Все записи, разрешённые ролью'),
 contact:localized('اطلاعات تماس','Contact fields','İletişim alanları','حقول الاتصال','Контактные поля'),
 financial:localized('اطلاعات مالی','Financial fields','Finansal alanlar','الحقول المالية','Финансовые поля'),
 baseCost:localized('بهای پایه','Base cost','Taban maliyet','التكلفة الأساسية','Себестоимость'),
 assign:localized('واگذاری مسئولیت','Assign responsibility','Sorumluluk ata','إسناد المسؤولية','Назначение ответственных'),
 intake:localized('صف ورودی CRM','CRM intake queue','CRM giriş kuyruğu','قائمة استقبال CRM','Очередь входящих CRM'),
 quality:localized('دسترسی محرمانه کیفیت','Confidential quality access','Gizli kalite erişimi','الوصول السري للجودة','Доступ к конфиденциальным данным качества'),
 teams:localized('تیم‌های فعال','Active teams','Aktif ekipler','الفرق النشطة','Активные команды'),
 territories:localized('قلمروهای فعال','Active territories','Aktif bölgeler','المناطق النشطة','Активные территории'),
 queued:localized('دعوت ثبت شد؛ ثبت در صف به معنای ارسال یا پذیرش نیست.','Invitation recorded; queueing does not mean it was delivered or accepted.','Davet kaydedildi; kuyruğa alınması teslim veya kabul anlamına gelmez.','سُجلت الدعوة؛ الإدراج في القائمة لا يعني الإرسال أو القبول.','Приглашение записано; постановка в очередь не означает доставку или принятие.'),
 revoke:localized('لغو دعوت','Revoke invitation','Daveti iptal et','إلغاء الدعوة','Отозвать приглашение'),
 handover:localized('تحویل کار و قطع دسترسی','Handover and offboarding','İş devri ve erişimi kapatma','تسليم العمل وإيقاف الوصول','Передача дел и отключение доступа'),
 handoverNote:localized('همه کارهای باز باید به فرد مجاز منتقل شوند. تأیید نهایی، انتقال و غیرفعال‌کردن حساب و نشست‌هایش را یکجا ثبت می‌کند.','Every open responsibility needs an eligible recipient. Final confirmation transfers work and disables the account and its sessions together.','Tüm açık işler yetkili bir alıcıya devredilmelidir. Son onay işleri aktarır, hesabı ve oturumlarını birlikte kapatır.','تحتاج كل مسؤولية مفتوحة إلى مستلم مخوّل. يؤكد الإجراء نقل العمل وتعطيل الحساب وجلساته معًا.','Каждое открытое дело требует уполномоченного получателя. Подтверждение одновременно передаёт дела и отключает аккаунт и сеансы.'),
 preview:localized('بررسی مسئولیت‌های فعلی','Review current responsibilities','Mevcut sorumlulukları incele','مراجعة المسؤوليات الحالية','Проверить текущие обязанности'),
 choose:localized('انتخاب کنید','Select','Seçin','اختر','Выберите'),
 recipient:localized('مسئول جدید','New responsible person','Yeni sorumlu','المسؤول الجديد','Новый ответственный'),
 blocked:localized('موارد مسدود یا خارج از دسترسی','Blocked or inaccessible responsibilities','Engelli veya erişilemeyen sorumluluklar','المسؤوليات المحظورة أو غير المتاحة','Заблокированные или недоступные обязанности'),
 reason:localized('دلیل تحویل و قطع دسترسی','Handover and offboarding reason','Devir ve kapatma gerekçesi','سبب التسليم وإيقاف الوصول','Причина передачи и отключения'),
 final:localized('انتقال مسئولیت‌ها و غیرفعال‌کردن کارمند','Transfer responsibilities and deactivate staff','Sorumlulukları aktar ve personeli devre dışı bırak','نقل المسؤوليات وتعطيل الموظف','Передать обязанности и отключить сотрудника'),
 complete:localized('مسئولیت‌ها منتقل و نشست‌ها لغو شدند.','Responsibilities transferred and sessions revoked.','Sorumluluklar aktarıldı ve oturumlar iptal edildi.','نُقلت المسؤوليات وأُلغيت الجلسات.','Обязанности переданы, сеансы отозваны.'),
 refreshAfterComplete:localized('خروج کارمند انجام شد، اما آخرین وضعیت میزکار بارگیری نشد. وضعیت را بازخوانی کنید.','Offboarding is complete, but the latest workspace could not be loaded. Refresh the status.','Personelin erişimi kapatıldı, ancak güncel çalışma alanı yüklenemedi. Durumu yenileyin.','اكتملت مغادرة الموظف، لكن تعذر تحميل أحدث حالة لمساحة العمل. حدّث الحالة.','Доступ сотрудника отключён, но обновить рабочую область не удалось. Обновите статус.'),
 conflict:localized('اطلاعات عوض شده است؛ انتخاب‌های شما حفظ شد. مسئولیت‌های فعلی را دوباره بارگیری و بررسی کنید.','Data changed; your choices remain. Reload and review current responsibilities.','Veriler değişti; seçimleriniz korundu. Güncel sorumlulukları yeniden yükleyin ve inceleyin.','تغيرت البيانات؛ احتُفظ بخياراتك. أعد تحميل المسؤوليات الحالية وراجعها.','Данные изменились; выбор сохранён. Загрузите и проверьте текущие обязанности.'),
 noOpen:localized('مسئولیت بازی یافت نشد.','No open responsibilities were found.','Açık sorumluluk bulunamadı.','لم تُعثر على مسؤوليات مفتوحة.','Открытых обязанностей не найдено.'),
 empty:localized('دعوتی ثبت نشده است.','No invitations recorded.','Kayıtlı davet yok.','لا توجد دعوات مسجلة.','Приглашений пока нет.'),
 loading:localized('در حال بارگیری…','Loading…','Yükleniyor…','جارٍ التحميل…','Загрузка…'),
 staffSearch:localized('جستجوی کارکنان با نام یا ایمیل','Search staff by name or email','Personeli ad veya e-postayla ara','البحث عن الموظفين بالاسم أو البريد','Поиск сотрудников по имени или почте'),
 loadMore:localized('نمایش کارکنان بیشتر','Load more staff','Daha fazla personel yükle','تحميل المزيد من الموظفين','Загрузить ещё сотрудников'),
 noStaff:localized('کارمندی مطابق جستجو در این صفحه یافت نشد.','No eligible staff match this search on this page.','Bu sayfada aramayla eşleşen uygun personel yok.','لا يوجد موظفون مؤهلون يطابقون البحث في هذه الصفحة.','На этой странице нет подходящих сотрудников по запросу.'),
 pinnedStaff:localized('کارمند انتخاب‌شده؛ با تغییر جستجو حفظ می‌شود','Selected staff member; retained when the search changes','Seçilen personel; arama değiştiğinde korunur','الموظف المحدد؛ يُحفظ عند تغيير البحث','Выбранный сотрудник; сохраняется при изменении поиска'),
 targetUnavailable:localized('این کارمند دیگر برای تحویل مسئولیت مجاز نیست. کارمند دیگری انتخاب کنید.','This staff member is no longer eligible for handover. Select another staff member.','Bu personel artık devir için uygun değil. Başka bir personel seçin.','لم يعد هذا الموظف مؤهلاً لتسليم المسؤوليات. اختر موظفًا آخر.','Этот сотрудник больше не подходит для передачи дел. Выберите другого сотрудника.'),
 invitationGrants:localized('مجوزهای صریح دعوت','Explicit invitation grants','Açık davet yetkileri','صلاحيات الدعوة الصريحة','Явные права приглашения'),
 invitationRoles:localized('فقط مدیر ارشد می‌تواند دعوت جدید و مجوز کارکنان صادر کند.','Only the senior administrator can issue new staff invitations and grants.','Yeni personel daveti ve yetkileri yalnızca üst yönetici verebilir.','يمكن للمسؤول الأعلى فقط إصدار دعوات الموظفين وصلاحياتهم.','Новые приглашения и права выдаёт только старший администратор.'),
 owner:localized('مالک','Owner','Sahip','المالك','Владелец'),
 assignee:localized('مسئول','Assignee','Sorumlu','المكلّف','Исполнитель'),
 task:localized('وظیفه','Task','Görev','مهمة','Задача'),
 record:localized('رکورد','Record','Kayıt','سجل','Запись'),
 request:localized('درخواست','Request','Talep','طلب','Запрос'),
 selected:localized('طرح انتخاب‌شده','Selected plan','Seçilen plan','الخطة المحددة','Выбранный план'),
 version:localized('نسخه فضای کار','Workspace version','Çalışma alanı sürümü','إصدار مساحة العمل','Версия рабочего пространства'),
 view:localized('مشاهده','View','Görüntüle','عرض','Просмотр')
};
const noPermissions=():CrmPermissions=>({contact:false,financial:false,baseCost:false,assign:false,intake:false});
const permissions=(Object.keys(noPermissions()) as (keyof CrmPermissions)[]);
const staffRoles=roles.filter((role):role is Exclude<RoleKey,'customer'>=>role!=='customer');
const initial=(locale:Locale,allowedLocales:Locale[]):StaffInvitationInput=>({email:'',role:'contentEditor',allowedLocales,qualityScope:false,crmScope:'assigned',crmPermissions:noPermissions(),teamIds:[],territoryIds:[],locale,expiresInHours:72});
interface StaffPage {key:string;items:StaffPerson[];nextCursor:string|null;loaded:boolean;pending:boolean;error:string}
const emptyStaff=(key:string):StaffPage=>({key,items:[],nextCursor:null,loaded:false,pending:false,error:''});
interface LifecycleAction {controller:AbortController;targetId?:string}

export default function StaffLifecycle(props:{session:FrontSession;onChanged?:()=>void|Promise<void>}){
 const app=useApp();
 return <StaffLifecycleBody key={JSON.stringify([props.session.id,props.session.role,app.locale])} {...props}/>;
}
function StaffLifecycleBody({session,onChanged}:{session:FrontSession;onChanged?:()=>void|Promise<void>}){
 const app=useApp(),locale=app.locale,tr=(key:keyof typeof copy)=>copy[key][locale];
 const identity=JSON.stringify([session.id,session.role,locale]),identityRef=useRef(identity),mounted=useRef(false);
 identityRef.current=identity;
 const [provisioningMode,setProvisioningMode]=useState<'env'|'hybrid'|'panel'>('env');
 const [items,setItems]=useState<StaffInvitation[]>([]),[directory,setDirectory]=useState<CrmScopeDirectory|null>(null),[canInvite,setCanInvite]=useState(false),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [draft,setDraft]=useState(()=>initial(locale,[locale])),[target,setTarget]=useState(''),[plan,setPlan]=useState<StaffHandoverPlan|null>(null),[assignments,setAssignments]=useState<Record<string,string>>({}),[reason,setReason]=useState(''),[stale,setStale]=useState(false);
 const [query,setQuery]=useState(''),[pinned,setPinned]=useState<StaffPerson|null>(null),targetRef=useRef(''),pinnedRef=useRef<StaffPerson|null>(null);
 const search=query.trim(),staffKey=JSON.stringify([identity,search]),staffKeyRef=useRef(staffKey);staffKeyRef.current=staffKey;
 const [staffPage,setStaffPage]=useState<StaffPage>(()=>emptyStaff(staffKey)),staffPageRef=useRef(staffPage);
 const staffRequest=useRef<{key:string;controller:AbortController}|null>(null),baseRequest=useRef<AbortController|null>(null),actionRequest=useRef<LifecycleAction|null>(null);
 const rememberStaff=useCallback((value:StaffPage)=>{staffPageRef.current=value;setStaffPage(value);},[]);
 const eligible=useCallback((user:StaffPerson)=>user.role!=='customer'&&user.active&&user.id!==session.id&&(session.role==='superAdmin'||!['admin','superAdmin'].includes(user.role)),[session.id,session.role]);
 const cancelTargetRequest=useCallback((targetId:string)=>{
  const action=actionRequest.current;
  if(action?.targetId===targetId){action.controller.abort();actionRequest.current=null;if(mounted.current)setBusy(false);}
 },[]);
 const clearTarget=useCallback((expectedId:string)=>{
  if(targetRef.current!==expectedId)return;
  targetRef.current='';pinnedRef.current=null;
  cancelTargetRequest(expectedId);setTarget('');setPinned(null);setPlan(null);setAssignments({});setReason('');setStale(false);
 },[cancelTargetRequest]);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;staffRequest.current?.controller.abort();baseRequest.current?.abort();actionRequest.current?.controller.abort();};},[]);
 const loadStaff=useCallback(async(append=false,force=false)=>{
  if(!mounted.current||staffKeyRef.current!==staffKey)return;
  if(staffRequest.current?.key===staffKey&&!force)return;
  const previous=staffPageRef.current,cursor=append&&previous.key===staffKey?previous.nextCursor:null;
  if(append&&!cursor)return;
  staffRequest.current?.controller.abort();
  const request={key:staffKey,controller:new AbortController()};staffRequest.current=request;
  const current=()=>mounted.current&&staffKeyRef.current===staffKey&&staffRequest.current===request&&!request.controller.signal.aborted;
  rememberStaff(append?{...previous,pending:true,error:''}:{...emptyStaff(staffKey),pending:true});
  const params=new URLSearchParams({kind:'staff',active:'true',limit:'50'});
  if(search)params.set('q',search);if(cursor)params.set('cursor',cursor);
  try{
   const result=await apiClient.request<UserDirectoryResponse>('/users?'+params,{signal:request.controller.signal});
   if(!current())return;
   const next=append?[...new Map([...previous.items,...result.items].map(user=>[user.id,user])).values()]:result.items;
   rememberStaff({key:staffKey,items:next,nextCursor:result.nextCursor,loaded:true,pending:false,error:''});
   // A filtered page does not prove that a selected account disappeared.
   const targetId=targetRef.current,returned=result.items.find(user=>user.id===targetId);
   if(returned){
    if(!eligible(returned)){setError(copy.targetUnavailable[locale]);clearTarget(targetId);}
    else{pinnedRef.current=returned;setPinned(returned);}
   }
  }catch(cause){if(current())rememberStaff({...staffPageRef.current,pending:false,error:networkError(cause,locale)});}
  finally{if(staffRequest.current===request)staffRequest.current=null;}
 },[staffKey,search,locale,rememberStaff,eligible,clearTarget]);
 const reloadStaff=useRef(loadStaff);reloadStaff.current=loadStaff;
 useEffect(()=>{void loadStaff();return()=>{if(staffRequest.current?.key===staffKey){staffRequest.current.controller.abort();staffRequest.current=null;}};},[staffKey,loadStaff]);
 const load=useCallback(async()=>{
  baseRequest.current?.abort();
  const controller=new AbortController();baseRequest.current=controller;
  const current=()=>mounted.current&&identityRef.current===identity&&baseRequest.current===controller&&!controller.signal.aborted;
  try{
   const [invitations,scope]=await Promise.all([
    apiClient.request<{items:StaffInvitation[];canInvite:boolean;provisioningMode:'env'|'hybrid'|'panel'}>('/staff/invitations',{signal:controller.signal}),
    apiClient.request<CrmScopeDirectory>('/crm/scopes',{signal:controller.signal})
   ]);
   if(!current())return;
   setItems(invitations.items);setCanInvite(invitations.canInvite===true);setProvisioningMode(invitations.provisioningMode);setDirectory(scope);setLoaded(true);
  }catch(cause){if(current())throw cause;}
  finally{
   // Promise.all can reject while its sibling is still reading.
   controller.abort();if(baseRequest.current===controller)baseRequest.current=null;
  }
 },[identity]);
 const reloadBase=useRef(load);reloadBase.current=load;
 useEffect(()=>{setLoaded(false);void load().catch(cause=>{if(mounted.current&&identityRef.current===identity)setError(networkError(cause,locale));});},[load,identity,locale]);
 const run=async(action:(signal:AbortSignal,current:()=>boolean,commitTarget:()=>boolean)=>Promise<void>,targetId?:string)=>{
  if(actionRequest.current||!mounted.current||(targetId!==undefined&&targetRef.current!==targetId))return;
  const request:LifecycleAction={controller:new AbortController(),targetId};actionRequest.current=request;setBusy(true);setError('');
  const current=()=>mounted.current&&identityRef.current===identity&&actionRequest.current===request&&!request.controller.signal.aborted&&(request.targetId===undefined||targetRef.current===request.targetId);
  const commitTarget=()=>{
   if(!current()||request.targetId===undefined)return false;
   // The confirmed write releases its selection while this same actor/action
   // still owns follow-up reads. Clearing it must not abort that cleanup.
   const completedId=request.targetId;request.targetId=undefined;clearTarget(completedId);return true;
  };
  try{await action(request.controller.signal,current,commitTarget);}
  catch(cause){if(current()){setError(targetId&&cause instanceof ApiError&&cause.status===409?tr('conflict'):networkError(cause,locale));if(targetId&&cause instanceof ApiError&&cause.status===409)setStale(true);}}
  finally{if(actionRequest.current===request){actionRequest.current=null;if(mounted.current&&identityRef.current===identity)setBusy(false);}}
 };
 const refresh=()=>void run(async()=>{await Promise.all([reloadBase.current(),reloadStaff.current(false,true)]);});
 const invite=(event:FormEvent)=>{event.preventDefault();void run(async(signal,current)=>{
  await apiClient.request<StaffInvitation>('/staff/invitations',{method:'POST',body:JSON.stringify(draft),signal});
  if(!current())return;setDraft(initial(locale,[locale]));await reloadBase.current();if(current())app.notify(tr('queued'));
 });};
 const revoke=(item:StaffInvitation)=>void run(async(signal,current)=>{
  await apiClient.request(`/staff/invitations/${item.id}`,{method:'DELETE',body:JSON.stringify({expectedVersion:item.version}),signal});
  if(current())await reloadBase.current();
 });
 const currentStaff=staffPage.key===staffKey?staffPage:emptyStaff(staffKey),staff=currentStaff.items.filter(eligible),pinnedOutside=!!(pinned&&eligible(pinned)&&!staff.some(user=>user.id===pinned.id));
 const chooseTarget=(value:string)=>{
  const person=staff.find(user=>user.id===value)||(pinned?.id===value&&eligible(pinned)?pinned:null);
  cancelTargetRequest(targetRef.current);targetRef.current=person?.id||'';pinnedRef.current=person;
  setTarget(targetRef.current);setPinned(person);setPlan(null);setAssignments({});setReason('');setStale(false);
 };
 const preview=()=>{
  const targetId=targetRef.current;if(!targetId)return;
  void run(async(signal,current)=>{
   try{
    const next=await apiClient.request<StaffHandoverPlan>(`/staff/${encodeURIComponent(targetId)}/handover`,{signal});
    if(!current())return;
    if(next.user.id!==targetId){setError(tr('conflict'));setStale(true);return;}
    if(!eligible(next.user)){setError(tr('targetUnavailable'));clearTarget(targetId);return;}
    pinnedRef.current=next.user;setPinned(next.user);setPlan(next);
    setAssignments(previous=>Object.fromEntries(next.items.map(item=>{const key=item.kind+':'+item.id;return[key,item.eligibleUserIds.includes(previous[key])?previous[key]:''];})));setStale(false);
   }catch(cause){
    if(current()&&cause instanceof ApiError&&((cause.status===404&&cause.problem.code==='NOT_FOUND')||(cause.status===403&&cause.problem.code==='ROLE_ESCALATION'))){setError(tr('targetUnavailable'));clearTarget(targetId);}
    throw cause;
   }
  },targetId);
 };
 const finish=(event:FormEvent)=>{
  event.preventDefault();if(!plan||!ready||plan.user.id!==targetRef.current)return;const targetId=plan.user.id;
  void run(async(signal,current,commitTarget)=>{
   try{await apiClient.request(`/staff/${encodeURIComponent(targetId)}/offboard`,{method:'POST',body:JSON.stringify({expectedWorkspaceVersion:plan.workspaceVersion,planHash:plan.planHash,reason,assignments:plan.items.map(item=>({kind:item.kind,id:item.id,toUserId:assignments[item.kind+':'+item.id]}))}),signal});}
   catch(cause){if(current()&&cause instanceof ApiError&&cause.status===409&&cause.problem.code==='STAFF_INACTIVE'){setError(tr('targetUnavailable'));clearTarget(targetId);}throw cause;}
   if(!commitTarget())return;app.notify(tr('complete'));if(!current())return;
   try{
    await Promise.all([reloadBase.current(),reloadStaff.current(false,true)]);if(!current())return;
    await onChanged?.();if(current())window.dispatchEvent(new Event('idealmakoo:requests'));
   }catch{if(current())setError(tr('refreshAfterComplete'));}
  },targetId);
 };
 const allowed=(session.allowedLocales||[locale]).filter((value):value is Locale=>Object.hasOwn(localeNames,value));
 const ready=plan&&plan.user.id===target&&eligible(plan.user)&&plan.canOffboard&&!plan.blockedCount&&!stale&&reason.trim().length>=10&&plan.items.every(item=>item.eligibleUserIds.includes(assignments[item.kind+':'+item.id]));
 return <section aria-label={tr('title')}><div className="ws-toolbar"><h2>{tr('title')}</h2><button className="btn ws-small-btn" disabled={busy} onClick={refresh}><RefreshCw size={16}/>{wt('refresh',locale)}</button></div>{error&&<p role="alert" className="ws-storage-error">{error}</p>}{!loaded&&<p role="status">{tr('loading')}</p>}
 <section className="ws-card"><h3><MailPlus size={18}/> {tr('invitation')}</h3><p className="ws-muted">{tr(provisioningMode==='env'?'envManaged':'invitationNote')}</p>{canInvite&&directory?<form onSubmit={invite}><fieldset disabled={busy}><legend>{tr('invitationGrants')}</legend><div className="ws-form-grid"><label>{wt('email',locale)}<input className="input" required type="email" dir="ltr" autoComplete="off" maxLength={254} value={draft.email} onChange={event=>setDraft({...draft,email:event.target.value})}/></label><label>{wt('role',locale)}<select className="input" value={draft.role} onChange={event=>setDraft({...draft,role:event.target.value as StaffInvitationInput['role'],allowedLocales:event.target.value==='translator'?draft.allowedLocales.filter(lang=>lang!=='fa'):draft.allowedLocales})}>{staffRoles.map(role=><option key={role} value={role}>{roleNames[role][locale]}</option>)}</select></label><label>{tr('expires')}<input className="input" type="number" min={1} max={168} required value={draft.expiresInHours} onChange={event=>setDraft({...draft,expiresInHours:Number(event.target.value)})}/></label><label>{tr('deliveryLocale')}<select className="input" value={draft.locale} onChange={event=>setDraft({...draft,locale:event.target.value as Locale})}>{Object.entries(localeNames).map(([lang,name])=><option key={lang} value={lang}>{name}</option>)}</select></label></div>
 <fieldset><legend>{wt('language',locale)}</legend>{allowed.map(lang=><label className="ws-checkbox-label" key={lang}><input type="checkbox" disabled={draft.role==='translator'&&lang==='fa'} checked={draft.allowedLocales.includes(lang)} onChange={event=>setDraft({...draft,allowedLocales:event.target.checked?[...draft.allowedLocales,lang]:draft.allowedLocales.filter(value=>value!==lang)})}/>{localeNames[lang]}</label>)}</fieldset>
 <label>{tr('scope')}<select className="input" value={draft.crmScope} onChange={event=>setDraft({...draft,crmScope:event.target.value as StaffInvitationInput['crmScope']})}>{(['assigned','team','all'] as const).map(scope=><option key={scope} value={scope} disabled={scope==='all'&&directory.access.scope!=='all'}>{tr(scope)}</option>)}</select></label>
 <div className="ws-form-grid">{permissions.map(key=><label className="ws-checkbox-label" key={key}><input type="checkbox" checked={draft.crmPermissions[key]} disabled={!directory.access.permissions[key]} onChange={event=>setDraft({...draft,crmPermissions:{...draft.crmPermissions,[key]:event.target.checked}})}/>{tr(key)}</label>)}<label className="ws-checkbox-label"><input type="checkbox" checked={draft.qualityScope} disabled={!session.qualityScope} onChange={event=>setDraft({...draft,qualityScope:event.target.checked})}/>{tr('quality')}</label></div>
 {(['teams','territories'] as const).map(kind=><fieldset key={kind}><legend>{tr(kind)}</legend>{directory[kind].filter(group=>group.active).map(group=>{const key=kind==='teams'?'teamIds':'territoryIds';return <label className="ws-checkbox-label" key={group.id}><input type="checkbox" checked={draft[key].includes(group.id)} onChange={event=>setDraft({...draft,[key]:event.target.checked?[...draft[key],group.id]:draft[key].filter(value=>value!==group.id)})}/>{group.name}</label>;})}</fieldset>)}
 <button className="btn btn-primary" disabled={!draft.allowedLocales.length}><MailPlus size={16}/>{tr('invitation')}</button></fieldset></form>:loaded&&provisioningMode!=='env'&&<p>{tr('invitationRoles')}</p>}
 {loaded&&items.length===0&&<p>{tr('empty')}</p>}<div className="ws-table-wrap" tabIndex={0} role="region" aria-label={tr('invitation')}><table className="ws-table"><thead><tr><th>{wt('email',locale)}</th><th>{wt('role',locale)}</th><th>{wt('language',locale)}</th><th>{wt('status',locale)}</th><th>{wt('date',locale)}</th><th>{tr('revoke')}</th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><bdi>{item.email}</bdi></td><td>{roleNames[item.role][locale]}</td><td>{item.allowedLocales.map(lang=>localeNames[lang]).join('، ')}</td><td>{tr(item.status)}</td><td><time dateTime={item.expiresAt}>{new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(item.expiresAt))}</time></td><td>{item.status==='pending'&&<button className="btn ws-small-btn" disabled={busy} onClick={()=>revoke(item)}>{tr('revoke')}</button>}</td></tr>)}</tbody></table></div></section>
 <section className="ws-card" data-staff-handover data-selected-staff-id={target||undefined}><h3><UserRoundCheck size={18}/> {tr('handover')}</h3><p className="ws-muted">{tr('handoverNote')}</p><label>{tr('staffSearch')}<input className="input" type="search" value={query} maxLength={100} onChange={event=>setQuery(event.target.value)}/></label>{currentStaff.error&&<p className="ws-storage-error" role="alert">{currentStaff.error}</p>}{currentStaff.pending&&<p role="status">{tr('loading')}</p>}<div className="ws-form-grid"><label>{wt('name',locale)}<select className="input" value={target} disabled={busy} onChange={event=>chooseTarget(event.target.value)}><option value="">{tr('choose')}</option>{pinnedOutside&&pinned&&<option value={pinned.id}>{pinned.name} · {roleNames[pinned.role][locale]} · {tr('pinnedStaff')}</option>}{staff.map(user=><option key={user.id} value={user.id}>{user.name} · {roleNames[user.role][locale]}</option>)}</select></label><button className="btn" disabled={busy||!target} onClick={preview}><RefreshCw size={16}/>{tr('preview')}</button></div>{pinnedOutside&&pinned&&<p className="ws-muted" data-pinned-staff-id={pinned.id}>{tr('pinnedStaff')}: <bdi>{pinned.name}</bdi></p>}{currentStaff.loaded&&!currentStaff.pending&&staff.length===0&&<p className="ws-muted">{tr('noStaff')}</p>}{currentStaff.nextCursor&&<button className="btn ws-small-btn" disabled={currentStaff.pending} onClick={()=>void loadStaff(true)}>{tr('loadMore')}</button>}
 {plan&&<form onSubmit={finish}><h4>{tr('selected')}: {plan.user.name}</h4><p className="ws-muted">{tr('version')}: {plan.workspaceVersion}</p>{plan.blockedCount>0&&<p role="alert" className="ws-storage-error">{tr('blocked')}: {plan.blockedCount}</p>}{plan.items.length===0&&<p>{tr('noOpen')}</p>}<div className="ws-table-wrap"><table className="ws-table"><thead><tr><th>{wt('name',locale)}</th><th>{wt('type',locale)}</th><th>{tr('recipient')}</th></tr></thead><tbody>{plan.items.map(item=>{const key=item.kind+':'+item.id;return <tr key={key}><td>{item.title}<small className="ws-muted"> <bdi>{item.id}</bdi></small></td><td>{tr(item.kind)} · {item.responsibilities.map(value=>tr(value)).join('، ')}</td><td><select className="input" aria-label={`${tr('recipient')}: ${item.title}`} disabled={busy||stale} required value={assignments[key]||''} onChange={event=>setAssignments({...assignments,[key]:event.target.value})}><option value="">{tr('choose')}</option>{item.eligibleUserIds.map(id=>{const person=plan.recipients.find(value=>value.id===id);return <option key={id} value={id}>{person?.name||id}{person?' · '+roleNames[person.role][locale]:''}</option>;})}</select></td></tr>;})}</tbody></table></div><label>{tr('reason')}<textarea className="input" minLength={10} maxLength={2000} required disabled={busy} value={reason} onChange={event=>setReason(event.target.value)}/></label><button className="btn btn-primary" disabled={busy||!ready}><ShieldCheck size={17}/>{tr('final')}</button></form>}
 </section></section>;
}
