import { createWorkspaceSettings } from '@/data/workspace-defaults';
import type {EditorialSeo} from '@/lib/editorial-seo';
import type {PublishedGlossary} from '@/lib/glossary';
import { products, articles, resources as catalogResources } from '@/data/catalog';
import { L, roleNames, workspaceRoles } from '@/components/workspace/i18n';
import type { WorkspaceText, WorkspaceLocale } from '@/components/workspace/i18n';
import type { PublicFormSchema } from '@/lib/form-schema';
import type { ProductRelease } from '@/lib/product-release';

export interface WorkspaceActivity {
  id: string;
  text: WorkspaceText;
  at: string;
  visibility: 'internal' | 'public';
  actor: string;
}
export interface WorkspaceRecord {
  id: string;
  collection: string;
  title: WorkspaceText;
  summary: WorkspaceText;
  status: string;
  owner: string;
  ownerId?: string;
  assigneeId?: string;
  teamId?: string;
  territoryId?: string;
  updatedAt: string;
  createdAt: string;
  tags: string[];
  demo: boolean;
  organization?: string;
  email?: string;
  product?: string;
  sourceUrl?: string;
  image?: string;
  amount?: string | null;
  currency?: string;
  requestId?: string;
  linkedId?: string;
  due?: string;
  priority?: 'high' | 'normal' | 'low';
  history: WorkspaceActivity[];
  archivedFrom?: string;
  publishedLocales?: WorkspaceLocale[];
  author?: string;
  authorId?: string;
  approvedBy?: string;
  approvedById?: string;
  scheduledAt?: string;
  quoteResponse?: { status: string; response: string; at: string };
  eventStart?: string;
  eventEnd?: string;
  location?: string;
  details?: Record<string, unknown>;
}
export interface PageBlockOptions {
  productIds?: string[];
  ctaLabel?: string;
  secondaryLabel?: string;
  secondaryLink?: string;
  visual?: 'scene' | 'image';
  tone?: 'cyan' | 'violet' | 'neutral';
}
export interface PageBlock {
  shared?: import("@/types/shared-blocks").SharedBlockReference;
  id: string;
  type: string;
  title: string;
  body: string;
  mediaUrl?: string;
  link?: string;
  formId?: string;
  formSchema?: PublicFormSchema;
  hidden?: boolean;
  options?: PageBlockOptions;
}
export interface PageDraft {
  taxonomy?: {category:string;tags:string[]};
  id: string;
  slug: string;
  locale: WorkspaceLocale;
  title: string;
  summary: string;
  status: 'draft' | 'review' | 'approved' | 'published' | 'scheduled' | 'archived';
  version: number;
  author: string;
  authorId?: string;
  approvedBy?: string;
  approvedById?: string;
  scheduledAt?: string;
  updatedAt: string;
  blocks: PageBlock[];
  previous?: { title: string; summary: string; blocks: PageBlock[]; version: number };
}
export interface WorkspaceMedia {
  id: string;
  title: string;
  type: 'image' | 'video' | 'audio' | 'document';
  url: string;
  filename: string;
  size: number;
  usage: string[];
  rights: boolean;
  sourceUrl?: string;
  focalX: number;
  focalY: number;
}
export interface AIJob {
  id: string;
  mode: string;
  locale: WorkspaceLocale;
  productId: string;
  prompt: string;
  output: string;
  createdAt: string;
  status: 'ready' | 'draft';
  authorId?: string;
  responseId?: string;
  provider?: string;
  model?: string;
  tokens?: number | null;
  image?: { url: string; mimeType: string; bytes: number };
  sources?: { id: string; number: number; title: string; url: string; kind: string; sourceUrl?: string }[];
  sourceText?: string;
  referenceLabel?: string;
}
export interface WorkspaceForm {
  id: string;
  status?: 'active' | 'archived';
  updatedAt?: string;
  title: WorkspaceText;
  fields: { id: string; label: WorkspaceText; type: 'text' | 'email' | 'textarea' | 'select' | 'date'; required: boolean; options?: string[]; condition?: string }[];
  responses: { id: string; at: string; values: Record<string, string> }[];
  version: number;
}
export interface WorkspaceState {
  version: 1;
  records: WorkspaceRecord[];
  pages: PageDraft[];
  media: WorkspaceMedia[];
  audit: WorkspaceActivity[];
  aiJobs: AIJob[];
  forms: WorkspaceForm[];
  settings: { name: string; apiUrl: string; defaultLocale: WorkspaceLocale; compact: boolean; email: string; };
}
export interface LocalPublication {
  /** Category and tags frozen with the reviewed locale release, never draft metadata. */
  taxonomy?: {category:string;tags:string[]};
  publicNotice?:import('@/lib/public-notices').PublishedPublicNotice;
  seo?:EditorialSeo;
  glossary?: PublishedGlossary;
  id: string;
  slug: string;
  kind: string;
  locale: WorkspaceLocale;
  title: string;
  summary: string;
  body: string;
  blocks: PageBlock[];
  publishedAt: string;
  version: number;
  eventStart?: string;
  eventEnd?: string;
  location?: string;
  productRelease?: ProductRelease;
  customProduct?: import('@/lib/custom-products').CustomProduct;
}

