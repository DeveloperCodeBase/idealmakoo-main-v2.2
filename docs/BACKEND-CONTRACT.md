> **سند تاریخی قرارداد پیشنهادیِ پیش‌نمونهٔ فرانت‌اند؛ راهنمای وضعیت یا اجرای نسخهٔ سروری ۲.۱ نیست.**
>
> عبارت‌هایی مانند «وضعیت فعلی»، «هنوز پیاده‌سازی نشده»، خروجی static، ذخیره‌سازی مرورگر و Worker در متن زیر به زمان نگارش پیش‌نمونه اشاره می‌کنند. این متن برای حفظ سابقه نگه داشته شده است و قرارداد endpoint یا دستور استقرار نسخهٔ جاری را تعیین نمی‌کند. درخواست پیاده‌سازی بک‌اند، پایگاه‌داده و Docker بر محدودهٔ فرانت‌اند آن سند مقدم است.
>
> برای نسخهٔ جاری از [شروع و اجرای پروژه](../README.md)، [استقرار Docker روی Ubuntu](DEPLOYMENT.fa.md)، [قرارداد API پیاده‌شده](API.md)، [AI و محتوای چندزبانه](AI-MULTILINGUAL.fa.md)، [پوشش الزامات](PRODUCTION-COVERAGE.fa.md) و [شواهد آزمون](VERIFICATION.fa.md) استفاده کنید. پیوند تاریخی Google AI در ادامه نیز سند پیش‌نمونه است؛ راهنمای تنظیم کلید و مدل فعلی، `AI-MULTILINGUAL.fa.md` است.

# قرارداد اتصال بک‌اند ایده‌آل ماکو

این سند راهنمای توسعهٔ بک‌اند برای **فرانت‌اند موجود** است. مبنا، کد همین مخزن و قراردادهای سند اصلی در [ORIGINAL-SPEC.md](./ORIGINAL-SPEC.md) است؛ نام‌گذاری یک endpoint در بخش «پیشنهادی» به معنی پیاده‌سازی آن نیست.

**وضعیت فعلی:** سایت عمومی، حساب، CMS و CRM از ذخیره‌سازی فرانت‌اند استفاده می‌کنند. در نسخهٔ سوم، `worker/ai-handler.ts` برای گفتگو، متن، بازنویسی، ترجمه و تولید/ویرایش تصویر به API واقعی Google متصل شده است. Next.js همچنان `output: 'export'` دارد؛ خروجی آن در پوستهٔ Worker ESM قرار می‌گیرد تا مسیرهای `/api/ai/*` کنار صفحات اجرا شوند. `.openai/hosting.json` دیگر static نیست و `BUCKET` را برای خروجی تصویر معرفی می‌کند. راهنمای دقیق در [GOOGLE-AI.md](GOOGLE-AI.md) است.

PostgreSQL، احراز هویت تولیدی نقش‌های کارخانه، صف پایدار، API مدیریتی CMS/CRM، پیامک و ایمیل هنوز مسئولیت بک‌اند آینده‌اند. درگاه AI در میزبانی فعلی پشت دسترسی خصوصی مالک قرار دارد؛ نقش‌های دمو، توکن یا مرز امنیتی سمت سرور محسوب نمی‌شوند. تغییر سایت به مخاطب عمومی باید همراه با احراز هویت و محدودیت مصرف پایدار مناسب انجام شود.

## افزودهٔ نسخهٔ پنجم: حساب و ترجیحات شخصی

`src/lib/user-settings.ts` مدل‌های `UserProfile`، `UserPreferences` و `UserSettings` و repository محلی را تعریف می‌کند. رابط مشترک از `AppProvider.userSettings`، `settingsReady`، `displayName`، `saveProfile` و `savePreferences` استفاده می‌کند. این بخش از `NEXT_PUBLIC_DATA_MODE` مستقل است؛ تغییر آن متغیر، حساب و تنظیمات را به سرور وصل نمی‌کند.

### قرارداد پیشنهادی HTTP؛ هنوز پیاده‌سازی سرور نیست

| عملیات | مسیر پیشنهادی زیر `/api/v1` | ورودی و پاسخ |
| --- | --- | --- |
| خواندن حساب جاری | `GET /me/settings` | `UserSettings` متعلق به نشست سرور؛ پاسخ با `Cache-Control: private, no-store`. |
| ویرایش پروفایل | `PATCH /me/profile` | فقط فیلدهای `UserProfile`، هدر `If-Match` با revision فعلی؛ پاسخ کل `UserSettings` تازه. |
| ویرایش ترجیحات | `PATCH /me/preferences` | فقط فیلدهای `UserPreferences`، هدر `If-Match`؛ پاسخ مدل تازه. |
| عکس پروفایل | `PUT /me/avatar` و `DELETE /me/avatar` | فایل محدود و رمزگشایی/رمزگذاری دوباره در سرور، یا حذف؛ پاسخ پروفایل تازه و revision تازه. |

فیلدهای پروفایل فعلی: `name`، `phone`، `contactEmail`، `organization`، `profession`، `bio`، `website`، `country`، `city`، `address` و `avatar`. فیلدهای ترجیحات: `theme`، `language`، `timezone`، `motion`، `effects`، `fontSize`، `density` و `sidebar`. انتخاب‌ها و حدود معتبر، در همان فایل نوع‌دار و اعتبارسنجی شده‌اند.

مالک از نشست معتبر سرور تعیین می‌شود؛ `ownerId`، `role`، ایمیل ورود و شناسهٔ کاربر از body پذیرفته نشوند. `contactEmail` صرفاً نشانی تماس است و نباید ایمیل ورود یا مجوز مشاهدهٔ پرونده را تغییر دهد. ایمیل ورود به endpoint جداگانه با تأیید دوبارهٔ هویت و نشانی تازه نیاز دارد.

سرور باید ذخیرهٔ بخش انتخاب‌شده را با مقایسهٔ اتمیک revision انجام دهد و بخش دیگر را حفظ کند. خطای نشست به 401، نداشتن مجوز به 403، اعتبارسنجی به 422 و تعارض نسخه به 409 یا 412 نگاشت شود. مدل محلی `SaveSettingsResult` از `session`، `validation`، `storage` و `conflict` استفاده می‌کند. هنگام اتصال شبکه، نتیجهٔ درخواست و خطا در provider به همین وضعیت‌های قابل نمایش تبدیل شود و فرم هنگام انتظار غیرفعال و پس از خطا قابل اصلاح بماند.

آواتار فعلی یک data URL رستری ۵۱۲×۵۱۲ با سقف ۱۹۲ KiB است؛ فایل ورودی تا ۸ MiB و ۳۲ میلیون پیکسل بررسی می‌شود. اعتبارسنجی مرورگر، جای رمزگشایی و محدودیت سرور را نمی‌گیرد. اگر بک‌اند به‌جای data URL نشانی دانلود خصوصی برگرداند، adapter نمایش عکس باید صریحاً به همان مسیر یا دامنهٔ مورد اعتماد محدود شود؛ اعتبارسنج فعلی عمداً URL دلخواه و SVG را نمی‌پذیرد.

دو صفحهٔ `admin/profile` و `admin/preferences` دسترسی شخصی view/edit/export دارند. این مجوزها اجازهٔ ویرایش `admin/settings`، کاربر دیگر، لوگوی شرکت یا انتشار محتوا نیستند. backend نیز باید همین تفکیک را مستقل از منوها اجرا کند. تنظیمات و پروفایل نباید در cache عمومی service worker قرار بگیرند. دادهٔ محلی نسخهٔ نمایشی بدون اقدام آگاهانهٔ صاحب حساب به سرور منتقل نشود.

## ۱. مرز اتصال فعلی؛ تنظیم محیط چه چیزی را تغییر می‌دهد؟

تنظیمات عمومی موجود در `.env.example`:

```dotenv
NEXT_PUBLIC_DATA_MODE=local
NEXT_PUBLIC_API_BASE_URL=/api/v1
NEXT_PUBLIC_SITE_URL=https://idealmakoo-glass-platform.sunsetkid7.chatgpt.site
```

`NEXT_PUBLIC_DATA_MODE=api` **فقط مسیر ایجاد درخواست در `AppProvider.createRequest` را به HTTP وصل می‌کند**. این متغیر، کل برنامه را به بک‌اند متصل نمی‌کند. در خروجی استاتیک، متغیرهای `NEXT_PUBLIC_*` هنگام ساخت وارد بستهٔ مرورگر می‌شوند؛ تغییرشان نیازمند ساخت مجدد است.

