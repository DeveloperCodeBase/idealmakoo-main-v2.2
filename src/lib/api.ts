import {clearContentLeases,contentLeaseHeaders} from '@/lib/content-lease-client';
import type { FrontRequest } from '@/types/frontend';
import type { Rfc9457ProblemDetails } from '@/types/domain';

/** Demo data is opt-in and cannot authenticate or persist a production session. */
export const demoMode = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
export const dataMode: 'api' | 'local' = demoMode ? 'local' : 'api';
export class ApiError extends Error {
 problem:Rfc9457ProblemDetails;
 constructor(problem: Pick<Rfc9457ProblemDetails,'type'|'title'|'status'|'detail'> & Partial<Rfc9457ProblemDetails>) { super(problem.detail || problem.title || 'Request failed'); this.problem={instance:'',code:'',requestId:'',...problem};this.name = 'ApiError'; }
 get status() { return this.problem.status; }
}
export interface PageResult<T> { items: T[]; total: number; page: number; pageSize: number }
let csrfToken = '';
let csrfGeneration=0;
let csrfRequest: Promise<void> | null = null;
export function setCsrfToken(value: string) { if(value!==csrfToken){csrfGeneration++;clearContentLeases();}csrfToken = value; }
export function clearCsrfToken() {csrfGeneration++;csrfRequest=null;csrfToken = '';clearContentLeases();}
function assertResponseGeneration(generation:number) {
 if(generation!==csrfGeneration)throw new ApiError({type:'about:blank',title:'Account changed',detail:'The account changed before the response was received.',status:409});
}
const configuredBase = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
/** Private data and CSRF tokens are sent only to this application's same-origin API. */
export function apiPath(path: string, base = configuredBase): string {
 if (!base.startsWith('/') || base.startsWith('//') || /[\\?#\s]/.test(base)) throw new Error('API base must be a same-origin path');
 if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path');
 return base.replace(/\/$/, '') + path;
}
async function ensureCsrf(base:string){
 if(csrfToken)return;
 if(!csrfRequest){const generation=csrfGeneration;const pending=(async()=>{const response=await fetch(apiPath('/auth/session',base),{credentials:'same-origin',cache:'no-store',redirect:'error'});const payload=await response.json();if(!response.ok||typeof payload.csrfToken!=='string')throw new Error('Cannot establish a secure session');if(generation===csrfGeneration)csrfToken=payload.csrfToken;})();csrfRequest=pending;try{await pending;}finally{if(csrfRequest===pending)csrfRequest=null;}return;}
 await csrfRequest;
}
export class HttpClient {
 private baseUrl:string;
 constructor(baseUrl = configuredBase) {this.baseUrl=baseUrl;}
 private async response(path:string,options:RequestInit={}):Promise<Response>{
  const method = (options.method || 'GET').toUpperCase();
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const generation=csrfGeneration;
  if (mutation) await ensureCsrf(this.baseUrl);
  if(generation!==csrfGeneration)throw new ApiError({type:'about:blank',title:'Account changed',detail:'The account changed before this action could be sent.',status:409});
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (mutation) headers.set('X-CSRF-Token', csrfToken);
  if(mutation&&(path==='/workspace'||path.startsWith('/workspace/')||path.startsWith('/content/blocks')))for(const [key,value] of Object.entries(contentLeaseHeaders()))headers.set(key,value);
  const response = await fetch(apiPath(path, this.baseUrl), { ...options, method, credentials: 'same-origin', cache: 'no-store', redirect:'error',headers });
  assertResponseGeneration(generation);
  if (!response.ok) {
   const body = await response.json().catch(() => ({}));
   assertResponseGeneration(generation);
   const problem = { type: 'about:blank', title: response.statusText || 'Request failed', detail: response.statusText || 'Request failed', ...body, status: response.status } as Rfc9457ProblemDetails;
   // A rejected password or MFA proof does not revoke an otherwise valid
   // session. Preserve the form so the user can correct that proof; genuine
   // missing/revoked sessions and unclassified 401 responses still expire it.
   const invalidProof=problem.code==='INVALID_CREDENTIALS'||problem.code==='MFA_INVALID';
   if (response.status === 401 && !invalidProof && generation===csrfGeneration && typeof window !== 'undefined') window.dispatchEvent(new Event('idealmakoo:session-expired'));
   throw new ApiError(problem);
  }
  return response;
 }
 async request<T>(path:string,options:RequestInit={}):Promise<T>{
  const generation=csrfGeneration,response=await this.response(path,options);
  // Header arrival does not finish a fetch: JSON parsing may settle after a
  // different account has signed in. Reject the old body, including decode
  // errors, before any caller can adopt it into the current account's state.
  try{return response.status===204?undefined as T:await response.json() as T;}
  finally{assertResponseGeneration(generation);}
 }
 async blob(path:string,options:RequestInit={}):Promise<Blob>{
  const generation=csrfGeneration,response=await this.response(path,options);
  try{return await response.blob();}finally{assertResponseGeneration(generation);}
 }
}
export interface RequestRepository { list(): Promise<FrontRequest[]>; create(input: Omit<FrontRequest, 'id' | 'createdAt'>, idempotencyKey: string): Promise<FrontRequest>; update(id: string, patch: Partial<FrontRequest>, expectedVersion: number): Promise<FrontRequest> }
export class HttpRequestRepository implements RequestRepository {
 private client:HttpClient;
 constructor(client = new HttpClient()) {this.client=client;}
 async list() { const result = await this.client.request<FrontRequest[] | PageResult<FrontRequest>>('/requests'); return Array.isArray(result) ? result : result.items; }
 create(input: Omit<FrontRequest, 'id' | 'createdAt'>, key: string) { return this.client.request<FrontRequest>('/requests', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(input) }); }
 update(id: string, patch: Partial<FrontRequest>, version: number) { return this.client.request<FrontRequest>(`/requests/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'If-Match': String(version) }, body: JSON.stringify(patch) }); }
}
export const apiClient = new HttpClient();
export const apiRequests = new HttpRequestRepository(apiClient);
export function networkError(error: unknown, locale = 'en'): string {
 const status = error instanceof ApiError ? error.status : 0;
 const proofCode=error instanceof ApiError?error.problem.code:'';
 if(status===503&&proofCode==='AUTH_BUSY'){
  const busyCopy:Record<string,string>={
   fa:'سرویس احراز هویت موقتاً شلوغ است. کمی بعد دوباره تلاش کنید.',
   en:'Authentication is temporarily busy. Please try again shortly.',
   tr:'Kimlik doğrulama hizmeti geçici olarak yoğun. Lütfen biraz sonra tekrar deneyin.',
   ar:'خدمة التحقق من الهوية مشغولة مؤقتًا. حاول مجددًا بعد قليل.',
   ru:'Сервис проверки учётных данных временно занят. Повторите попытку немного позже.'
  };
  return busyCopy[locale]||busyCopy.en;
 }
 if(proofCode==='INVALID_CREDENTIALS'||proofCode==='MFA_INVALID'){
  const proofCopy:Record<string,[string,string]>={
   fa:['اطلاعات ورود یا رمز فعلی درست نیست. دوباره بررسی کنید.','کد احراز هویت نامعتبر، مصرف‌شده یا منقضی است. یک کد تازه وارد کنید.'],
   en:['The sign-in details or current password are incorrect. Check them and try again.','The verification code is invalid, already used, or expired. Enter a fresh code.'],
   tr:['Giriş bilgileri veya geçerli parola yanlış. Kontrol edip tekrar deneyin.','Doğrulama kodu geçersiz, kullanılmış veya süresi dolmuş. Yeni bir kod girin.'],
   ar:['بيانات تسجيل الدخول أو كلمة المرور الحالية غير صحيحة. تحقق منها وحاول مجدداً.','رمز التحقق غير صالح أو استُخدم أو انتهت صلاحيته. أدخل رمزاً جديداً.'],
   ru:['Данные входа или текущий пароль неверны. Проверьте их и повторите попытку.','Код подтверждения недействителен, уже использован или просрочен. Введите новый код.']
  };
  return(proofCopy[locale]||proofCopy.en)[proofCode==='MFA_INVALID'?1:0];
 }
 // Server problem details are operational English and may contain input text.
 // Present reviewed localized guidance instead of appending the raw detail.
 const actionKey=proofCode==='STORAGE_USER_QUOTA'?'userQuota':proofCode==='STORAGE_QUOTA'?'siteQuota':status===413?'size':status===415?'type':status===400||status===422?'validation':status===404?'missing':status===423?'locked':status===507?'siteQuota':status===502||status===503||status===504?'service':null;
 if(actionKey){
  const actionCopy:Record<string,Record<string,string>>={
   fa:{userQuota:'سهمیهٔ فضای فایل‌های حساب شما تکمیل شده است. برای بررسی فایل‌های قبلی یا افزایش سهمیه با مدیر تماس بگیرید.',siteQuota:'فضای مجاز ذخیره‌سازی سایت تکمیل شده است. مدیر باید فضا را بررسی یا سهمیه را افزایش دهد.',size:'فایل یا درخواست خالی است یا از سقف مجاز بیشتر است. محدودیت فعلی بارگذاری را بررسی کنید.',type:'این نوع فایل یا قالب درخواست پشتیبانی نمی‌شود. از قالب مجاز استفاده کنید.',validation:'اطلاعات واردشده معتبر نیست یا کامل نشده است. فیلدهای فرم و پیش‌نیازهای این اقدام را بررسی کنید.',missing:'مورد درخواست‌شده پیدا نشد یا دیگر در دسترس شما نیست. فهرست را تازه‌سازی کنید.',locked:'این مورد برای ویرایش قفل است. وضعیت ویرایش همکاران را بررسی و پس از آزادشدن دوباره تلاش کنید.',service:'سرویس در حال حاضر آمادهٔ پاسخ‌گویی نیست. کمی بعد دوباره تلاش کنید؛ در صورت تکرار، مدیر باید تنظیمات و وضعیت سرویس را بررسی کند.'},
   en:{userQuota:'Your account storage quota is full. Ask an administrator to review retained files or increase your quota.',siteQuota:'The site storage quota is full. An administrator must review available space or increase the quota.',size:'The file or request is empty or exceeds the allowed size. Check the current upload limits.',type:'This file type or request format is not supported. Use an allowed format.',validation:'The submitted information is invalid or incomplete. Check the form fields and requirements for this action.',missing:'The requested item was not found or is no longer available to you. Refresh the list.',locked:'This item is locked for editing. Check who is editing it and try again after the lock is released.',service:'The service is not ready to respond. Try again shortly; if this continues, ask an administrator to check its configuration and status.'},
   tr:{userQuota:'Hesabınızın dosya depolama kotası doldu. Mevcut dosyaları incelemek veya kotayı artırmak için yöneticiyle iletişime geçin.',siteQuota:'Sitenin depolama kotası doldu. Bir yönetici kullanılabilir alanı incelemeli veya kotayı artırmalıdır.',size:'Dosya veya istek boş ya da izin verilen boyutu aşıyor. Geçerli yükleme sınırlarını kontrol edin.',type:'Bu dosya türü veya istek biçimi desteklenmiyor. İzin verilen bir biçim kullanın.',validation:'Girilen bilgiler geçersiz veya eksik. Form alanlarını ve bu işlemin gerekliliklerini kontrol edin.',missing:'İstenen öğe bulunamadı veya artık erişiminize açık değil. Listeyi yenileyin.',locked:'Bu öğe düzenleme için kilitli. Kimin düzenlediğini kontrol edin ve kilit kaldırıldıktan sonra tekrar deneyin.',service:'Hizmet şu anda yanıt vermeye hazır değil. Biraz sonra tekrar deneyin; sorun sürerse yöneticiden ayarları ve hizmet durumunu kontrol etmesini isteyin.'},
   ar:{userQuota:'امتلأت حصة تخزين ملفات حسابك. اطلب من المسؤول مراجعة الملفات المحفوظة أو زيادة حصتك.',siteQuota:'امتلأت حصة تخزين الموقع. يجب على المسؤول مراجعة المساحة المتاحة أو زيادة الحصة.',size:'الملف أو الطلب فارغ أو يتجاوز الحجم المسموح. راجع حدود الرفع الحالية.',type:'نوع الملف أو تنسيق الطلب غير مدعوم. استخدم تنسيقًا مسموحًا.',validation:'المعلومات المُدخلة غير صالحة أو غير مكتملة. راجع حقول النموذج ومتطلبات هذا الإجراء.',missing:'لم يُعثر على العنصر المطلوب أو لم يعد متاحًا لك. حدّث القائمة.',locked:'هذا العنصر مقفل للتحرير. تحقق ممن يحرره وحاول مجددًا بعد تحرير القفل.',service:'الخدمة غير جاهزة للاستجابة حاليًا. حاول بعد قليل؛ وإذا استمرت المشكلة، اطلب من المسؤول مراجعة إعدادات الخدمة وحالتها.'},
   ru:{userQuota:'Квота хранилища вашего аккаунта исчерпана. Попросите администратора проверить сохранённые файлы или увеличить квоту.',siteQuota:'Квота хранилища сайта исчерпана. Администратор должен проверить свободное место или увеличить квоту.',size:'Файл или запрос пуст либо превышает допустимый размер. Проверьте текущие ограничения загрузки.',type:'Этот тип файла или формат запроса не поддерживается. Используйте разрешённый формат.',validation:'Введённые данные неверны или неполны. Проверьте поля формы и требования к этому действию.',missing:'Запрошенный элемент не найден или больше вам недоступен. Обновите список.',locked:'Этот элемент заблокирован для редактирования. Проверьте, кто его редактирует, и повторите попытку после снятия блокировки.',service:'Сервис сейчас не готов ответить. Повторите попытку позже; если проблема сохраняется, попросите администратора проверить настройки и состояние сервиса.'}
  };
  return(actionCopy[locale]||actionCopy.en)[actionKey];
 }
 const key = status === 409 || status === 412 ? 'conflict' : status === 401 ? 'session' : status === 403 ? 'denied' : status === 429 ? 'rate' : 'failed';
 const copy: Record<string, Record<string, string>> = {
  fa: { conflict: 'نسخه داده در سرور تغییر کرده است. پیش از تلاش دوباره، نسخه ذخیره‌شده را بررسی کنید.', session: 'نشست شما پایان یافته است؛ دوباره وارد شوید.', denied: 'برای این عملیات دسترسی ندارید.', rate: 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.', failed: 'عملیات در سرور ثبت نشد. اتصال را بررسی و دوباره تلاش کنید.' },
  en: { conflict: 'The server version changed. Review the current saved version before retrying.', session: 'Your session expired. Please sign in again.', denied: 'You do not have permission for this action.', rate: 'Too many requests. Please try again shortly.', failed: 'The server did not save this action. Check your connection and try again.' },
  tr: { conflict: 'Sunucudaki sürüm değişti. Güncel verileri kontrol edip tekrar deneyin.', session: 'Oturumunuz sona erdi. Yeniden giriş yapın.', denied: 'Bu işlem için yetkiniz yok.', rate: 'Çok fazla istek. Biraz sonra tekrar deneyin.', failed: 'İşlem sunucuda kaydedilmedi. Bağlantınızı kontrol edip tekrar deneyin.' },
  ar: { conflict: 'تغير إصدار البيانات على الخادم. راجع البيانات الجديدة وأعد المحاولة.', session: 'انتهت جلستك. سجّل الدخول مجددًا.', denied: 'ليس لديك صلاحية هذا الإجراء.', rate: 'طلبات كثيرة. حاول بعد قليل.', failed: 'لم يحفظ الخادم هذا الإجراء. تحقق من الاتصال وأعد المحاولة.' },
  ru: { conflict: 'Версия на сервере изменилась. Проверьте новые данные и повторите действие.', session: 'Сеанс истёк. Войдите снова.', denied: 'Нет разрешения на это действие.', rate: 'Слишком много запросов. Повторите немного позже.', failed: 'Сервер не сохранил действие. Проверьте соединение и повторите попытку.' }
 };
 return (copy[locale] || copy.en)[key];
}