const initialDate = '2026-10-17T08:30:00.000Z';
export const recordText = (value: string): WorkspaceText => L(value, value, value, value, value);
const sampleSummary = L('پرونده نمونه برای آزمایش فرایند ارتباط با لابراتوار و پیگیری محصولات ایده‌آل ماکو.','Sample record for testing laboratory relationships and Ideal Makoo product follow-up.','Laboratuvar ilişkileri ve Ideal Makoo ürün takibi için örnek kayıt.','سجل تجريبي لاختبار علاقات المختبر ومتابعة منتجات إيديال ماكو.','Пример записи для проверки работы с лабораториями и продукцией Ideal Makoo.');
const contentSummary = L('پیش‌نویس ساختاریافته محتوای کارخانه؛ متن نهایی باید با منبع مرجع و بازبینی علمی تکمیل شود.','Structured factory content draft; finalize against the reference source and scientific review.','Yapılandırılmış fabrika içerik taslağı; referans kaynağı ve bilimsel incelemeyle tamamlayın.','مسودة محتوى منظمة للمصنع؛ أكملها وفق المصدر المرجعي والمراجعة العلمية.','Структурированный черновик контента фабрики; дополните по исходному материалу и научной проверке.');
const newHistory = (): WorkspaceActivity[] => [{ id: 'seed', text: L('پرونده نمونه برای پیش‌نمایش ایجاد شد.','Sample record created for preview.','Önizleme için örnek kayıt oluşturuldu.','تم إنشاء سجل تجريبي للمعاينة.','Создана демонстрационная запись.'), at: initialDate, visibility: 'internal', actor: 'system' }];