| عملیات | رفتار فعلی | کار باقی‌مانده برای اتصال کامل |
| --- | --- | --- |
| ایجاد استعلام، درخواست نمونه، همکاری، تیکت و دیگر فرم‌های استفاده‌کننده از `createRequest` | در حالت `local` در مرورگر ثبت می‌شود؛ در حالت `api`، `POST /requests` فراخوانی و پاسخ در حافظهٔ محلی نگهداری می‌شود. | پیاده‌سازی endpoint، اعتبارسنجی، مالکیت، نرخ مجاز درخواست و انتقال پیوست. |
| خواندن فهرست درخواست‌ها | `AppProvider` از `idealmakoo.requests.v1` می‌خواند. | اتصال hydration، بازخوانی و فیلتر مالکیت به repository. |
| `HttpRequestRepository.list()` | تابع `GET /requests` موجود است، اما provider آن را فراخوانی نمی‌کند. | اتصال صریح تابع به چرخهٔ دادهٔ رابط. |
| ویرایش درخواست، پاسخ مشتری و پاسخ به پیشنهاد | `AppProvider.updateRequest` محلی است؛ نسخه را محلی افزایش می‌دهد. | اتصال تغییرات به HTTP و مدیریت تعارض و خطا. |
| `HttpRequestRepository.update()` | تابع `PATCH /requests/{id}` با `If-Match` موجود است، اما provider از آن استفاده نمی‌کند. | جایگزینی فراخوانی‌های محلی و تعریف مجوز فیلدهای قابل تغییر. |
| CMS، صفحه‌ساز، CRM، فایل‌های رسانه‌ای و انتشار | `useWorkspaceStore` و چند عملیات مستقیم `localStorage`؛ مستقل از `dataMode`. | repositoryهای جداگانه و فرمان‌های دامنهٔ سروری لازم‌اند. |
| ورود، MFA، عضویت سازمان، ترجیحات و اعلان | شبیه‌سازی و دادهٔ محلی. | سرویس هویت، session و سرویس سازمانی/اعلان لازم است. |
| AI، پایش زیرساخت و کانال‌های اطلاع‌رسانی | قالب محلی یا نمایش صریح «متصل نیست». | آداپتور واقعی و کارگر قابل پایش لازم است. |

فیلد `settings.apiUrl` در تنظیمات میزکار صرفاً در snapshot محلی ذخیره می‌شود؛ `HttpClient` از `NEXT_PUBLIC_API_BASE_URL` می‌خواند و با ویرایش این فیلد تغییر نمی‌کند. کلید خصوصی سرویس‌ها نباید در هیچ متغیر `NEXT_PUBLIC_*` یا ورودی عمومی مرورگر قرار گیرد.

## ۲. فایل‌های مرجع و مسئولیت هر لایه

| فایل | مسئولیت موجود |
| --- | --- |
| `src/types/domain.ts` | قراردادهای دامنهٔ هدف: زبان، نقش، محصول نوع‌دار، revision، release، درخواست، پیام، پیش‌فاکتور و خطای استاندارد. تعریف TypeScript است؛ schema دیتابیس یا اجرای سرور نیست. |
| `src/types/frontend.ts` | شکل دادهٔ ساده‌تر که رابط فعلی واقعاً مصرف می‌کند: `FrontRequest`، `InquiryLine`، `RequestMessage`، `SharedQuote` و `FrontPublication`. |
| `src/lib/api.ts` | `HttpClient`، `ApiError` و `RequestRepository`؛ تنها مرز HTTP فعلی برای درخواست‌ها. |
| `src/lib/frontend-state.ts` | پاک‌سازی دادهٔ خوانده‌شده از مرورگر؛ جایگزین اعتبارسنجی ورودی سرور نیست. |
| `src/components/providers/AppProvider.tsx` | هویت نمایشی، زبان، تم، فهرست استعلام، مقایسه، علاقه‌مندی و درخواست‌های مشترک سایت/پورتال. |
| `src/data/catalog.ts` | دادهٔ مرجع محصولات، پژوهش‌ها، صفحات شرکتی و فایل‌ها، همراه `sourceUrl`. |
| `src/lib/publications.ts` و `src/components/site/PublicationRenderer.tsx` | خواندن انتشار محلی، اعمال عنوان/خلاصه روی محصول یا مقالهٔ مرجع و رندر عمومی ۲۸ نوع بلوک. |
| `src/data/workspace-seed.ts` | مدل ساده‌شدهٔ میزکار و داده‌های اولیهٔ علامت‌دار. |
| `src/components/workspace/store.ts` | CRUD محلی، دفتر رخداد محلی، اتصال درخواست سایت به میزکار و انتشار محلی. |
| `src/components/workspace/Records.tsx` | ویرایش رکورد، تبدیل سرنخ، بازبینی و انتشار محتوا، صدور پیشنهاد محلی و پیوند آن به درخواست. |
| `src/components/workspace/CMS.tsx` | ویرایش صفحه، بررسی نسخهٔ محلی و صفحه‌ساز ۲۸ بلوکی. |
| `src/components/workspace/ProductEditor.tsx` و `product-editor-data.ts` | پیش‌نویس نوع‌دار پنج‌زبانهٔ محصول، مشخصات/گونه/رسانه، اعتبارسنجی و خروجی مشروط `ProductEntity`. |
| `src/lib/product-release.ts` و `ProductReleaseSection` | snapshot مجزای محصول هنگام ارسال به بازبینی، parser محدودکننده و نمایش عمومی دادهٔ فنی/محتوای محلیِ بازبینی‌شده کنار منبع رسمی. |
| `src/components/workspace/CrmTools.tsx` و `crm-tools-logic.ts` | مقایسه و merge/unmerge، CSV wizard و برآورد دقیق چندردیفی quote/pricebook؛ منطق خالص قابل جایگزینی با فرمان سرور. |
| `src/components/workspace/SiteSettings.tsx` و `src/lib/site-preferences.ts` | پیش‌نویس/اعمال برند، تماس، منو و فوتر؛ hook مشترک با ناوبری و فوتر عمومی. |
| `src/lib/form-schema.ts` و `src/components/site/CustomForm.tsx` | schema عمومی نسخه‌دار، اعتبارسنجی شرطی و ارسال فرمِ منتشرشده از مسیر درخواست مشترک. |
| `src/components/account/auth-storage.ts` و `portal-data.ts` | حساب محلی، مرحلهٔ MFA نمایشی، انتخاب درخواست‌های قابل مشاهده و ابزار ورود CSV. |
| `src/lib/attachments.ts` | نگهداری پیوست در IndexedDB؛ فایل به سرور ارسال نمی‌شود. |
| `src/lib/auth.ts` | ۱۲ حساب دمو و تابع نمایشی `authorize` برای دسترسی مسیر. |
| `src/components/providers/PwaRuntime.tsx`، `public/service-worker.js` و `public/sw-policy.js` | ثبت Service Worker و سیاست محدود cache تصاویر رسمی/فونت؛ فاقد cache صفحات یا اطلاعات خصوصی. |

## ۳. قراردادهای دامنه و فاصلهٔ آن‌ها با مدل رابط

### ۳.۱. زبان و محصول

`SupportedLocale` دقیقاً `fa | en | tr | ar | ru` است. فارسی و عربی راست‌به‌چپ هستند. دادهٔ تاریخ/زمان سرور باید UTC با ISO 8601 باشد؛ نمایش بر اساس زبان و منطقهٔ زمانی انجام شود. تاریخ بدون ساعت، مانند موعد تمام‌روز، باید به‌عنوان `date-only` نگهداری شود و نباید با تبدیل ناخواستهٔ منطقهٔ زمانی یک روز جابه‌جا شود.

| قرارداد در `domain.ts` | مصرف فعلی در فرانت‌اند | نگاشت لازم در بک‌اند |
| --- | --- | --- |
| `ProductEntity` | نمایش عمومی از `Product` مرجع؛ `ProductEditor` پیش‌نویس نوع‌دار متن/SEO، مشخصات، گونه، گالری/دانلود، روابط و provenance را نگه می‌دارد و پس از تکمیل/اعتبارسنجی خروجی این قرارداد را می‌سازد. | ذخیرهٔ revision و تأیید دادهٔ فنی در سرور؛ mapper نمایش `title → name` و `shortDescription → description` با شناسه و slug پایدار. |
| `ProductFamilyType` | `teeth` یا `materials`. | `artificial_teeth ↔ teeth` و `dental_materials ↔ materials`؛ یک mapper صریح لازم است. |
| `ArtificialTeethSpecs` | مشخصات مرجع و editor فیلدهای خانوادهٔ دندان و SKU/شید/قالب، کنترل تکرار SKU/ترکیب و مقدار عددی؛ فهرست کامل گونه‌های تأییدشدهٔ قابل عرضه در دادهٔ منبع موجود نیست. | ساخت variant فقط از دادهٔ معتبر کارخانه؛ ترکیب شید/قالب باید در یک گونهٔ واقعی اعتبارسنجی شود. |
| `DentalMaterialSpecs` | editor جداگانهٔ غلظت/رده، روش پخت، مقدار و نگهداری؛ کنترل گونه‌های مخصوص دندان برای خانوادهٔ مواد پذیرفته نمی‌شود. | اعتبارسنجی و تأیید فنی سرور؛ مقدار نامعلوم `null` یا صریحاً ناموجود باشد و ویژگی بالینی حدس زده نشود. |
| `resourceIds` و `relatedProductIds` | روابط catalog و editor محلی دانلود با نوع واقعی فایل، زبان، برچسب و منبع و انتخاب محصولات مرتبط. | تبدیل URL/رابطه به منابع و نسخه‌های فایل دارای مجوز و provenance. |

پیش‌نویس کامل در `WorkspaceRecord.details.productDraft` با `schemaVersion: 1`، revision، زبان‌ها، دادهٔ فنی و URL منبع ذخیره می‌شود. ارسال به بازبینی، snapshot جداگانهٔ `details.productReviewDraft` را با `createProductRelease` می‌سازد؛ autosave بعدی این snapshot بازبینی را تغییر نمی‌دهد. ذخیره/ارسال مجدد، تأیید قبلی را پاک می‌کند. پس از تأیید و انتشار، `productRelease` همراه انتشار محلی ذخیره می‌شود؛ کارت، فهرست و صفحهٔ محصول از متن، مشخصات، گونه‌ها، گالری و دانلودهای بازبینی‌شده استفاده می‌کنند. نسخهٔ اولیهٔ مرجع جدا و تغییرناپذیر نگه داشته می‌شود. parser، snapshot نامعتبر را نمی‌پذیرد.

`ProductRelease` دارای شناسهٔ محصول، revision، زمان پیش‌نویس، خانواده، URL رسمی، متن‌های پنج‌زبانه، جنس، مشخصات فنی، ردیف مشخصات، گونه، گالری و دانلود است؛ فیلدهای خصوصی یا پاسخ فرم در آن قرار نمی‌گیرند. دادهٔ رسمی catalog حفظ می‌شود و گونهٔ تألیفی با منشأ تحریریه نمایش داده می‌شود؛ بازبینی محلی آن به‌معنای تأیید کارخانه نیست. خروجی JSON پیش‌نویس با گزارش اعتبارسنجی در دسترس است، اما خروجی `ProductEntity` به تکمیل فیلدهای لازم وابسته است. تغییرناپذیری این snapshot در چرخهٔ UI، جای نگهداری و تصویب سروری را نمی‌گیرد.

### ۳.۲. محتوا و انتشار

`ContentRevision<TSnapshot>` شامل `documentId`، `locale`، شمارهٔ revision، revision پایه، نسخهٔ schema، snapshot، checksum، نویسنده و بازبین است. وضعیت revision یکی از `draft`، `ready_for_review`، `needs_changes`، `approved` و `archived` و وضعیت تأیید علمی مستقل است.

`LocaleRelease` اشاره‌گر `activeRevisionId` را برای هر جفت `documentId + locale` نگه می‌دارد؛ `releaseNumber` و `lockVersion` برای کنترل همزمانی لازم‌اند. در رابط فعلی، `PageDraft` یک نسخهٔ ساده‌تر با `version`، `previous`، `author`، `approvedBy` و بلوک‌هاست. `WorkspaceRecord` نیز وضعیت کلی و متن‌های پنج‌زبانه دارد. این‌ها معادل جدول revision تغییرناپذیر، اجارهٔ ویرایش یا انتشار تراکنشی نیستند.

قواعد پیشنهادی سرور:

1. ذخیرهٔ پیش‌نویس، نسخهٔ منتشرشده را تغییر ندهد.
2. تصویب به revision و checksum مشخص متصل باشد؛ تغییر متن یا اعداد، تصویب قبلی را برای نسخهٔ جدید معتبر نکند.
3. `createdBy !== reviewedBy` بر اساس **شناسهٔ کاربر** بررسی شود. رابط فعلی `authorId` و `approvedById` را بررسی می‌کند؛ این شناسه‌های مرورگر باید در سرور از نشست احرازشده گرفته شوند.
4. انتشار فقط اشاره‌گر همان زبان را عوض کند؛ به‌روزرسانی release، audit و outbox یک تراکنش باشد.
5. زمان‌بندی توسط worker اجرا شود. `scheduledAt` فعلی تنها دادهٔ محلی است.
6. بازگردانی یک release جدید به revision قبلی بسازد؛ تاریخچه را پاک نکند.

### ۳.۳. درخواست واحد

`UnifiedRequestRecord` قرارداد هدف برای RFQ، نمونه، همکاری، استخدام، پشتیبانی، کیفیت و بازدید است. بخش‌های مهم آن شامل `requestId`، شمارهٔ پیگیری، `ownerUserId`، `accountId`، `sharedMemberIds`، snapshot تماس، `publicStatus`، `internalStage`، مسئول، تیم، SLA، دامنهٔ کیفیت، snapshot اقلام و `lockVersion` است.

| مدل رابط فعلی | مقصد پیشنهادی در مدل دامنه |
| --- | --- |
| `id` | `requestId`؛ `referenceNumber` باید جداگانه توسط سرور صادر شود. |
| `name/email/phone/organization/country` | `contactSnapshot` با اعتبارسنجی فیلدها. |
| `ownerId` | `ownerUserId` از session سرور؛ مقدار ارسالی مرورگر قابل اعتماد نیست. |
| `status` | `publicStatus`؛ وضعیت داخلی باید به فیلد مستقل `internalStage` منتقل شود. |
| `items: InquiryLine[]` | `itemsSnapshot` شامل عنوان، گونه، واحد و revision مشاهده‌شده؛ تعداد فعلی عدد صحیح است، قرارداد دامنه تعداد Decimal را رشته نگه می‌دارد. |
| `productIds` | شاخص کمکی برای فیلتر؛ جای snapshot اقلام را نمی‌گیرد. |
| `batch` | `batchOrLotCode` در قلم مربوط یا جزئیات پروندهٔ کیفیت. |
| `version` | `lockVersion` یا نسخهٔ DTO با mapper روشن. |
| `messages` | رکوردهای مجزای `RequestMessageRecord` با مجوز visibility. |
| `sharedQuotes` | DTO فقط برای نسخهٔ صادرشده و مجازِ پیشنهاد؛ مدل اصلی باید `CrmQuoteRevision` بماند. |
| `formId/formVersion/formValues` | شناسه و نسخهٔ فرم مشاهده‌شده و فقط مقادیر معتبر/قابل مشاهده؛ سرور باید همان schema را بازیابی و دوباره اعتبارسنجی کند. |
| `consent` | snapshot فعلی `{purpose:'request_processing', acceptedAt}`؛ رضایت رسیدگی به همین درخواست است، نه رضایت بازاریابی. |

`FrontRequest.kind` اکنون `string` است. افزون بر مقادیر `RequestKind`، مسیرهای محلی می‌توانند `callback`، `event_registration`، `data_deletion`، `cms_form` یا `cms_contact` ثبت کنند. این مقادیر در union فعلی `domain.ts` نیستند. هنگام اتصال، باید با تصمیم صریح به endpoint اختصاصی یا union نسخهٔ جدید نگاشت شوند؛ حذف خاموش یا تبدیل همهٔ آن‌ها به RFQ درست نیست.

وضعیت عمومی هدف `received | in_review | waiting_customer | responded | resolved | closed | withdrawn` است. میزکار محلی وضعیت‌هایی مانند `new`، `working` یا `converted` دارد و برخی تغییرات را مستقیماً به `FrontRequest.status` می‌نویسد. بک‌اند باید این دو واژگان را جدا و نگاشت کند، نه اینکه مرحلهٔ فروش را همان وضعیت قابل مشاهدهٔ مشتری فرض کند.

### ۳.۴. پیام و پیش‌فاکتور

شکل واقعی پیام قابل مبادله بین میزکار و پورتال:

```ts
type RequestMessage = {
  id: string;
  body: string;
  visibility: 'public' | 'internal';
  createdAt: string;
  sender: string;
};
```

پورتال فقط `public` را نمایش می‌دهد. در سرور، `RequestMessageRecord` علاوه بر این اطلاعات، `requestId`، هویت و نقش فرستنده و `attachmentIds` دارد. API مشتری نباید پیام داخلی را در DTO برگرداند؛ مخفی‌کردن آن با CSS یا فیلتر مرورگر کافی نیست.

`CrmQuoteRevision` در `domain.ts` قرارداد کامل پیشنهاد نسخه‌دار است: اقلام Decimal، ارز، نسخهٔ سیاست محاسبه، تخفیف و مالیات، جمع‌ها، اعتبار، snapshotHash، هش PDF، تهیه‌کننده و تأییدکننده. ارزهای هدف `IRR | USD | EUR | TRY | RUB` هستند.

رابط فعلی، هم رکورد سادهٔ مبلغ/ارز و هم editor چندردیفی quote/pricebook دارد. مدل ساخت‌یافته در `WorkspaceRecord.details.commercialDraft` ذخیره می‌شود: `schemaVersion: 1`، `kind`، `locale`، `currency`، `lines`، `estimate`، `calculationPolicyVersion: 'local-line-half-up-v1'`، `serverRecalculationRequired: true` و `updatedAt`. هر قلم شامل محصول و عنوان snapshot، واحد، تعداد Decimal رشته‌ای، قیمت nullable، درصد تخفیف و ارز است.

محاسبهٔ محلی با نسبت‌های صحیح BigInt انجام می‌شود؛ ورودی حداکثر شش رقم اعشار دارد. مبلغ ناخالص هر ردیف و سپس تخفیف درصدی با half-up گرد می‌شوند؛ دقت IRR صفر و چهار ارز دیگر دو رقم است و جمع، حاصل ردیف‌های گرد‌شده است. قیمت نامعلوم `null` می‌ماند و جمع قطعی نمی‌سازد. ارزهای مختلف در یک سند پذیرفته نمی‌شوند؛ تغییر ارز قیمت‌ها را پاک می‌کند و تبدیل ارز انجام نمی‌دهد. این **برآورد محلی** است و سرور باید با سیاست مالی مصوب خود دوباره محاسبه کند.