export function createWorkspaceSeed(): WorkspaceState {
  let counter = 0;
  const record = (collection: string, title: WorkspaceText, status = 'draft', extra: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
    id: `IM-${collection.toUpperCase()}-${String(++counter).padStart(3, '0')}`,
    collection, title, summary: sampleSummary, status, owner: collection === 'tickets' ? 'support' : 'business',
    updatedAt: initialDate, createdAt: initialDate, tags: [], demo: true, history: newHistory(), priority: 'normal',
    ...extra,
  });
  const pageTitles = [
    L('صفحه اصلی ایده‌آل ماکو','Ideal Makoo home','Ideal Makoo ana sayfa','الصفحة الرئيسية لإيديال ماكو','Главная Ideal Makoo'),
    L('درباره کارخانه','About the factory','Fabrika hakkında','عن المصنع','О фабрике'),
    L('محصولات دندانسازی','Dental products','Diş ürünleri','منتجات الأسنان','Стоматологическая продукция'),
    L('کیفیت و استانداردها','Quality & standards','Kalite ve standartlar','الجودة والمعايير','Качество и стандарты'),
    L('ارتباط با کارخانه','Contact the factory','Fabrikayla iletişim','التواصل مع المصنع','Связаться с фабрикой'),
    L('همکاری و نمایندگی','Cooperation & distribution','İş birliği ve dağıtım','التعاون والتوزيع','Сотрудничество и дистрибуция'),
    L('مرکز دانش دندانسازی','Dental knowledge center','Diş bilgisi merkezi','مركز معرفة الأسنان','Центр знаний о протезировании'),
    L('دانلود کاتالوگ‌ها','Catalog downloads','Katalog indirme','تنزيل الكتالوجات','Скачать каталоги'),
    L('پژوهش و توسعه','Research & development','Araştırma ve geliştirme','البحث والتطوير','Исследования и разработки'),
    L('فرصت‌های شغلی','Career opportunities','Kariyer fırsatları','الفرص الوظيفية','Вакансии'),
  ];
  const pageSlugs = ['home', 'about', 'products', 'quality', 'contact', 'partnerships', 'knowledge', 'downloads', 'research', 'careers'];
  const records: WorkspaceRecord[] = [
    ...products.map((p, index) => record('products', p.name, 'published', { id: p.id, demo: false, summary: p.description, sourceUrl: p.sourceUrl, image: p.image, product: p.id, owner: 'productManager', tags: [p.brand, p.family].filter(Boolean), publishedLocales: ['fa', 'en', 'tr', 'ar', 'ru'] })),
    ...pageTitles.map((title, i) => record('pages', title, i < 3 ? 'published' : i < 6 ? 'review' : 'draft', { summary: contentSummary, owner: 'contentEditor', author: 'contentEditor', sourceUrl: 'https://idealmakoo.com/', tags: [pageSlugs[i]] })),
    record('news', L('معرفی خانواده محصولات دندان مصنوعی','Introducing the artificial teeth range','Yapay diş ürün grubu tanıtımı','التعريف بمجموعة الأسنان الصناعية','Знакомство с линейкой искусственных зубов'), 'review', { summary: contentSummary, owner: 'contentEditor', author: 'contentEditor' }),
    record('news', L('پیش‌نویس خبر دستاوردهای کارخانه','Factory achievements news draft','Fabrika başarıları haber taslağı','مسودة خبر إنجازات المصنع','Черновик новости о достижениях фабрики'), 'draft', { summary: contentSummary, owner: 'contentEditor', author: 'contentEditor' }),
    record('events', L('کارگاه آشنایی با محصولات — نمونه','Product workshop — demo','Ürün atölyesi — demo','ورشة التعريف بالمنتجات — تجريبية','Семинар по продуктам — пример'), 'draft', { summary: contentSummary, due: '2026-11-15', owner: 'contentEditor' }),
    ...articles.map(article => record('research', article.title, 'published', { id: article.id, demo: false, sourceUrl: article.sourceUrl, summary: article.excerpt, image: article.image, owner: 'scientificReviewer', author: 'contentEditor', publishedLocales: ['fa', 'en', 'tr', 'ar', 'ru'] })),
    ...catalogResources.map(resource => record('resources', resource.title, 'published', { id: resource.id, demo: false, sourceUrl: resource.url, summary: resource.title, product: resource.productId, owner: 'productManager' })),
    record('menus', L('ناوبری اصلی وب‌سایت','Main website navigation','Ana site gezinmesi','التنقل الرئيسي للموقع','Основная навигация сайта'), 'active', { summary: L('صفحه اصلی، محصولات، دانشنامه، درباره ما، تماس و استعلام فنی.','Home, products, knowledge, about, contact and technical inquiry.','Ana sayfa, ürünler, bilgi, hakkımızda, iletişim ve teknik talep.','الرئيسية والمنتجات والمعرفة ومن نحن والتواصل والاستفسار الفني.','Главная, продукты, знания, о нас, контакты и технический запрос.'), owner: 'contentEditor', demo: false }),
    record('hr', L('متخصص کنترل کیفیت — نمونه آگهی','Quality specialist — sample vacancy','Kalite uzmanı — örnek ilan','أخصائي جودة — إعلان تجريبي','Специалист по качеству — пример вакансии'), 'draft', { owner: 'hr', summary: contentSummary }),
    record('hr', L('کارشناس توسعه بازار — نمونه آگهی','Market development — sample vacancy','Pazar geliştirme — örnek ilan','تطوير السوق — إعلان تجريبي','Развитие рынка — пример вакансии'), 'draft', { owner: 'hr', summary: contentSummary }),
    record('accounts', L('لابراتوار همکار ۰۱ — نمونه','Partner laboratory 01 — demo','Ortak laboratuvar 01 — demo','مختبر شريك ٠١ — تجريبي','Партнёрская лаборатория 01 — пример'), 'active', { organization: 'DEMO-LAB-01', email: 'lab01@example.invalid' }),
    record('accounts', L('مرکز توزیع ۰۲ — نمونه','Distribution center 02 — demo','Dağıtım merkezi 02 — demo','مركز توزيع ٠٢ — تجريبي','Дистрибьюторский центр 02 — пример'), 'active', { organization: 'DEMO-DIST-02', email: 'dist02@example.invalid' }),
    record('accounts', L('کلینیک همکار ۰۳ — نمونه','Partner clinic 03 — demo','Ortak klinik 03 — demo','عيادة شريكة ٠٣ — تجريبية','Партнёрская клиника 03 — пример'), 'working', { organization: 'DEMO-CLINIC-03', email: 'clinic03@example.invalid' }),
    record('contacts', L('مسئول فنی لابراتوار — نمونه','Laboratory technical contact — demo','Laboratuvar teknik irtibatı — demo','جهة اتصال فنية للمختبر — تجريبية','Технический контакт лаборатории — пример'), 'active', { organization: 'DEMO-LAB-01', email: 'technical@example.invalid' }),
    record('contacts', L('مسئول خرید مرکز توزیع — نمونه','Distributor procurement contact — demo','Distribütör satın alma irtibatı — demo','مسؤول مشتريات الموزع — تجريبي','Закупщик дистрибьютора — пример'), 'active', { organization: 'DEMO-DIST-02', email: 'procurement@example.invalid' }),
    ...Array.from({ length: 6 }, (_, i) => record('leads', L(`استعلام فنی ${products[i % products.length]?.name.fa || 'محصول'}`, `Technical inquiry: ${products[i % products.length]?.name.en || 'product'}`, `Teknik talep: ${products[i % products.length]?.name.tr || 'ürün'}`, `استفسار فني: ${products[i % products.length]?.name.ar || 'منتج'}`, `Технический запрос: ${products[i % products.length]?.name.ru || 'продукт'}`), ['new', 'working', 'qualified'][i % 3], { product: products[i % products.length]?.id, organization: i % 2 ? 'DEMO-DIST-02' : 'DEMO-LAB-01', email: `inquiry${i + 1}@example.invalid`, due: '2026-10-20', amount: null, currency: 'IRR' })),
    ...Array.from({ length: 7 }, (_, i) => record('opportunities', L(`همکاری محصول ${products[i % products.length]?.name.fa || ''}`, `Product cooperation: ${products[i % products.length]?.name.en || ''}`, `Ürün iş birliği: ${products[i % products.length]?.name.tr || ''}`, `تعاون المنتج: ${products[i % products.length]?.name.ar || ''}`, `Сотрудничество: ${products[i % products.length]?.name.ru || ''}`), ['new', 'working', 'qualified', 'proposal', 'won'][i % 5], { product: products[i % products.length]?.id, organization: i % 2 ? 'DEMO-LAB-01' : 'DEMO-DIST-02', amount: null, currency: 'IRR', due: '2026-10-21' })),
    record('quotes', L('پیشنهاد همکاری لابراتوار — نمونه','Laboratory cooperation proposal — demo','Laboratuvar iş birliği teklifi — demo','عرض تعاون مع المختبر — تجريبي','Предложение лаборатории — пример'), 'draft', { organization: 'DEMO-LAB-01', product: products[0]?.id, amount: null, currency: 'IRR', author: 'business' }),
    record('quotes', L('پیشنهاد همکاری توزیع — نمونه','Distribution proposal — demo','Dağıtım teklifi — demo','عرض توزيع — تجريبي','Предложение дистрибьютору — пример'), 'review', { organization: 'DEMO-DIST-02', product: products[1]?.id, amount: null, currency: 'USD', author: 'business' }),
    record('samples', L('نمونه دندان مصنوعی برای ارزیابی','Artificial teeth evaluation sample','Yapay diş değerlendirme numunesi','عينة أسنان صناعية للتقييم','Образец искусственных зубов для оценки'), 'requested', { product: products[0]?.id, organization: 'DEMO-LAB-01' }),
    record('samples', L('بسته نمونه مواد دندانی','Dental materials sample pack','Diş malzemeleri numune paketi','عبوة عينات مواد الأسنان','Набор образцов стоматологических материалов'), 'working', { product: products[products.length - 1]?.id, organization: 'DEMO-CLINIC-03' }),
    record('tickets', L('راهنمای انتخاب قالب دندان','Tooth mould selection guidance','Diş kalıbı seçim rehberi','إرشادات اختيار قالب الأسنان','Помощь в выборе формы зубов'), 'working', { organization: 'DEMO-LAB-01', product: products[0]?.id, priority: 'normal', tags: ['technical'] }),
    record('tickets', L('بررسی بازخورد کیفیت نمونه','Sample quality feedback review','Numune kalite geri bildirimi incelemesi','مراجعة ملاحظات جودة العينة','Проверка отзыва о качестве образца'), 'new', { organization: 'DEMO-CLINIC-03', product: products[1]?.id, priority: 'high', tags: ['quality'], owner: 'scientificReviewer' }),
    record('tickets', L('درخواست نسخه راهنمای کاربرد','Application guide request','Uygulama kılavuzu talebi','طلب دليل الاستخدام','Запрос инструкции по применению'), 'waiting', { organization: 'DEMO-DIST-02', product: products[2]?.id }),
    record('activities', L('پیگیری پاسخ استعلام لابراتوار','Follow up laboratory inquiry','Laboratuvar talebini takip et','متابعة استفسار المختبر','Проверить ответ на запрос лаборатории'), 'new', { organization: 'DEMO-LAB-01', due: '2026-10-18' }),
    record('activities', L('تکمیل بازبینی کاتالوگ محصول','Complete product catalog review','Ürün kataloğu incelemesini tamamla','إكمال مراجعة كتالوج المنتج','Завершить проверку каталога'), 'working', { product: products[0]?.id, due: '2026-10-19', owner: 'productManager' }),
    record('activities', L('هماهنگی ارزیابی نمونه محصول','Coordinate product sample evaluation','Ürün numunesi değerlendirmesini koordine et','تنسيق تقييم عينة المنتج','Организовать оценку образца'), 'new', { organization: 'DEMO-CLINIC-03', due: '2026-10-20' }),
    record('handoffs', L('پرونده تحویل مستند نمونه — آزمایشی','Documented sample handoff — demo','Belgeli numune devri — demo','ملف تسليم عينة موثق — تجريبي','Документированная передача образца — пример'), 'draft', { organization: 'DEMO-LAB-01' }),
    record('partners', L('پرونده بررسی همکاری توزیع','Distribution partnership review','Dağıtım ortaklığı incelemesi','مراجعة شراكة توزيع','Проверка партнёрства по дистрибуции'), 'review', { organization: 'DEMO-DIST-02' }),
    record('segments', L('لابراتوارهای علاقه‌مند به دندان مصنوعی','Laboratories interested in artificial teeth','Yapay dişlerle ilgilenen laboratuvarlar','مختبرات مهتمة بالأسنان الصناعية','Лаборатории, интересующиеся искусственными зубами'), 'draft', { tags: ['teeth', 'laboratory'] }),
    record('campaigns', L('معرفی مستندات فنی محصولات','Product technical documentation campaign','Ürün teknik belgeleri kampanyası','حملة التعريف بالوثائق الفنية للمنتجات','Кампания по технической документации'), 'draft', { summary: contentSummary }),
    record('inbox', L('پرسش آزمایشی درباره کاتالوگ دندان','Sample question about tooth catalog','Diş kataloğu hakkında örnek soru','سؤال تجريبي عن كتالوج الأسنان','Пример вопроса о каталоге зубов'), 'new', { organization: 'DEMO-LAB-01' }),
    record('automations', L('تخصیص استعلام جدید به تیم ارتباطات','Assign new inquiries to relationship team','Yeni talepleri ilişki ekibine ata','إسناد الاستفسارات الجديدة إلى فريق العلاقات','Назначать новые запросы команде'), 'inactive', { summary: L('وقتی استعلام جدید ایجاد شود، یک وظیفه پیگیری داخلی پیشنهاد می‌شود.','When an inquiry is created, suggest an internal follow-up task.','Talep oluşturulduğunda dahili takip görevi öner.','عند إنشاء استفسار، اقتراح مهمة متابعة داخلية.','При создании запроса предложить внутреннюю задачу.') }),
    record('success', L('برنامه پیگیری ارزیابی لابراتوار','Laboratory evaluation follow-up plan','Laboratuvar değerlendirmesi takip planı','خطة متابعة تقييم المختبر','План контроля оценки лаборатории'), 'working', { organization: 'DEMO-LAB-01' }),
    record('communications', L('پاسخ دریافت استعلام محصول','Product inquiry acknowledgment','Ürün talebi alındı bildirimi','إشعار استلام استفسار المنتج','Подтверждение получения запроса'), 'draft', { summary: L('استعلام فنی شما برای بررسی کارشناسی در ایده‌آل ماکو ثبت شد.','Your technical inquiry has been recorded for Ideal Makoo specialist review.','Teknik talebiniz Ideal Makoo uzman incelemesi için kaydedildi.','تم تسجيل استفسارك الفني لمراجعته من مختص إيديال ماكو.','Ваш технический запрос зарегистрирован для рассмотрения специалистом Ideal Makoo.') }),
    ...workspaceRoles.map(role => record('staff', roleNames[role], 'active', { owner: role, email: `demo.${role.toLowerCase()}@example.invalid`, summary: L('حساب نمونه برای آزمایش دسترسی نقش در رابط کاربری.','Sample account for testing role-based interface access.','Rol tabanlı arayüz erişimini test etmek için örnek hesap.','حساب تجريبي لاختبار وصول الدور في الواجهة.','Демонстрационный аккаунт для проверки доступа в интерфейсе.') })),
  ];
  const pages: PageDraft[] = pageTitles.flatMap((title, i) => (['fa', 'en', 'tr', 'ar', 'ru'] as WorkspaceLocale[]).map(locale => ({
    id: `page-${pageSlugs[i]}-${locale}`, slug: pageSlugs[i], locale, title: title[locale], summary: contentSummary[locale], status: 'draft' as const,
    version: 1, author: 'contentEditor', updatedAt: initialDate,
    blocks: [{ id: `hero-${i}-${locale}`, type: 'hero', title: title[locale], body: products[0]?.description[locale] || contentSummary[locale], mediaUrl: products[0]?.image, link: `/${locale}/products` },
      { id: `text-${i}-${locale}`, type: i === 0 ? 'product-carousel' : 'rich-text', title: L('از تجربه تولید تا کیفیت محصول','Manufacturing experience, product quality','Üretim deneyimi ve ürün kalitesi','خبرة التصنيع وجودة المنتج','Опыт производства и качество продукта')[locale], body: contentSummary[locale] }],
  })));
  const media: WorkspaceMedia[] = products.filter(p => !!p.image).map((p, i) => ({ id: `source-media-${i}`, title: p.brand || p.name.en, type: 'image', url: p.image, filename: p.image.split('/').pop() || `${p.slug}.jpg`, size: 0, usage: [p.id], rights: true, sourceUrl: p.sourceUrl, focalX: 50, focalY: 50 }));
  const forms: WorkspaceForm[] = [{ id: 'technical-inquiry', title: L('استعلام فنی محصولات','Product technical inquiry','Ürün teknik talebi','استفسار فني عن المنتجات','Технический запрос по продукции'), version: 1, responses: [], fields: [
    { id: 'name', label: L('نام و نام خانوادگی','Full name','Ad ve soyadı','الاسم الكامل','Полное имя'), type: 'text', required: true },
    { id: 'email', label: L('ایمیل','Email','E-posta','البريد الإلكتروني','Эл. почта'), type: 'email', required: true },
    { id: 'organization', label: L('نام سازمان','Organization','Kuruluş','المؤسسة','Организация'), type: 'text', required: true },
    { id: 'message', label: L('شرح نیاز فنی','Technical requirement','Teknik ihtiyaç','المتطلب الفني','Технические требования'), type: 'textarea', required: true },
  ] }];
  return { version: 1, records, pages, media, audit: [{ id: 'workspace-init', text: L('میزکار یکپارچه ایده‌آل ماکو آماده بررسی است.','The integrated Ideal Makoo workspace is ready to explore.','Entegre Ideal Makoo çalışma alanı incelemeye hazır.','مساحة عمل إيديال ماكو المتكاملة جاهزة للاستكشاف.','Единое рабочее пространство Ideal Makoo готово к просмотру.'), actor: 'system', at: initialDate, visibility: 'internal' }], aiJobs: [], forms, settings: createWorkspaceSettings() };
}