ذخیرهٔ پیشنهاد ساخت‌یافته، مبلغ رکورد را از جمع محاسبه‌شده می‌گیرد و تأیید قبلی را پاک می‌کند. هنگام صدور، schema، نوع quote، محصول، ارز، معلوم‌بودن تمام قیمت‌ها و تطابق دقیق مبلغ رکورد با محاسبهٔ تازه بررسی می‌شوند؛ تغییر دستی مبلغ نمی‌تواند این کنترل را دور بزند. بازبینی با نقش متفاوت و اتصال به `requestId` نیز لازم است. snapshot اقلام و شرایط به مشتری داده می‌شود و در SHA-256 محلی دخیل است. این هش امضای سرور نیست؛ چاپ مرورگر هم سرویس PDF خصوصی نیست.

```ts
type SharedQuote = {
  id: string;
  number: string;
  title: string;
  amount: string;
  currency: string;
  status: 'issued' | 'accepted_interest' | 'declined' | 'revision_requested';
  issuedAt: string;
  validUntil?: string;
  snapshotHash: string;
  customerResponse?: string;
  respondedAt?: string;
  lines?: SharedQuoteLine[];
  terms?: string;
};

type SharedQuoteLine = {
  id: string;
  productId: string;
  titleSnapshot: string;
  unit: string;
  quantityDecimal: string;
  unitPriceDecimal: string | null;
  discountPercentDecimal: string;
  currency: string;
  netDecimal?: string | null;
};
```

پاسخ مشتری روی همین snapshot نگهداری و یک‌بار به تاریخچهٔ فروش برگردانده می‌شود. پاسخ فقط در وضعیت `issued` و پیش از پایان اعتبار پذیرفته می‌شود؛ رابط و handler محلی، پیشنهاد منقضی یا پاسخ‌داده‌شده را مسدود می‌کنند. سه پاسخ اعلام تمایل، رد و درخواست اصلاح پشتیبانی می‌شوند. `accepted_interest` تنها اعلام تمایل B2B است؛ پرداخت، سفارش قطعی یا تغییر خودکار فرصت به «برنده» نیست. محاسبهٔ مرجع سرور، مالیات، سقف تخفیف، PDF خصوصی دارای `fileSha256` و جلوگیری تراکنشی از صدور/پاسخ تکراری هنوز لازم‌اند. union فعلی `CrmQuoteRevision.status` در `domain.ts` هنوز `revision_requested` ندارد؛ mapper سروری یا نسخهٔ بعد قرارداد باید این پاسخ رابط را صریحاً پشتیبانی کند.

## ۴. ثبت کامل ذخیره‌سازی و رویدادهای فعلی

### ۴.۱. داده‌های مرورگر

| محل/کلید | داده و مالک کد |
| --- | --- |
| `localStorage: idealmakoo.theme` | `dark/light`؛ provider و اسکریپت اولیهٔ theme. |
| `localStorage: idealmakoo.locale` | آخرین زبان؛ URL همچنان مرجع زبان صفحه است. |
| `localStorage: idealmakoo.session.v1` | `FrontSession` محلی و نقش نمایشی. |
| `localStorage: idealmakoo.inquiries.v1` | `InquiryLine[]`؛ فهرست استعلام مشترک سایت و حساب. |
| `localStorage: idealmakoo.compare.v1` | شناسهٔ حداکثر چهار محصول منتخب. |
| `localStorage: idealmakoo.saved.v1` | شناسهٔ موارد ذخیره‌شده. این دو فهرست عمومی فعلاً به شناسهٔ حساب namespace نشده‌اند. |
| `localStorage: idealmakoo.requests.v1` | `FrontRequest[]`، پیام‌ها و پیشنهادهای مشترک. |
| `localStorage: idealmakoo.workspace.v1` | `WorkspaceState`: رکوردها، صفحه‌ها، رسانه، audit، job محلی محتوا، فرم‌ها و تنظیمات. |
| `localStorage: idealmakoo.publications.v1` | `LocalPublication[]`؛ نسخه‌های محلی قابل نمایش عمومی. |
| `localStorage: idealmakoo.site-preferences.v1` | `SitePreferences` اعمال‌شده: برند/تماس و گروه‌ها و لینک‌های navigation/footer با برچسب پنج‌زبانه. |
| `localStorage: idealmakoo.site-preferences-draft.v1` | پیش‌نویس جداگانهٔ همان تنظیمات؛ تا زمان apply، navigation عمومی را تغییر نمی‌دهد. |
| `localStorage: idealmakoo.sidebar` | وضعیت باز/بستهٔ سایدبار میزکار. |
| `localStorage: idealmakoo.form-preview.{blockId}` | پاسخ نمونهٔ فرم داخل پیش‌نمایش بلوک؛ ارسال عمومی سروری نیست. |
| `localStorage: idealmakoo.local-accounts.v1` | حساب‌های customer ثبت‌شده در همین مرورگر، salt و digest محلی رمز. |
| `localStorage: idealmakoo.auth.remembered-email.v1` | ایمیل به‌خاطر سپرده‌شده در فرم ورود. |
| `localStorage: idealmakoo.auth.last-sign-in.v1` | اطلاعات آخرین ورود محلی. |
| `localStorage: idealmakoo.auth.recovery.v1` | ثبت محلی درخواست بازیابی؛ ایمیل بازیابی ارسال نمی‌شود. |
| `sessionStorage: idealmakoo.auth.pending.v1` | مرحلهٔ ورود پیش از MFA نمایشی با انقضای ده دقیقه. |
| `localStorage: idealmakoo.account.{id}.profile.v1` | مشخصات حرفه‌ای، زبان و منطقهٔ زمانی حساب محلی. |
| `localStorage: idealmakoo.account.{id}.organizations.v1` | سازمان‌های ساخته‌شده در پورتال محلی؛ مجوز عضویت سروری ایجاد نمی‌کند. |
| `localStorage: idealmakoo.account.{id}.notifications-read.v1` | شناسهٔ اعلان‌های خوانده‌شده. |
| `localStorage: idealmakoo.account.{id}.notification-prefs.v1` | ترجیحات محلی موضوع/کانال/تناوب و ساعت سکوت. |
| `localStorage: idealmakoo.account.{id}.security.v1` | تنظیم MFA دمو و کدهای بازیابی محلی. |
| `IndexedDB: idealmakoo-local-files`, version `1`, store `files` | پیوست‌های درخواست، با رکورد `{id,file,name,type,createdAt}`؛ سقف هر فایل ۵ مگابایت. |
| `CacheStorage: idealmakoo-public-assets-v1` | فقط تصاویر رسمی/فونت عمومیِ تأییدشده توسط پاسخ میزبان؛ سیاست Service Worker در بخش ۹. |
| CacheStorage با پیشوند `idealmakoo-private` | provider هنگام خروج، cache احتمالی با این پیشوند را حذف می‌کند؛ Service Worker فعلی دادهٔ خصوصی cache نمی‌کند. |

رسانهٔ میزکار در `WorkspaceState.media` به‌صورت URL یا data URL و با سقف بارگذاری محلی ۲ مگابایت نگهداری می‌شود. این مکانیزم با پیوست‌های IndexedDB فرم‌های عمومی متفاوت است. خروجی JSON میزکار، بکاپ دیتابیس، خروجی کامل حساب یا خروجی فایل‌های IndexedDB نیست. مقدار `version: 1` نشانگر قالب snapshot است؛ سامانهٔ migration عمومی برای همهٔ کلیدها وجود ندارد.

### ۴.۲. رویدادها و محدودیت همگام‌سازی

| رویداد | تولیدکننده/مصرف‌کننده | payload |
| --- | --- | --- |
| `idealmakoo:store` | `writeStore`؛ provider، پورتال و reader انتشار | `CustomEvent.detail = { key: string }`؛ داده پس از رخداد دوباره از storage خوانده می‌شود. |
| `idealmakoo:requests` | ایجاد/ویرایش درخواست، پیام عمومی و صدور پیشنهاد؛ provider و workspace listener | بدون payload؛ reader باید `idealmakoo.requests.v1` را بخواند. |
| `idealmakoo:publications` | `store.publish`؛ صفحات عمومی و `usePublications` | بدون payload؛ reader index انتشار را می‌خواند. |
| `idealmakoo:site-preferences` | اعمال تنظیمات؛ `useSitePreferences` در Brand، navigation و footer | بدون payload؛ خواندن کلید تنظیمات اعمال‌شده. `idealmakoo:store` و `storage` نیز پشتیبانی می‌شوند. |
| `storage` | مرورگر در تب‌های دیگر همان origin | listenerها فقط کلیدهای مرتبط را بررسی می‌کنند. |

برای snapshot میزکار، رویداد مشترک کاملِ حل تعارض بین چند تب وجود ندارد. دادهٔ درخواست تازه، پیام عمومی تازه، انصراف مشتری و پاسخ پیشنهاد از پل محلی وارد می‌شوند؛ این پل، replication سروری، قفل تراکنشی یا همگام‌سازی دوطرفهٔ تمام فیلدها نیست. `audit` نیز آرایهٔ محلی و قابل ویرایش است و در برخی عملیات به ۳۰۰ رخداد محدود می‌شود.

در نسخهٔ سرور، ابتدا نتیجهٔ قطعی فرمان دریافت شود، سپس cache رابط به‌روزرسانی گردد. SSE، WebSocket یا polling نسخه‌دار می‌تواند جای eventهای محلی را در مرز repository بگیرد. برای انتشار و پیشنهاد حساس، چند `localStorage.setItem` فعلی باید به یک فرمان تراکنشی سرور تبدیل شوند.

## ۵. اتصال فعلی سایت ← درخواست ← CRM ← پورتال

`mergeWorkspaceRequests` از `requestId` برای جلوگیری از ورود دوبارهٔ همان درخواست استفاده می‌کند. مسیریابی موجود:

| نوع ورودی | collection میزکار |
| --- | --- |
| RFQ و inquiry فروش | `leads` |
| درخواست نمونه | `samples` |
| پشتیبانی، تیکت و کیفیت | `tickets`؛ کیفیت دارای اولویت بالا و برچسب مربوط است. |
| استخدام و بانک استعداد | `hr` |
| نمایندگی، تأمین‌کننده، برون‌سپاری و سرمایه‌گذاری | `partners` |
| موارد دیگر، از جمله تماس، رویداد، پژوهش عمومی و درخواست حریم خصوصی | `inbox` |

این تفکیک جلوی ساخت سرنخ فروش از رزومه یا ثبت‌نام رویداد را می‌گیرد. بک‌اند باید همین قاعده را با allowlist نوع درخواست و قید یکتای origin اجرا کند. یک regex محلی یا بررسی آرایه، تضمین idempotency در چند کارگر نیست.

تبدیل سرنخ در رابط، فرصت مرتبط می‌سازد و سرنخ را `converted` می‌کند؛ سازمان/مخاطب را در یک تراکنش چندجدولی ایجاد یا ادغام نمی‌کند. در سرور، `POST /crm/leads/{id}/convert` باید تبدیل یکتا، account/contact موجود یا جدید و فرصت را در تراکنش مدیریت کند. مالک فرصت، مسئول رسیدگی درخواست و عضو سازمان سه مفهوم جدا هستند.

پاسخ عمومی فعلی تنها از رکورد عملیاتی با شناسهٔ متناظر درخواست به آرایهٔ مشترک پیام‌ها افزوده می‌شود؛ یادداشت روی فرصت مرتبط، به‌طور خودکار پیام مشتری نیست. endpoint پیام باید `requestId` را صریح بگیرد و قصد انتشار عمومی را تأیید و مجوز آن را بررسی کند.

### فرم، ادغام و ورود CSV

`PublicFormSchema` شامل `id`، عنوان پنج‌زبانه، `version` و فیلدهای `{id,label,type,required,options?,condition?}` است. بلوک صفحه هنگام ذخیره/ارسال به بررسی، snapshot فرم انتخاب‌شده را می‌گیرد و انتشار همان نسخهٔ بازبینی‌شده را حفظ می‌کند. شرط فعلی «پر بودن فیلد قبلیِ قابل مشاهده» است؛ مقادیر پنهان، از جمله زنجیرهٔ شرط‌ها، از payload حذف می‌شوند. ایمیل، تاریخ واقعی، گزینهٔ select، required و طول ورودی بررسی می‌شوند؛ `name/email` هویت رزرو‌شده، اجباری و بدون شرط‌اند. select اجباری بدون گزینهٔ معتبر قابل انتشار نیست.

`CustomForm` با `kind: 'cms_form'`، `formId/formVersion/formValues`، consent و کلید idempotency ثابت به `createRequest` می‌فرستد و رسید می‌دهد. پل میزکار، درخواست را به inbox و پاسخ را یک‌بار با `response.id === request.id` به `WorkspaceForm.responses` اضافه می‌کند. تعریف فرم عمومی است؛ پاسخ‌ها وارد snapshot انتشار نمی‌شوند. در حالت API تنها ایجاد درخواست HTTP است؛ سرور باید نسخهٔ فرم، شروط، مجوز، رضایت و تکرار را مستقل بررسی کند.

برای accounts/contacts/leads، `CrmTools` دو رکورد را با انتخاب فیلد مقایسه/ادغام می‌کند. journal در `details.crmMergeOperations` و alias مبدأ در `details.crmMergeAlias` است. snapshots فیلدهای عملیاتی و شناسهٔ فعالیت‌های واردشده، بازگردانی را ممکن می‌کنند؛ unmerge به‌ترتیب آخرین ادغام، تغییرات و فعالیت‌های جدید را نگه می‌دارد. اطلاعات حساب ورود، رضایت و عضویت منتقل نمی‌شوند. این عملیات یک تغییر state محلی است؛ فرمان سرور باید نسخهٔ هر دو رکورد، alias، روابط و audit را تراکنشی مدیریت کند.

CSV wizard نگاشت ستون، preview، خطای ردیفی، تشخیص محصول معتبر و تکرار در فایل/رکوردهای فعلی دارد؛ سقف ۱ MB، ۵۰۰ ردیف و ۳۰ ستون است. واردکردن تنها وقتی تمام ردیف‌ها معتبرند در یک تغییر state انجام می‌شود و هنگام commit دوباره تکرار بررسی می‌شود. `details.importOrigin` و `details.importFingerprint` منشأ را نگه می‌دارند؛ fingerprint محلی شناسهٔ امنیتی نیست. resume، checkpoint و job انتقال سروری باید جدا ساخته شوند.

## ۶. انتشار محلی و ارتباط آن با منبع رسمی

شکل index مصرف‌شده توسط صفحات عمومی:

```ts
type LocalPublication = {
  id: string;
  slug: string;
  kind: string;
  locale: 'fa' | 'en' | 'tr' | 'ar' | 'ru';
  title: string;
  summary: string;
  body: string;
  blocks: {
    id: string;
    type: string;
    title: string;
    body: string;
    mediaUrl?: string;
    link?: string;
    formId?: string;
    formSchema?: PublicFormSchema;
    hidden?: boolean;
    options?: { productIds?: string[]; ctaLabel?: string; secondaryLabel?: string; secondaryLink?: string; visual?: 'scene' | 'image'; tone?: 'cyan' | 'violet' | 'neutral' };
  }[];
  publishedAt: string;
  version: number;
  eventStart?: string;
  eventEnd?: string;
  location?: string;
  productRelease?: ProductRelease;
  customProduct?: Product; // definition authored in the editor; never an official-source claim
};
```

نویسندهٔ محلی index را با کلید `kind + slug + locale` جایگزین می‌کند. ویرایشگر رکورد رویداد، شروع، پایان و مکان را دریافت، ترتیب زمانی را بررسی و این فیلدها را در انتشار حفظ می‌کند؛ در نتیجه خروجی ICS و فرم درخواست رویداد در جزئیات عمومی به دادهٔ منتشرشده متصل‌اند.

برای محصول، `kind: 'product'` و شناسه/slug همان محصول catalog استفاده می‌شود؛ reader مقدار `products` را هم می‌پذیرد. برای پژوهش، `research` و نام‌های `article/articles` پذیرفته می‌شوند. reader فقط انتشار همان locale با شناسه یا slug منطبق را انتخاب می‌کند و جدیدترین زمان/نسخه را ملاک قرار می‌دهد.

**اثر واقعی انتشار محصول/پژوهش:** انتشار متنِ محصول، عنوان و خلاصهٔ همان زبان را در کارت/فهرست/مقایسه تغییر می‌دهد. وقتی `productRelease` معتبر دارد، جنس، مشخصات، تصویر/گالری، دانلود، خانواده، برند و متن فنی نیز از نسخهٔ بازبینی‌شده به نمایش واقعی محصول منتقل می‌شوند؛ اطلاعات منبع رسمی جدا نگه داشته می‌شود. انتشار محلی یا SKU تألیف‌شده به‌تنهایی تأیید کارخانه، موجودی یا قابلیت فروش نیست. پژوهش همچنان بدنهٔ فارسی مرجع را نگه می‌دارد و عنوان/چکیدهٔ تحریریه با برچسب محلی مشخص می‌شوند.

افزودن محصول دستی در `ProductEditor` تعریف `CustomProduct` با `origin: editor` و شناسهٔ محدود `custom-*` می‌سازد. `workspaceProducts` آن را در editor و انتخابگرها در دسترس قرار می‌دهد؛ تا انتشار معتبرِ دارای تعریف منطبق و `productRelease` مصوب وارد کاتالوگ عمومی نمی‌شود. `productPath` برای چنین محصولی مسیر ثابت `products/detail/?id=` می‌سازد؛ ۱۷ محصول منبع در آرایهٔ رسمی تغییر نمی‌کنند. تعریف محصول در `details.customProduct` و draft/review در `details.productDraft/productReviewDraft` نگهداری می‌شوند. در بک‌اند این سه نقش باید به entity، revision و release مستقل با مجوز و قید یکتای شناسه تبدیل شوند.

صفحات دلخواه از `/{locale}/page/?id={id}` و فهرست `/{locale}/published/` قابل مشاهده‌اند؛ `PublicationRenderer` همهٔ ۲۸ نوع بلوک را رسم می‌کند. فهرست دقیق صفحات قابل جایگزینی در `editablePublicTargets`، فایل `src/lib/site-content.ts` است. فقط انتشار `page` با زبان و slug دقیق و حالت `replace` جای صفحهٔ تحریریه را می‌گیرد؛ فرم‌ها، حساب/ورود، ابزار و صفحهٔ تخصصی محصول آزادانه جایگزین نمی‌شوند.

خانه قرارداد تخصصی دارد: `home-hero`, `home-families`, `home-products`, `home-story`, `home-innovation`, `home-audiences`, `home-research`, `home-catalogs`, `home-news`, `home-resources`, `home-cta`. editor و Home هر دو `createHomeBlocks/upgradeHomeBlocks` را مصرف می‌کنند. انتشار، ترتیب و `hidden` بخش‌ها و متن/تصویر/CTA/رنگ/محصول را کنترل می‌کند؛ هیروی اصلی و Rubik با `visual: scene` حفظ می‌شوند. انتخاب تصویر به‌جای صحنه باید صریح باشد. متن خالی و `productIds: []` در انتشار، خالی باقی می‌مانند. خانهٔ قدیمی با بلوک‌های عمومی به ساختار تخصصی ارتقا می‌یابد و بلوک اضافهٔ نویسنده حفظ می‌شود. `parseBlockOptions` فقط فیلدهای مجاز، enum واقعی، مسیر/URL معتبر و شناسهٔ محصول رسمی یا الگوی محدود محصول افزوده را می‌پذیرد؛ محصول افزوده فقط با release معتبر عمومی دیده می‌شود.

مرکز کنترل برای صفحاتی که منبع آماده دارند متن مرجع می‌سازد؛ برای هدف تحریریهٔ تازه لازم است نویسنده محتوا را تکمیل کند. عنوان/خلاصهٔ خالی یا صفحهٔ فاقد محتوای مرئی اجازهٔ انتشار نمی‌گیرند. فهرست خبر/رویداد/استخدام از publication نوع مربوط استفاده می‌کند؛ جزئیات از مسیر ثابت `detail` و query قابل دسترسی است. ساخت slug دلخواه در مرورگر فایل تازهٔ build نمی‌سازد.

در اتصال سرور، release واقعی باید منبع دادهٔ SSR/SSG یا loader محتوا شود. تغییر محلی در مرورگر، فایل‌های HTML، sitemap، canonical، `hreflang` و JSON-LD ساخته‌شده را به‌روزرسانی نمی‌کند. بازسازی استاتیک یا تغییر راهبرد رندر و invalidation صریح لازم است. وضعیت «منتشرشده» فعلی فقط در همان مرورگر و origin دیده می‌شود؛ سایت رسمی کارخانه از این عملیات تغییر نمی‌کند.

تنظیمات `SitePreferences` نیز مسیر مستقل draft/apply دارد: برند `{name,tagline,logo}`، تماس `{address,phone,email}` و آرایه‌های `navigation/footer` از گروه‌های `{id,label,visible,items}`؛ هر لینک `{id,label,path,visible}` دارد و متن‌ها پنج‌زبانه‌اند. apply، Brand و منوهای دسکتاپ/موبایل و فوتر را واقعاً به‌روزرسانی می‌کند. مسیرها به صفحات عمومی معتبر محدودند؛ رابط menus اجازهٔ تغییر برند/تماس را ندارد. نشان را می‌توان با PNG/JPEG/WebP تا ۵۱۲ کیلوبایت یا مسیر رسانهٔ محلی تغییر داد؛ `normalizeLogoSource` محتوای فعال و URL دور را رد می‌کند. تغییر تنظیمات برند، متن تمام صفحات یا metadata استاتیک را بازنویسی نمی‌کند و به API نسخه‌دار مستقل نیاز دارد.

## ۷. قرارداد HTTP موجود و قرارداد پیشنهادی

### ۷.۱. قرارداد قابل فراخوانیِ فعلی

`HttpClient` آدرس پایه را به path اضافه می‌کند، `credentials: 'include'` و هدر JSON می‌فرستد، پاسخ غیرموفق را به `ApiError` تبدیل می‌کند و برای `204` مقدار `undefined` برمی‌گرداند. timeout، retry، refresh session، CSRF token، schema runtime یا pagination عمومی به‌صورت کامل پیاده‌سازی نشده است.

| متد/مسیر نسبت به base URL | درخواست | پاسخ مورد انتظار فعلی |
| --- | --- | --- |
| `GET /requests` | بدون body | `FrontRequest[]`؛ فعلاً در provider متصل نیست. |
| `POST /requests` | JSON از `Omit<FrontRequest, 'id' \| 'createdAt'>` و `Idempotency-Key` | یک `FrontRequest` کامل. تنها عملیات HTTP متصل به UI. |
| `PATCH /requests/{id}` | `Partial<FrontRequest>` و `If-Match: {expectedVersion}` | `FrontRequest` به‌روز؛ فعلاً در provider متصل نیست. |

پاسخ ایجاد باید `id`، `createdAt`، وضعیت معتبر، `ownerId`، `locale`، `version` و `idempotencyKey` مناسب را برگرداند. شاخهٔ API در provider این مقادیر را مانند شاخهٔ local اضافه نمی‌کند. پیش از اتصال کامل، enrich کردن locale و تبدیل پاسخ دامنه به DTO باید در adapter انجام شود. سرور مالکیت یا مجوز را از body قبول نکند.

نوع `PageResult<T> = {items,total,page,pageSize}` در فایل API تعریف شده اما `RequestRepository.list` همچنان آرایه برمی‌گرداند. اگر سرور pagination دارد، امضای repository و مصرف‌کنندگان با هم باید تغییر کنند.

### ۷.۲. endpointهای پیشنهادی برای تکمیل

**تمام مسیرهای جدول زیر طراحی پیشنهادی برای بک‌اند آینده‌اند؛ وجود route handler یا سرویس فعال از این جدول نتیجه نمی‌شود.** پیشوند همه `/api/v1` است.

| حوزه | endpointهای پیشنهادی | قرارداد/قواعد اصلی |
| --- | --- | --- |
| هویت | `POST /auth/login`, `/auth/register`, `/auth/recover`, `/auth/mfa/verify`, `/auth/logout`؛ `GET /me`, `/me/sessions` | session مبتنی بر cookie امن، customer ثابت در ثبت‌نام عمومی، challenge واقعی MFA، token بازیابی یک‌بارمصرف. |
| پروفایل و سازمان | `GET/PATCH /me/profile`؛ `GET/POST /me/organizations`؛ `/organizations/{id}/memberships` | عضویت و sharing مستقل، دعوت محدود و لغو فوری دسترسی. |
| کاتالوگ | `GET /products`, `/products/{id}`, `/resources`, `/research` | DTO فقط از release منتشرشدهٔ locale؛ فیلتر خانواده و گونهٔ معتبر. |
| CMS | `/documents`, `/documents/{id}/revisions`, `/revisions/{id}/submit`, `/revisions/{id}/review` | snapshot تایپ‌شده و نسخه‌دار؛ بررسی نویسنده/بازبین و دامنهٔ زبان. |
| برند و ناوبری | `GET /site-preferences`؛ `/site-preferences/drafts`؛ `POST /site-preferences/publish` | schema چندزبانهٔ گروه/لینک، مسیر مجاز، مجوز مستقل منو/برند، نسخه و بازسازی cache/metadata در صورت نیاز. |
| انتشار | `POST /documents/{id}/locales/{locale}/publish`، `/schedule`، `/rollback`؛ `GET /releases` | `revisionId + expectedVersion`، release اتمی و outbox. |
| درخواست‌ها | `/requests`, `/requests/{id}`, `/requests/{id}/messages`, `/requests/{id}/claim`, `/requests/{id}/withdraw` | DTO مشتری مجزا از DTO اپراتور؛ مالکیت، SLA، idempotency و قفل خوش‌بینانه. |
| CRM اصلی | `/crm/accounts`, `/contacts`, `/leads`, `/opportunities`, `/activities`, `/tasks` | روابط نوع‌دار، فیلتر مجوز پیش از جستجو/شمارش/خروجی و `expectedVersion`. |
| فرمان‌های CRM | `/crm/leads/{id}/convert`؛ `/crm/merges`؛ `/crm/merges/{id}/unmerge` | تراکنش، origin یکتا، alias و audit؛ حذف یا ادغام حساب ورود ممنوع. |
| پیشنهاد و قیمت | `/crm/pricebooks`, `/crm/quotes`, `/crm/quotes/{id}/revisions`, `/approve`, `/issue`؛ `/quote-revisions/{id}/respond` | Decimal سروری، یک ارز در هر نسخه، snapshotHash معتبر، عدم خودتأییدی، تاریخ اعتبار، PDF خصوصی. |
| نمونه/تحویل/کیفیت | `/crm/samples`, `/crm/handoffs`, `/crm/cases`, `/crm/cases/{id}/escalate` | مراحل مستقل، مستندات حامل/ERP، SLA و qualityScope با مجوز محدود. |
| CRM پیشرفته | `/crm/partners`, `/segments`, `/campaigns`, `/inbox`, `/automations`, `/customer-success`, `/reports`, `/transfers` | به‌ترتیب قلمرو، شرط درختی، رضایت ارسال، تکرارزدایی ورودی، dry-run/stop، شاخص شفاف، گزارش چندارزی و job ورود داده. |
| فرم و رویداد | `/forms/{id}/versions`, `/forms/{id}/submissions`, `/events/{id}/registrations` | نسخهٔ فرم و consent، محدودیت حجم، ظرفیت و لیست انتظار تراکنشی. |
| فایل | `POST /uploads`, `/uploads/{id}/complete`؛ `GET /assets/{id}`, `/assets/{id}/download`؛ `/assets/{id}/usages` | جداسازی عمومی/خصوصی، قرنطینه، اسکن، مجوز مصرف و لینک امضاشده. |
| اعلان | `/me/notifications`, `/me/notification-preferences`, `/communications/templates`, `/notification-deliveries` | inbox واقعی، topic/channel/frequency/quiet hours، outbox و گزارش تحویل. |
| AI و جستجوی مستند | `/ai/jobs`, `/ai/jobs/{id}`, `/ai/jobs/{id}/cancel`, `/chat` | کارگر، بودجه، منابع منتشرشده، ارزیابی و پاسخ مستند. |
| پایش/ممیزی | `/monitoring/{section}`, `/audit`, `/incidents`, `/recovery/drills` | metric واقعی با بازهٔ زمان و منبع، audit append-only، مجوز مستقل. |
| حریم خصوصی | `/me/privacy-requests`, `/privacy-requests/{id}` | دریافت داده/حذف، نگهداری قانونی، job قابل پیگیری و tombstone. |

### ۷.۳. نسخه، idempotency و خطا

کلید idempotency برای یک اقدام منطقی ثابت بماند. سرور باید scope آن را با هویت/نوع فرمان و hash ورودی ثبت کند، درخواست تکراری همسان را با همان نتیجه پاسخ دهد و استفادهٔ همان کلید برای body متفاوت را خطا کند. retry خودکار فرمان غیرidempotent نباید ایجاد شود.

به‌روزرسانی‌ها با نسخهٔ شناخته‌شدهٔ آخر ارسال شوند. قرارداد فعلی header `If-Match` را رشتهٔ شمارهٔ نسخه می‌فرستد؛ اگر ETag استاندارد انتخاب شود، قالب header و repository باید همزمان اصلاح شوند. شکست نسخه باید باعث نمایش گزینهٔ بازخوانی/مقایسه شود، نه بازنویسی بی‌صدای تغییرات شخص دیگر.

نوع `Rfc9457ProblemDetails` در پروژه این فیلدها را دارد:

```json
{
  "type": "https://api.example.invalid/problems/version-conflict",
  "title": "Version conflict",
  "status": 409,
  "detail": "The record changed after it was loaded.",
  "instance": "/api/v1/requests/IM-REQ-example",
  "code": "VERSION_CONFLICT",
  "requestId": "trace-example",
  "errors": [
    { "path": "expectedVersion", "code": "STALE_VERSION", "message": "Reload the record." }
  ]
}
```

این نمونه، نشانی سرویس موجود نیست. پاسخ خطا با `application/problem+json` مناسب است. کدهای پایدار مانند `VALIDATION_ERROR`، `UNAUTHENTICATED`، `FORBIDDEN`، `VERSION_CONFLICT`، `IDEMPOTENCY_CONFLICT`، `ASSET_NOT_READY`، `QUOTA_EXCEEDED` و `PROVIDER_UNAVAILABLE` از متن ترجمه‌شده جدا بمانند. HTTPهای `401/403/404/409/422/429/503` متناسب با وضعیت برگردند؛ جزئیات خصوصی در خطا فاش نشود. fallback فعلی `ApiError` ممکن است همهٔ فیلدهای type را نداشته باشد؛ adapter باید خطا را قبل از نمایش normalize کند.

## ۸. RBAC و هویت؛ چه چیزی اکنون اجرا می‌شود؟

۱۲ کلید نقش دقیقاً عبارت‌اند از:

```text
customer, superAdmin, admin, contentEditor, productManager,
scientificReviewer, translator, publisher, hr, business, analyst, support
```

`authorize`, `canonicalWorkspaceSection` و `canWorkspace` در `src/lib/auth.ts` یک سیاست مشترک دارند. شناسهٔ نقش نامعتبر و زیرمسیر ناشناخته fail-closed هستند؛ alias مجاز نمی‌تواند زیرمسیر دلخواه را مجاز کند. `Workspace` بر اساس `session.id:role` remount می‌شود؛ `setRole` فقط برای superAdmin فعال است و صفحهٔ ممنوع، انتخابگر ارتقای نقش ندارد. همهٔ کارکنان در `/{locale}/admin/` پیشخوان مختص نقش خود را می‌بینند؛ مقصد اقدام اصلی در جدول زیر است. customer به `/{locale}/account/` می‌رود.

| نقش | کار اصلی و مقصد | محدودیت عملی رابط |
| --- | --- | --- |
| `superAdmin` | نظارت کل، `/admin/content` | همهٔ بخش‌ها و بازیابی snapshot؛ تنها دارندهٔ سوییچر دمو. سیاست نقش در کد تعریف شده است، نه editor قابل تغییر production. |
| `admin` | مدیریت سایت/عملیات، `/admin/content` | دسترسی مدیریتی و کارکنان؛ ماتریس نقش را می‌بیند اما حق تغییر سیاست نقش ندارد. |
| `contentEditor` | بخش‌های سایت/صفحه/خبر/رسانه/فرم، `/admin/content` | ساخت/ویرایش و ارسال به بازبینی؛ محصول فقط خواندنی، حق تأیید و انتشار محتوای خودش ندارد. منو را جداگانه می‌تواند اعمال کند. |
| `productManager` | اطلاعات فنی و منابع، `/admin/products` | ویرایش محصول/رسانه/اسناد و ارسال؛ صفحهٔ عمومی، تأیید مستقل و انتشار در اختیارش نیست. |
| `scientificReviewer` | بررسی علمی، `/admin/reviews` | بازبینی محصول/پژوهش/منابع/صفحات؛ ویرایش مشخصات، تصویب مالی، انتشار یا پاسخ عمومی ندارد. فقط کیفیت محدود و یادداشت داخلی را می‌بیند. |
| `translator` | ترجمهٔ رکورد و صفحه، `/admin/translations` | چهار زبان en/tr/ar/ru؛ فارسی منبع خواندنی. ساختار، URL، تصویر، ترتیب و محصولات انتخابی قابل تغییر نیستند. |
| `publisher` | بررسی/انتشار نسخهٔ مصوب، `/admin/publications` | متن را ویرایش نمی‌کند؛ نسخهٔ تأییدشده را منتشر/زمان‌بندی می‌کند. خبر/صفحه را می‌تواند مستقل بررسی کند؛ applicants منابع انسانی پنهان‌اند. |
| `hr` | پرونده و آگهی استخدام، `/admin/hr` | استخدام و پاسخ مرتبط؛ دسترسی CRM، کیفیت و تنظیمات ندارد. applicant قابل انتشار به‌جای آگهی نیست. |
| `business` | RFQ و فروش، `/admin/crm/leads` | CRM، ادغام/بازگردانی، CSV، quote/pricebook و پاسخ؛ تصویب پیشنهاد توسط خودش، اطلاعات کیفیت/استخدام و CMS در اختیارش نیست. |
| `analyst` | گزارش تجمیعی، `/admin/crm/reports` | فقط شمارش و توزیع، خروجی تجمیعی و پایش مجاز؛ نام، تماس، پروندهٔ خام و پایش امنیت/زیرساخت پنهان‌اند. |
| `support` | رسیدگی تیکت و inbox، `/admin/crm/cases` | پاسخ/یادداشت و مراحل خدمات؛ فعالیت support و مشاهدهٔ محدود نمونه؛ قیمت، فروش، استخدام و CMS پنهان‌اند. |
| `customer` | پیگیری شخصی، `/account` | درخواست خودش، پیام عمومی، انصرافِ درخواست باز و پاسخ به quote صادرشدهٔ معتبر؛ دسترسی admin یا ارتقای نقش ندارد. |

`workspace/permissions.ts` داده را پیش از رندر، جستجو یا خروجی با `projectWorkspaceState` محدود می‌کند. درخواست استخدام و پروندهٔ کیفیت بیرون از نقش مجاز پنهان‌اند؛ reviewer فیلدهای هویتی کیفیت را دریافت نمی‌کند. `workspaceInsights` برای analyst فقط شمارش برمی‌گرداند. `applyWorkspaceMutation` فرمان چندرکوردی را یکجا اعتبارسنجی می‌کند و رکوردهای پنهان را حفظ می‌کند؛ حدس‌زدن id مخفی، تغییر collection، تخریب تاریخچه و تغییر وضعیت محافظت‌شده فرمان را رد می‌کنند. بازیابی کل snapshot مسیر صریح `restoreSnapshot` با مجوز مدیریتی و validator قالب دارد.

در بازبینی، `authorId/approvedById` و شناسهٔ حساب فعلی مبنا هستند؛ draft قدیمیِ فاقد userId به مقایسهٔ نقش برمی‌گردد. ویرایش محتوا تصویب قبلی را پاک می‌کند. انتشار باید با نوع، زبان، عنوان، خلاصه و snapshot تأییدشدهٔ منبع منطبق باشد؛ custom product هم باید همان تعریف ثبت‌شده و release بازبینی‌شده را حمل کند. `matchesWorkspaceSession` جلوی فرمان دیررس حساب/نقش قبلی را می‌گیرد. پورتال عمومی نیز فرمان را دوباره بر اساس مالکیت و action بررسی می‌کند؛ به‌روزرسانی مبلغ/مالک/یادداشت داخلی از آن مسیر پذیرفته نمی‌شود.

این قواعد سمت کاربر هستند. session، نقش، آرایهٔ درخواست‌ها و scope فعلی در مرورگر قابل دستکاری‌اند. digest محلی رمز با PBKDF2 و مرحلهٔ MFA دمو به معنی احراز هویت واقعی، TOTP سروری یا حفاظت اطلاعات چندکاربره نیست. کدهای بازیابی نیز محلی‌اند.

در بک‌اند باید علاوه بر نقش، عملیات، رکورد، فیلد، تیم، زبان، سازمان و دامنهٔ کیفیت بررسی شوند. نقش مستقلی با نام `qualityManager` در union این پروژه وجود ندارد؛ scope کیفیت باید با ترکیب نقش‌های تعریف‌شده و مجوز صریح مدل شود. قواعد سخت‌گیرانه باید روی export، فایل، گزارش، جستجو و خلاصهٔ AI هم اجرا شوند. حساب‌ها/نقش‌های دمو نباید به هویت production تبدیل یا در production فعال بمانند.

## ۹. آداپتورهای ضروری سمت سرور

### فایل و اسناد

`storeAttachment` و `getAttachment` باید با upload/download مجاز جایگزین شوند. در حالت API فعلی، شناسهٔ IndexedDB یک فایل واقعی سرور نیست؛ ارسال این شناسه در درخواست بدون انتقال فایل، پیوست را برای کارخانه قابل دسترس نمی‌کند. چرخهٔ پیشنهادی `uploading → quarantined → scanning → processing → ready`، نوع MIME واقعی، محدودیت حجم، checksum، حقوق استفاده، سهمیه و expiry را نگه دارد. رزومه، کیفیت و پیشنهاد مالی در bucket عمومی قرار نگیرند. حذف رسانهٔ درحال‌مصرف در سرور نیز باید مسدود باشد.

### نصب و cache عمومی

`public/manifests/{fa,en,tr,ar,ru}.webmanifest` و مسیر `/{locale}/install` موجودند. Service Worker فعلی فقط GET همان origin برای تصویرهای `/media/official/` و فونت‌های `/fonts/` را بررسی می‌کند؛ query، URL نامعتبر و درخواست دارای Authorization/Range کنار گذاشته می‌شوند. پاسخ موفقِ غیرopaque و غیرredirect فقط با `X-Public-Cache: 1` و بدون `Cache-Control: private/no-store` cache می‌شود. سیاست network-first است؛ در قطع شبکه فقط asset تأییدشدهٔ قبلی قابل برگشت است.

`scripts/serve.mjs` برای همین دارایی‌های عمومی header لازم را می‌گذارد؛ میزبان دیگر باید آن را صریحاً تنظیم کند، وگرنه cache عمداً انجام نمی‌شود. صفحات HTML، بسته‌های برنامه، API، admin/account/auth و فایل خصوصی cache نمی‌شوند. این پیاده‌سازی برنامهٔ کامل آفلاین نیست و آزمون نصب/ارتقا روی دستگاه‌های واقعی هنوز لازم است.

### اعلان و یکپارچه‌سازی

ارسال ایمیل، پیامک، تلگرام و push اکنون انجام نمی‌شود. آداپتورهای SMTP/Postfix، کاوه‌نگار، Telegram و نجوا باید سمت سرور با حالت sandbox صریح، secret سروری، outbox تراکنشی، deduplication، retry محدود، دفتر delivery و DLQ پیاده شوند. پاسخ پذیرش provider با تحویل قطعی یکسان نیست. رضایت، مقصد تأییدشده، suppression و ساعات سکوت در زمان تحویل دوباره بررسی شوند. اعلان داخلی موجود از تاریخچه/درخواست محلی مشتق می‌شود و صف اعلان چندکاناله نیست.

### AI و RAG

استودیو فعلی در هفت حالت متن، تصویر، ویدیو، صدا، ترجمه، بازنویسی و سند **brief/قالب محلی قابل ویرایش** می‌سازد. خروجی بصری نمایش‌داده‌شده از تصویر رسمی محصول است؛ تصویر یا ویدیو تازه‌ای با مدل تولید نمی‌شود. دستیار عمومی هم جستجوی کلیدواژه در محصول/پژوهش با لینک منبع دارد؛ RAG برداری یا LLM نیست.

اتصال آینده نیازمند gateway سروری با jobهای نسخه‌دار، پروفایل مدل، timeout/cancel، ledger رزرو و مصرف بودجه، status قابل پیگیری، moderation مرتبط با دامنه و نگهداری provenance است. webhook تولید ویدیو باید امضای provider، timestamp و replay را بررسی کند. نمایهٔ RAG فقط محتوای منتشرشده و مجاز را وارد کند؛ پاسخ بدون شاهد باید نامعلوم اعلام شود. `crm_assist` فقط پیشنهاد ارائه دهد و بدون فرمان مجاز مستقل قیمت، مرحله، مالکیت یا پروندهٔ کیفیت را تغییر ندهد.

### پایش و کارگرها

۱۲ نمای پایش فعلی تعدادهای محلی، اندازهٔ تقریبی snapshot و وضعیت قطع سرویس‌ها را نشان می‌دهند. دریافت دستی مدت بارگذاری صفحه، صدک عملکرد سرور یا telemetry واقعی زیرساخت نیست. probe، Web Vitals، queue، lease، outbox، خطاهای provider، مصرف storage و restore drill باید منبع دادهٔ مستقل داشته باشند و با زمان اندازه‌گیری نمایش داده شوند.

## ۱۰. نقاط جایگزینی و ترتیب پیشنهادی اتصال

| اولویت | جایگزینی لازم | معیار پذیرش |
| --- | --- | --- |
| ۱ | هویت واقعی و adapter `FrontRequest ↔ UnifiedRequestRecord` | هویت از session سرور، عدم قبول role/owner از body و تست دسترسی دو حساب مستقل. |
| ۲ | `AppProvider` خواندن/ایجاد/ویرایش و پیام/پیشنهاد | تمام مسیرهای request از repository بگذرند؛ reload و مرورگر دوم همان دادهٔ مجاز را دریافت کنند. |
| ۳ | `attachments.ts` و لینک‌های دانلود | فایل واقعی با مجوز، scan و download قابل پیگیری؛ هیچ شناسهٔ صرفاً محلی به سرور تحمیل نشود. |
| ۴ | `useWorkspaceStore`، editorهای محصول/فرم و نوشتن‌های مستقیم در `Records.tsx` و `CMS.tsx` | CRUD و فرمان‌ها با نسخه و خطای قابل بازیابی؛ schema و snapshot مصوب سروری؛ storage تنها cache غیرمرجع باشد. |
| ۵ | `usePublications`، `useSitePreferences` و loaderهای catalog | انتشار مستقل زبان/تنظیمات، preview امن، بازسازی metadata/مسیر و حفظ منبع رسمی کنار محتوای تحریریه. |
| ۶ | آداپتور سروری CRM تخصصی و پیش‌فاکتور | جایگزینی merge/unmerge و CSV محلی با فرمان تراکنشی؛ محاسبهٔ مرجع Decimal، تصویب کاربر متفاوت، PDF خصوصی و پاسخ روی نسخهٔ معتبر. |
| ۷ | workerهای publication، SLA، اعلان، AI و رسانه | idempotency، retry و audit سروری؛ وضعیت قطع/خطا در UI قابل مشاهده باشد. |
| ۸ | پورتال سازمانی، حریم خصوصی و پایش | لغو عضویت فوری، sharing صریح، بازیابی دادهٔ محدود، metric واقعی و restore آزموده. |

تنظیمات visual مانند تم و وضعیت سایدبار می‌توانند محلی بمانند. هویت، مجوز، درخواست سازمانی، نسخهٔ مصوب و سابقهٔ مالی باید از سرور خوانده شوند. دادهٔ شخصی localStorage دمو نباید بدون انتخاب و مجوز مالک، خودکار به محیط عملیاتی وارد شود.

این سند شامل دستور نصب PostgreSQL، Docker، Ubuntu یا اجرای worker نیست؛ چنین پشتهٔ بک‌اندی در تحویل فرانت‌اند وجود ندارد. مسیرهای پیشنهادی باید ابتدا پیاده‌سازی و آزموده شوند، سپس adapterهای فوق متصل و متن وضعیت local/API رابط بازبینی شود. نقشهٔ وضعیت ماژول‌ها و شکاف‌های تخصصی رابط در [COVERAGE.md](./COVERAGE.md) آمده است.


### قرارداد گونه و موجودی چندزبانه در استعلام

`InquiryLine` علاوه بر `productId`, `quantity`, `shade`, `mould`, `note`، فیلدهای اختیاری `variantId`, `sku`, `unit` را حفظ می‌کند. انتخاب گونه در صفحهٔ محصول فقط شناسه را به فرمان می‌دهد؛ فرمان، SKU و واحد را از release معتبر همان زبان استخراج می‌کند. ادغام ردیف‌ها بر اساس محصول، شید، قالب، شناسهٔ گونه، SKU و واحد انجام می‌شود؛ دو SKU متفاوت با قالب یکسان یکی نمی‌شوند. `getPublishedProductInventory` محصول‌های منتشرشدهٔ همهٔ زبان‌ها را برای اعتبارسنجی ردیف‌های ذخیره‌شده فراهم می‌کند؛ انتخاب جدید از کاتالوگ زبان جاری انجام می‌شود.

برای محصول دستی، `ProductEntity.legacyId` برابر `null` است. شناسهٔ پایگاه قدیمی برای آن ساخته نمی‌شود. در سرور، درخواست باید به شناسهٔ گونه و release مشخص متصل شود و مشخصات تجاری را دوباره از منبع معتبر بخواند. SKU، واحد، مقدار، مالکیت و قیمت ارسالی مرورگر مرجع معتبر سرور نیستند.
