# مرجع API پیاده‌سازی‌شده — نسخهٔ ۲٫۰٫۰

این سند قرارداد مسیرهای موجود در `src/server/router.ts` و سرویس‌های همان پوشه را توضیح می‌دهد. تاریخ بازبینی: ۲۰۲۶-۱۰-۱۹. پیشوند اصلی تمام مسیرهای جدول‌ها **`/api/v1`** است. این سند مرجع انسانی کد فعلی است؛ فایل OpenAPI تولیدشده یا گواهی اعتبارسنجی ماشینی OpenAPI محسوب نمی‌شود. نیازمندی‌های تاریخی در `BACKEND-CONTRACT.md` ممکن است نام مسیر پیشنهادی متفاوتی داشته باشند؛ برای اتصال فرانت‌اند، مسیرهای این سند ملاک هستند.

## ۱. قرارداد مشترک HTTP

داده‌های عادی با JSON مبادله می‌شوند؛ درخواست JSON باید `Content-Type: application/json` داشته باشد. بارگذاری فایل، `multipart/form-data` و دریافت فایل/PDF پاسخ باینری دارند. پاسخ موفق معمولاً `200`، ایجاد رکورد `201` و پذیرش کار صف `202` است؛ `202` به معنی انجام ارسال خارجی نیست. handler اسلش انتهایی مسیر API را می‌پذیرد؛ API برای canonical کردن نشانی به redirect متکی نیست. قاعدهٔ اسلش صفحات عمومی و redirectهای قدیمی سایت را به مسیرهای API یا فایل تعمیم ندهید.

API بر session سمت سرور و کوکی متکی است. کلیدهای AI، رمز SMTP و اطلاعات اتصال پایگاه داده هیچ‌کدام credential ورود به API نیستند. قرارداد Bearer token، OAuth، CORS عمومی و اجرای cross-origin برای این نسخه تعریف نشده است. مجوز و مالکیت در سرویس سرور دوباره بررسی می‌شوند و نقش ارسالی از مرورگر معتبر نیست.

### session و CSRF

ابتدا `GET /auth/session` را با حفظ کوکی‌ها اجرا کنید. پاسخ `{user, csrfToken}` است؛ در حالت مهمان `user: null` و کوکی امضاشدهٔ `im_guest_csrf` ایجاد می‌شود. کوکی HttpOnly است و CSRF token از **بدنهٔ JSON** خوانده می‌شود. پس از ورود، ثبت‌نام یا تکمیل MFA، `csrfToken` پاسخ جدید جایگزین مقدار قبلی شود.

درخواست‌های عادی تغییردهندهٔ داده، از جمله ورود، ثبت‌نام، فرم عمومی و آپلود مهمان، این موارد را لازم دارند:

- کوکی همان نشست یا کوکی مهمان ایجادشده در bootstrap؛ در مرورگر `credentials: 'same-origin'` مناسب است.
- هدر `X-CSRF-Token` با مقدار پاسخ session.
- هدر `Origin` دقیقاً برابر `SITE_URL` شامل scheme و port در صورت وجود؛ مرورگر آن را خودکار می‌فرستد. `Sec-Fetch-Site: cross-site` رد می‌شود.

مسیرهای capability و webhook که در بخش‌های بعد آمده‌اند پیش از session bootstrap اجرا می‌شوند و کنترل مخصوص خود را دارند: HMAC اتصال ورودی/OpenRouter، secret هدر Telegram، یا توکن محدود به همان مقصد و CSRF وابسته به آن. این استثنا مجوز حذف CSRF از فرم‌های عادی نیست. برای survey و لینک ترجیح ارتباطات، از transport بدون کوکی استفاده کنید؛ ابتدا همان capability را بخوانید، نه `/auth/session`. توکن و بدنهٔ خصوصی نباید در لاگ، analytics یا storage مرورگر ذخیره شوند.

کوکی‌ها `HttpOnly; SameSite=Lax; Path=/` هستند و با `SITE_URL=https://…` ویژگی `Secure` دارند. کوکی مهمان ۳۰ روز عمر دارد؛ پاک‌کردن آن دسترسی مهمان به درخواست‌های قبلی را از بین می‌برد. نشست ورود علاوه بر انقضای مطلق، محدودیت بیکاری و ابطال سمت سرور دارد. API هیچ راهی برای خواندن درخواست مهمان تنها با دانستن شناسه ارائه نمی‌کند.

نمونهٔ کوچک مرورگر؛ `body` باید طبق قرارداد همان مسیر تهیه شود:

```ts
let { csrfToken } = await fetch('/api/v1/auth/session/', {
  credentials: 'same-origin',
}).then(response => response.json());

const response = await fetch('/api/v1/me/profile/', {
  method: 'PATCH',
  credentials: 'same-origin',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrfToken,
    'If-Match': String(settings.revision),
  },
  body: JSON.stringify({ name: 'نام جدید' }),
});
```

### نسخه، رقابت و idempotency

| عملیات | کنترل رقابت |
|---|---|
| `PATCH /me/profile` و `/me/preferences` | هدر `If-Match` با `revision` آخرین `/me/settings` |
| `PATCH /me/collection` برای inquiries/compare | `collectionVersion` در بدنه از GET جدید؛ برای saved نیز `savedVersion,savedLocale` لازم است |
| `PATCH /requests/:id` | هدر `If-Match` با `version` همان درخواست |
| `PATCH` و `DELETE /me/organizations/:id` | هدر `If-Match` با `version` همان سازمان |
| تغییر workspace، انتشار، بازگردانی، بازبینی، زمان‌بندی و site-preferences | `expectedVersion` در **بدنه** با نسخهٔ سراسری workspace |
| ترجیحات اعلان `/me/notification-preferences` | `expectedVersion` بدنه با نسخهٔ مستقل ترجیحات |
| `PATCH/DELETE /me/communication-channels/:id` | `If-Match` با نسخهٔ همان اتصال مقصد |
| لغو دعوت کارکنان؛ فرمان‌های فراخوان/پیشنهاد مناقصه؛ گواهی شرکت | نسخهٔ همان موجودیت در `expectedVersion` بدنه؛ نسخهٔ workspace نیست |
| اتصال سازمان پرتال به CRM | سه نسخهٔ سازمان، پروفایل account و record؛ قرارداد بخش ۱۴ |
| تحویل کار و خروج کارمند | `expectedWorkspaceVersion` و `planHash` دقیق پیش‌نمایش؛ قرارداد بخش ۱۳ |
| `POST /requests` | هدر اجباری `Idempotency-Key`، طول ۸ تا ۱۲۸ و حروف/اعداد/`_ . : -` |
| ثبت/جایگزینی پاکت‌های مناقصه | `Idempotency-Key`؛ جایگزینی علاوه بر آن نسخهٔ پیشنهاد را لازم دارد |
| `POST /me/collection/merge` | شناسهٔ UUID پایدار `id` در بدنه، مقید به حساب و محتوای همان merge |
| `POST /automations/run` | `idempotencyKey` در بدنه، طول ۱۶ تا ۱۲۸ و حروف/اعداد/`_ -` |

`If-Match: 7` و `If-Match: "7"` پذیرفته می‌شوند. نبودن هدر الزامی `428 PRECONDITION_REQUIRED`، مقدار نامعتبر `422` و نسخهٔ قدیمی `409` می‌دهد. پس از تعارض، دادهٔ جدید را بخوانید و تغییر کاربر را دوباره بررسی کنید؛ ارسال کورکورانهٔ نسخهٔ تازه می‌تواند تغییر شخص دیگر را بپوشاند. همهٔ PATCHها هدر نسخه ندارند: collection شمارندهٔ بدنهٔ خودش را دارد؛ portal، کاربران و mark-read از قفل/merge یا عملیات اتمیک خود استفاده می‌کنند.

تکرار ایجاد درخواست با همان کاربر/مهمان، کلید و بدنهٔ معتبر همان پاسخ ذخیره‌شده را می‌دهد؛ همان کلید با بدنهٔ متفاوت `409 IDEMPOTENCY_CONFLICT` است. اگر `idempotencyKey` داخل فرم نیز ارسال شود باید با هدر یکسان باشد. صدور quotation با هش snapshot یکسان بازپخش امن دارد. سایر POSTها فقط در صورت تصریح قرارداد همان سرویس idempotent هستند؛ وجود audit یا صف به‌تنهایی چنین تضمینی نمی‌دهد.

### خطا، محدودیت و مشاهده‌پذیری

خطاها به شکل Problem Details سازگار با قالب RFC 9457 و `Content-Type: application/problem+json` بازمی‌گردند:

```json
{
  "type": "https://idealmako.ir/problems/conflict",
  "title": "CONFLICT",
  "status": 409,
  "code": "CONFLICT",
  "detail": "This request changed. Refresh and retry.",
  "requestId": "شناسهٔ همبستگی سرور",
  "error": { "code": "CONFLICT" }
}
```

`errors` در بعضی خطاهای اعتبارسنجی افزوده می‌شود. کد خطای سرویس‌های workspace ممکن است حروف کوچک داشته باشد؛ کلاینت نباید وجود همهٔ کدها با شکل بزرگ را فرض کند. پاسخ خطا هدر `X-Request-ID` دارد. خطای داخلی جزئیات اتصال، stack و رازها را برنمی‌گرداند. درخواست خارج از scope اغلب با `404` پاسخ می‌گیرد تا وجود دادهٔ دیگری افشا نشود.

حد عمومی بدنهٔ JSON یک MiB، برای `PUT /workspace` دوازده MiB و برای مسیرهای AI هفت MiB است؛ محدودیت فیلدها مستقل و معمولاً کوچک‌تر است. کلیدهای prototype خطرناک و عمق بیش از ۳۲ رد می‌شوند. سقف عمومی تغییرات ۲۴۰ درخواست در دقیقه برای visitor است؛ ورود، ثبت فرم، آپلود، بازیابی رمز و AI محدودیت‌های جداگانه دارند. `429` همراه `Retry-After: 60` به معنی لزوم توقف و تلاش بعدی است، نه تضمین زمان دقیق آزادشدن تمام سهمیه‌های روزانه.

## ۲. سلامت و محتوای عمومی

| روش | مسیر | پاسخ/دسترسی |
|---|---|---|
| GET | `/health/live` | `{status:'ok', version}`؛ زنده‌بودن فرایند، بدون اتصال DB |
| GET | `/health` و `/health/ready` | اتصال واقعی DB و readiness دفتر مستقل حریم خصوصی؛ موفقیت با `database:'ok',privacy:'ready'`، عدم تطبیق دفتر با `503 privacy:'reconciliation-required'` یا قطع DB با `503 database:'unavailable'` |
| GET | `/site` | نسخه‌های فعال منتشرشده، forms منتشرشده، preferences، `content` سازگاری، `hiddenProducts`، `hiddenProductLocales`، `hiddenArticleLocales`، `hiddenPageLocales` و `version` |

`/site` پیش‌نویس و اطلاعات CRM را برنمی‌گرداند. `ETag: "site-{version}"` و `Cache-Control: public, max-age=0, must-revalidate` دارد؛ handler فعلی پاسخ شرطی `304` را پیاده نکرده است. نقشه‌های visibility به زبان مقیدند: منبع اولیهٔ دست‌نخورده همچنان عمومی است، اما archive/delete یا لغو انتشار مدیریت‌شده اجازهٔ احیای خودکار fallback را نمی‌دهد. بازگرداندن archive به draft به‌تنهایی آن را عمومی نمی‌کند؛ انتشار بازبینی‌شدهٔ همان زبان لازم است. ویرایش یک draft عادی، نسخهٔ قبلیِ هنوز منتشرشده را پنهان نمی‌کند. SSR، sitemap، redirect قدیمی، دانش عمومی AI و فهرست اشتراکی نیز از همین وضعیت جاری استفاده می‌کنند؛ معنای کلیدها در [public-visibility.ts](../src/lib/public-visibility.ts) است. وضعیت worker، provider و قرنطینه را از `/monitoring` با مجوز مربوط بخوانید؛ health عمومی گزارش کامل زیرساخت نیست.

## ۳. حساب، احراز هویت و MFA

| روش | مسیر | بدنه یا نتیجهٔ اصلی |
|---|---|---|
| GET | `/auth/session` | `{user,csrfToken}` و bootstrap کوکی |
| POST | `/auth/register` | `{name,email,password}`؛ فقط حساب customer ایجاد می‌شود؛ `201` و session |
| POST | `/auth/login` | `{email,password}`؛ session یا `{mfaRequired:true,challengeToken}` |
| POST | `/auth/mfa/verify` | `{challengeToken,code}`؛ TOTP یا یک recovery code معتبر؛ session کامل |
| POST | `/auth/logout` | بدون بدنه؛ ابطال session فعلی و حذف کوکی؛ `{ok:true}` |
| POST | `/auth/password/forgot` | `{email,locale?}`؛ پاسخ عمومی حتی برای ایمیل ناموجود؛ صف ایمیل بازیابی |
| POST | `/auth/password/reset` | `{token,password}`؛ مصرف یک‌باره، ابطال نشست‌های قبلی؛ ورود مجدد لازم است |
| POST | `/auth/password/change` | نشست لازم؛ `{currentPassword,password}`؛ ابطال نشست‌های دیگر |
| POST | `/auth/mfa/enroll` | نشست لازم؛ `{password}`؛ `{secret,otpauthUrl,qrCodeDataUrl}` برای راه‌اندازی |
| POST | `/auth/mfa/confirm` | `{code}` با شش رقم؛ فعال‌سازی و ارائهٔ recovery codes فقط یک بار |
| POST | `/auth/mfa/recovery-codes` | نشست با MFA جاری؛ `{password,code}` با TOTP تازه شش‌رقمی؛ `{recoveryCodes}` شامل ده کد جدید، ابطال کدهای قبلی و نشست‌های دیگر |
| POST | `/auth/mfa/disable` | `{password,code}`؛ فقط customer؛ کارکنان باید MFA فعال داشته باشند |
| POST | `/auth/email/request` | `{locale?}`؛ `202`؛ صف تأیید ایمیل حساب فعلی، بدون ارائهٔ token |
| POST | `/auth/email/confirm` | `{token}`؛ همان کاربر واردشده و همان ایمیل؛ تأیید یک‌باره |
| GET | `/me/security` | وضعیت MFA و emailVerified و فهرست sessionهای مالک با `current` |
| DELETE | `/auth/sessions/:id` | ابطال یکی از sessionهای همین حساب |

نام ثبت‌نام ۲ تا ۱۰۰ نویسه و رمز جدید ۱۲ تا ۱۲۸ نویسه است. ثبت‌نام عمومی هیچ نقش کارمندی، scope کیفیت یا زبان مجاز اعطا نمی‌کند. ورود MFA دومرحله‌ای است؛ وجود فیلد اختیاری قدیمی `totp` در schema ورود به معنی فعال‌بودن ورود یک‌مرحله‌ای نیست. challenge پنج دقیقه اعتبار و حداکثر پنج تلاش دارد. ده شکست ورود متوالی حساب را موقتاً قفل می‌کند. TOTP، recovery code، رمز و token در پاسخ فهرست کاربران یا لاگ عمومی ظاهر نمی‌شوند.

بازتولید کدهای بازیابی به رمز فعلی و TOTP استفاده‌نشده نیاز دارد؛ recovery code نمی‌تواند آن را مجاز کند. حد درخواست پنج بار در ۱۵ دقیقه برای حساب است. پاسخ موفق `no-store` دارد و کد خام دوباره از API قابل خواندن نیست؛ فقط hash در DB و شمارنده در audit ثبت می‌شود. ورود هم‌زمان، ابطال نقش/نشست، مصرف TOTP و خطای audit در تراکنش کنترل می‌شوند. کد یا رمز نادرست، مجموعه قبلی و نشست‌های دیگر را تغییر نمی‌دهد. پس از restore باید با TOTP وارد شد و این عملیات را در پنل امنیت انجام داد؛ جزئیات در [RESTORE-SECURITY.fa.md](RESTORE-SECURITY.fa.md) است. در حالت‌های `hybrid` و `panel`، مدیر ارشد (`superAdmin`) فعال با نشست و MFA معتبر می‌تواند از `POST /users/:id/mfa-reset` برای بازیابی MFA کارمند فعال دیگری که MFA ثبت‌شده دارد استفاده کند. رمز فعلی مدیر، TOTP تازه و استفاده‌نشدهٔ او، رمز جدید متفاوت برای هدف و نسخه‌های جاری حساب و پروفایل الزامی‌اند؛ کد بازیابی جای TOTP مدیر را نمی‌گیرد. این مسیر برای خودِ عامل، مشتری، حساب غیرفعال، حساب فاقد MFA ثبت‌شده و حالت `env` مجاز نیست. بازیابی حساب خودِ مالک به مدیر ارشد مجاز دیگری یا، برای هویت ازپیش‌متصل به محیط، فرمان محافظت‌شدهٔ مالک نیاز دارد. جزئیات و محدودیت‌های هر مسیر در [USER-MANAGEMENT.fa.md](USER-MANAGEMENT.fa.md) و [STAFF-ENV.fa.md](STAFF-ENV.fa.md) آمده‌اند.

کارمند بدون MFA در نخستین ورود session محدود می‌گیرد: مسیرهای شخصی `me/*` و تنظیمات امنیت `auth/*` برای تکمیل ثبت MFA قابل استفاده‌اند، ولی workspace و عملیات مدیریتی مسدود هستند. تغییر نقش، scope یا غیرفعال‌سازی حساب نشست‌های قبلی را باطل می‌کند. هر درخواست حفاظت‌شدهٔ وابسته به حساب، نشست و مجوز جاری حساب را از پایگاه داده بررسی می‌کند.

لینک بازیابی رمز ۳۰ دقیقه و تأیید ایمیل ۲۴ ساعت اعتبار دارند. دریافت پاسخ موفق درخواست ایمیل تنها ایجاد outbox را تأیید می‌کند؛ دریافت واقعی به worker، `NOTIFICATIONS_MODE=live` و SMTP سالم وابسته است. درخواست تأیید جدید token قبلی را باطل می‌کند. endpoint تأیید ایمیل بدون session کاربر عمل نمی‌کند. `contactEmail` پروفایل آدرس ورود را عوض نمی‌کند.

## ۴. تنظیمات شخصی، سبد و صندوق اعلان

| روش | مسیر | قرارداد |
|---|---|---|
| GET | `/me/settings` | `{version:1,ownerId,profile,preferences,revision,updatedAt}` |
| PATCH | `/me/profile` | patch فیلدهای مجاز پروفایل و `If-Match`؛ پاسخ settings کامل |
| PATCH | `/me/preferences` | patch ترجیحات نمایشی و `If-Match`؛ پاسخ settings کامل |
| GET / PATCH | `/me/collection` | آرایهٔ ارسال‌شده جایگزین همان بخش می‌شود؛ inquiries/compare با `collectionVersion` و saved با `savedVersion,savedLocale` |
| POST | `/me/collection/merge` | merge اتمیک سبد مهمان پس از ورود؛ قرارداد بخش ۱۶ |
| GET / PATCH | `/me/portal` | دادهٔ شخصی portal و ترجیحات اعلان موجود؛ merge بخش‌های فرستاده‌شده |
| GET / PATCH | `/me/notification-preferences` | سیاست نسخه‌دار موضوع/کانال ایمیل و in-app؛ بخش ۱۱ |
| GET / POST | `/me/communication-channels` | اتصال تأییدشدهٔ SMS/Telegram/Push و capabilities واقعی؛ بخش ۱۱ |
| GET | `/me/notifications` | `{items:[{id,title,body,href,readAt,createdAt}]}`؛ آخرین ۱۰۰ اعلان مالک |
| PATCH | `/me/notifications/:id` | خوانده‌شدن اعلان همین کاربر؛ بدون بدنه و بدون `If-Match` |

فیلدهای profile: `name`, `phone`, `contactEmail`, `organization`, `profession`, `bio`, `website`, `country`, `city`, `address`, `avatar`. فیلدهای preferences: `theme: dark|light|system`, `language: fa|en|tr|ar|ru`, `timezone` معتبر IANA، `motion: system|reduced`, `effects`، `fontSize: standard|large`, `density: comfortable|compact`, `sidebar: expanded|collapsed`. آواتار data-image معتبر در سرور decode و بازتولید می‌شود؛ محدودیت یک MiB بدنهٔ HTTP همچنان اعمال می‌شود.

`inquiries` حداکثر ۵۰۰ سطر با `productId,quantity` و فیلدهای اختیاری `shade,mould,note,variantId,sku,unit` دارد؛ quantity عدد صحیح ۱ تا ۱۰۰۰۰۰ است. compare حداکثر ۴ شناسه و saved حداکثر ۵۰۰ شناسه دارد. سبد ذخیره‌شده به معنی موجودی یا قیمت تعهدشده نیست.

شکل legacy در `portal.notificationPreferences` شامل `inApp,email,requests,products,research,events` از نوع boolean، `frequency: instant|daily|weekly` و `quietStart,quietEnd` به شکل `HH:mm` است؛ تغییر آن به سیاست معتبر جاری منتقل می‌شود. برای رابط جدید از مدل نسخه‌دار بخش ۱۱ استفاده کنید. `notificationsRead` نیز برای سازگاری رابط قدیمی پذیرفته می‌شود؛ مرجع read state صندوق واقعی، رکورد notification و مسیر mark-read است. بخش legacy `portal.organizations` صرفاً دفترچهٔ شخصی است و عضویت یا دسترسی اشتراکی به درخواست ایجاد نمی‌کند؛ سازمان واقعی از مسیرهای زیر مدیریت می‌شود.

## ۵. سازمان مشتری و اشتراک درخواست

| روش | مسیر | بدنه/رفتار |
|---|---|---|
| GET | `/me/organizations` | `{items}`؛ فقط سازمان‌های فعال دارای عضویت معتبر کاربر |
| POST | `/me/organizations` | `{name,city?,country?}`؛ ایجاد سازمان و عضویت owner؛ `201` |
| PATCH | `/me/organizations/:id` | patch نام/شهر/کشور، `If-Match`؛ owner یا admin سازمان |
| DELETE | `/me/organizations/:id` | `If-Match`؛ فقط owner؛ archive و ابطال دسترسی‌ها |
| POST | `/me/organizations/:id/invitations` | `{email,role?,locale?}`؛ role از admin/member/viewer؛ دعوت با ایمیل، `202` |
| POST | `/me/organization-invitations/accept` | `{token}`؛ عضویت حساب واردشده با ایمیل منطبق |
| DELETE | `/me/organizations/:id/members/:userId` | لغو عضویت مجاز یا خروج خود؛ مالک باید مالک بماند |
| PUT | `/me/organizations/:id/requests/:requestId` | `{permission:'view'\|'reply'}`؛ مالک واقعی درخواست و owner/admin همان سازمان |
| DELETE | `/me/organizations/:id/requests/:requestId` | لغو همان share با مجوز مشابه |

نسخهٔ سازمان در `items[].version` است. پاسخ سازمان شامل `myRole`, `members`, `sharedRequestIds`, `sharePermissions` و دعوت‌های قابل مشاهده برای مدیر سازمان است. `crmLink:{reference,state}` فقط مرجع opaque پرتال و وضعیت `pending|linked` را نشان می‌دهد و شناسه/یادداشت محرمانهٔ CRM را آشکار نمی‌کند. نقش سازمان مستقل از نقش کارکنان سایت است. تنها owner می‌تواند admin دعوت کند یا admin دیگری را حذف کند. دعوت ۷۲ ساعت اعتبار دارد، تک‌مصرف است و token خام در پاسخ API برنمی‌گردد. عضویت viewer حتی روی share دارای reply فقط اجازهٔ مشاهده دارد. لغو عضویت، archive سازمان یا لغو share دسترسی را فوراً قطع می‌کند. اتصال صریح سازمان به account داخلی و تاریخچهٔ آن در بخش ۱۴ است؛ این اتصال خودبه‌خود share یا عضویت ایجاد نمی‌کند. endpoint جداگانه برای تغییر نقش عضو یا حذف invitation سازمان در این نسخه وجود ندارد.

## ۶. فرم عمومی، درخواست، مکاتبه و quotation

| روش | مسیر | دسترسی و نتیجه |
|---|---|---|
| POST | `/requests` | کاربر یا مهمان bootstrap‌شده؛ JSON معتبر و `Idempotency-Key`؛ درخواست با `201` |
| GET | `/requests` | آرایهٔ درخواست‌های مالک و shareهای معتبر؛ برای مهمان فقط موارد همان کوکی |
| GET | `/requests/:id` | مالک، مهمان مالک، عضو share یا کارمند مجاز با رعایت scope |
| GET | `/crm/requests` | انتخابگر مستقل کارکنان با `search,kind,limit,cursor`؛ `{items,nextCursor}`، توضیح زیر |
| PATCH | `/requests/:id` | patch عمل مجاز و `If-Match`؛ پاسخ درخواست نسخهٔ تازه |
| POST | `/requests/:requestId/quotes` | `{recordId}`؛ کارمند دارای مجوز صدور quotation؛ snapshot خصوصی با `201` |
| GET | `/requests/:requestId/quotes/:quoteId/pdf` | PDF واقعی از snapshot؛ خصوصی و دارای کنترل دسترسی درخواست |

انواع دامنهٔ `kind`: `rfq`, `sample_request`, `distribution_partnership`, `supplier_registration`, `outsourcing_bid`, `investment_interest`, `research_proposal`, `job_application`, `support_ticket`, `quality_complaint`, `factory_visit`, `cms_form`, `contact`, `newsletter`, `event_registration`, `data_deletion`. ثبت `outsourcing_bid` از `/requests` عمومی با `422 TENDER_ENVELOPES_REQUIRED` رد می‌شود؛ رسید این نوع فقط در تراکنش فرمان پاکت‌های جداگانهٔ بخش ۱۵ ساخته می‌شود.

فیلدهای لازم ایجاد: `kind`, `name` با ۲ تا ۱۶۰ نویسه، `email`, `message` با ۱ تا ۲۰۰۰۰ نویسه و `consent: {purpose:'request_processing',acceptedAt: ISO-date-time}`. اختیاری‌ها: `organization`, `phone`, `country`, `locale` با پیش‌فرض fa، `productIds`, `items`, `batch`, `attachmentIds`, `formId`, `formVersion`, `formValues`, `jobRecordId`, `eventSessionId`, `seats`. حداکثر ۱۰ attachment پذیرفته می‌شود و باید متعلق به همان کاربر/مهمان، clean، دارای حقوق معتبر و قابل اتصال به این گردش باشد؛ فایل حفظ‌شدهٔ مناقصه، منابع کنترل‌شده یا مدرک CRM قابل استفادهٔ دوباره برای دورزدن محرمانگی نیست. server زمان رضایت و status اولیه `received` را خودش ثبت می‌کند؛ شناسه، مالک، قیمت، پیام‌های قبلی و نقش کارمند از فرم گرفته نمی‌شوند.

نمونهٔ فرم contact؛ مقدار زمان را در لحظهٔ رضایت بسازید:

```json
{
  "kind": "contact",
  "name": "کاربر نمونه",
  "email": "customer@example.com",
  "message": "لطفاً دربارهٔ محصول با من تماس بگیرید.",
  "locale": "fa",
  "consent": {
    "purpose": "request_processing",
    "acceptedAt": "2026-10-19T12:00:00.000Z"
  }
}
```

شکایت کیفیت محصول و batch لازم دارد و در scope کیفیت قرنطینه می‌شود. sample_request محصول لازم دارد. برای RFQ، نمونه و دیگر درخواست‌های غیرکیفی، موجودبودن عمومی محصول در همان زبان زیر قفل workspace کنترل می‌شود؛ محصول اولیه‌ای که archive و سپس draft شده نیز قابل سفارش نیست. شکایت کیفیت می‌تواند به شناسهٔ تاریخی محصول اشاره کند. cms_form باید شناسه، نسخه و مقادیر فرم **منتشرشده در زبان درخواست** را ارسال کند؛ تغییر نسخه `409 FORM_CHANGED` می‌دهد.

`jobRecordId` فقط برای job_application است: باید منبع HR فعال و انتشار جاریِ همان زبان وجود داشته باشد. اگر metadata شغل ثبت شده، وضعیت آن باید `open` و تاریخ پایان پذیرش هنوز معتبر باشد؛ در غیر این صورت `409 JOB_UNAVAILABLE` است. درخواست عمومیِ عضویت در بانک استعداد بدون این شناسه باقی می‌ماند. `eventSessionId` برای event_registration اجباری و برای factory_visit نیز قابل استفاده است؛ `seats` عدد صحیح ۱ تا ۲۰ و پیش‌فرض ۱ است. ظرفیت، رزرو و رسید درخواست در یک تراکنش ثبت می‌شوند و انصراف معتبر ظرفیت را آزاد می‌کند. قرارداد دقیق شرط‌ها در [requests.ts](../src/server/requests.ts) و [events.ts](../src/server/events.ts) است.

ثبت درخواست، workspace/CRM، رضایت، audit و تخصیص در تراکنش انجام می‌شود. تقویم‌های تجاری نسخه‌دار با timezone معتبر IANA، ساعات هفتگی و تعطیلات صریح از `/crm/routing` و `/crm/calendars` مدیریت می‌شوند؛ قواعد واگذاری و مهلت SLA نیز snapshot همان تقویم را نگه می‌دارند. توضیح گردش در بخش ۲۰ آمده است.

پاسخ درخواست شامل `id`, `version`, `status`, `access`, `messages`, `sharedQuotes` و در صورت وجود `quoteEnvelopes` است. `access` یکی از owner/staff/shared_reply/shared_view است. پیام داخلی برای مشتری و عضو share حذف می‌شود؛ دسترسی کارکنان علاوه بر نقش به MFA، quality scope، مالک/مسئول واقعی، تیم/قلمرو و مجوزهای تماس/مالی متکی است. `GET /requests` صندوق همهٔ پرونده‌های کارکنان نیست.

انتخابگر `/crm/requests` جست‌وجوی حداکثر ۱۲۰ نویسه، `kind` اختیاری، `limit` از ۱ تا ۱۰۰ با پیش‌فرض ۵۰ و cursor opaque می‌پذیرد. هر صفحه حداکثر ۵۰۰ ردیف را بررسی می‌کند؛ ممکن است صفحه‌ای کم‌نتیجه همراه nextCursor باشد. جست‌وجو روی شناسه و متن **پس از حذف فیلدهای غیرمجاز** انجام می‌شود؛ cursor به کاربر، فیلتر و یک ساعت اعتبار مقید است. quotation این انتخابگر فقط حداکثر ۲۰ خلاصهٔ مجاز است؛ متن مکاتبه، پاکت مناقصه، فایل یا party snapshot خصوصی را از این فهرست دریافت نکنید.

PATCH مشتری سه نوع عمل دارد: `{status:'withdrawn'}` برای درخواست باز؛ ارسال کل آرایهٔ messages قبلی به اضافهٔ **یک** پیام public؛ یا ارسال sharedQuotes بدون تغییر snapshot با پاسخ به **یک** quotation. وضعیت پاسخ quotation از `accepted_interest`, `declined`, `revision_requested` انتخاب می‌شود و `customerResponse` حداکثر ۱۰۰۰ نویسه دارد. پذیرش علاقه‌مندی معادل پرداخت یا قرارداد قطعی نیست. پیام‌ها append-only هستند و id، sender و زمان پیام جدید را سرور تعیین می‌کند. عضو shared_reply فقط پیام public اضافه می‌کند و مجاز به withdraw یا پاسخ quotation نیست. PATCH کارمند محدود به status و افزودن پیام با مجوز بخش است.

صدور quotation از record تأییدشدهٔ quotes متصل به RFQ فعال انجام می‌شود. محاسبهٔ decimal، سقف تخفیف نقش و revision معتبر pricebook در سرور کنترل می‌شوند؛ نویسنده و تأییدکننده باید دو شخص متفاوت باشند. party snapshot مشتری/فروشنده، قیمت‌نامه، policy محاسبه، خطوط، شماره و `snapshotHash` پس از صدور ثابت‌اند. صدور تازه فایل PDF را نیز پیش از commit آماده و همراه `fileSha256,fileByteCount,fileCreatedAt,fileOrigin:'issued'` حفظ می‌کند؛ **هش snapshot با هش bytes فایل یکسان فرض نمی‌شود**. `quoteEnvelopes` با `recordId,requestId,currentRevisionId,version,updatedAt` مرجع نسخهٔ جاری همان مکاتبه است و revisionهای قبلی تغییر نمی‌کنند. برای دادهٔ واقعاً قدیمی، تولید مجاز فایل origin جداگانهٔ `legacy-rendered` دارد.

PDF با `application/pdf`, `Content-Disposition: attachment` و `Cache-Control: private, no-store` از artifact کنترل‌شده تحویل می‌شود؛ دانلود دوباره مالکیت/اشتراک و مجوز جاری مالی و تماس لازم را می‌سنجد. پاسخ مشتری مجوز تغییر snapshot، party، file hash یا envelope را نمی‌دهد. مسیر PDF لینک عمومی بدون احراز هویت نیست. typeهای [commercial.ts](../src/types/commercial.ts) و [frontend.ts](../src/types/frontend.ts) مرجع فیلدهای immutable هستند.

## ۷. CMS، صفحه‌ساز، ترجمه و گردش انتشار

| روش | مسیر | ورودی/خروجی |
|---|---|---|
| GET | `/workspace` | `{state,version}`؛ فقط projection مجاز نقش، زبان و scope |
| PUT | `/workspace` | `{state,expectedVersion,locale?}`؛ بررسی diff و ثبت اتمیک ردیف‌های مجاز |
| GET | `/workspace/revisions?bucket=records&id=…&locale=fa` | bucket از records/pages؛ `{revisions,version}`؛ حداکثر ۱۰۰ revision همان زبان |
| POST | `/workspace/restore` | `{revisionId,expectedVersion,expectedUpdatedAt}`؛ timestamp از منبع هنگام تأیید صریح گرفته می‌شود؛ بازگرداندن محتوای revision به **draft جدید** |
| POST | `/workspace/review` | `{bucket,id,locale,expectedVersion}`؛ تأیید revision دقیق توسط بازبین مستقل |
| POST | `/workspace/publish` | `{publication:{id,kind,locale},expectedVersion}`؛ انتشار canonical سرور |
| POST | `/workspace/unpublish` | `{slug,locale,kind,expectedVersion}`؛ لغو انتشار همان زبان |
| POST | `/workspace/schedule` | `{bucket,id,locale,scheduledAt,expectedVersion}`؛ ISO آینده با انتهای Z |
| POST | `/workspace/schedule/cancel` | `{bucket,id,locale,expectedVersion}`؛ لغو jobهای pending همان زبان |
| GET | `/workspace/schedules` | `{items,version}`؛ وضعیت زمان‌بندی‌های قابل مشاهده |
| GET | `/site-preferences` | `{draft,published,version}` |
| PUT | `/site-preferences` | `{value,mode:'menus'\|'settings'\|'all',publish:boolean,expectedVersion}` |

مدل `state` در [workspace-seed.ts](../src/data/workspace-seed.ts) و validatorهای [workspace-validation.ts](../src/server/workspace-validation.ts) تعریف شده است: `version:1`, `records`, `pages`, `media`, `audit`, `aiJobs`, `forms`, `settings`. نسخهٔ schema داخل state با شمارندهٔ رقابت `version` پاسخ برابر نیست. فرانت‌اند state مجاز دریافتی را ویرایش و بازمی‌فرستد؛ سرور به این snapshot برای نقش، audit، author، approvedBy، request linkage یا quarantined بودن اعتماد نمی‌کند. حذف آیتم از projection مجاز، حذف/آرشیو همان آیتم محسوب می‌شود و مجوز لازم دارد؛ رکوردی که در projection شخص نیست نباید در payload جعل شود. فیلدهای تماس/مالی/base-cost که سرور پنهان کرده نباید با رشتهٔ خالی، صفر یا آرایهٔ ساختگی جایگزین شوند. فرمان‌های typed دامنه، تخصیص و جابه‌جایی pipeline مسیر بررسی مستقل خود را دارند.

صفحه، محصول، محتوای پژوهشی/خبری، event، resource و فرم، blockهای دارای schema و محتوای پنج زبان از همین workspace مدیریت می‌شوند. block ناشناخته، اسکریپت، تنظیمات ناامن URL، ارتباط نامعتبر asset و تغییر locale خارج از scope رد می‌شود. شکل کامل هر block، variation محصول، form schema و commercialDraft در typeهای repository است؛ endpoint عمومی اجرای کد یا نصب افزونه از پنل وجود ندارد.

بازبینی به هش revision **همان زبان** متصل است. نویسنده نمی‌تواند کار خودش را تأیید کند. تغییر محتوا تأیید قبلی را برای محتوای جدید معتبر نمی‌کند. انتشار، مقادیر canonical تأییدشده را از سرور می‌سازد؛ کلاینت هویت publication را می‌فرستد و مرجع متن، نسخهٔ سرور است. زمان‌بندی نیز revision تأییدشده را ذخیره می‌کند و worker پیش از انتشار دسترسی جاری درخواست‌کننده و اعتبار آن revision را کنترل می‌کند. زبان‌های مختلف می‌توانند زمان‌بندی مستقل داشته باشند. متن کامل، metadata محدود SEO و glossary نیز عضو همین revision و checksum هستند؛ بخش ۱۹.

`workspace/schedules.items` شامل `id,bucket,documentId,locale,scheduledAt,status,error,finishedAt` است؛ وضعیت pending/published/cancelled/failed را صادقانه نشان می‌دهد. restore مستقیماً نسخهٔ زنده را عوض نمی‌کند؛ draft بازگردانی‌شده باید مجدداً review/publish شود. حذف محتوای منتشرشده تا unpublish ایمن آن محدود است. حذف رسانه‌ای که در پیش‌نویس فعال یا انتشار استفاده شده نیز `409 ASSET_IN_USE` می‌دهد.

در site-preferences، حالت menus فقط navigation/footer، settings فقط brand/contact و all هر دو را تغییر می‌دهد. draft ذخیره‌شده تا فرمان `publish:true` روی سایت عمومی اثر ندارد. مجوز ویرایش/انتشار منو از مجوز مدیریت تنظیمات تفکیک شده است.

## ۸. کاربران و رسانه

| روش | مسیر | قرارداد |
|---|---|---|
| GET | `/users` | admin/superAdmin جاری با MFA؛ فیلتر سروری و صفحه‌بندی `{items,nextCursor,provisioningMode,canCreate,canManageGrants}`؛ قرارداد زیر |
| POST | `/users` | `{name,email,password,role?,active?,allowedLocales?,qualityScope?,crmScope?,crmPermissions?,profile?}`؛ `201` و DTO تفصیلی |
| GET | `/users/:id` | حساب مجاز + `profile,profileRevision,capabilities`؛ اطلاعات پروفایل مدیران فقط برای superAdmin |
| PATCH | `/users/:id` | patch `name,email,role,active,allowedLocales,qualityScope,crmScope,crmPermissions,profile`؛ `profileRevision` هنگام تغییر پروفایل اجباری و `expectedUpdatedAt` برای کنترل تعارض حساب |
| POST | `/users/:id/password` | `{password,expectedUpdatedAt?}` از فرم مستقل؛ پنل همیشه زمان نسخهٔ بازشده را می‌فرستد؛ MFA جاری، فقط superAdmin برای کارکنان یا admin برای مشتری؛ پاسخ `{ok,userId,sessionsRevoked,updatedAt}` |
| POST | `/users/:id/mfa-reset` | `{actorPassword,actorCode,password,expectedUpdatedAt,profileRevision}`؛ همه الزامی‌اند. فقط superAdmin مجاز برای کارمند فعال دیگر؛ رمز جدید متفاوت با طول ۱۲ تا ۱۲۸ نویسه. پاسخ `{ok,userId,sessionsRevoked,mfaEnrollmentRequired,updatedAt,profileRevision}`؛ دو پرچم ابطال نشست و الزام ثبت دوبارهٔ MFA در موفقیت `true` هستند. |
| DELETE | `/users/:id` | غیرفعال‌سازی ایمن `active:false`؛ حذف فیزیکی نیست |
| GET | `/media` | `{items}` کتابخانهٔ مجاز: public یا private متعلق به همین کارمند |
| POST | `/media` | multipart با `file`, `visibility:public\|private`؛ انتشار عمومی `rights:true` لازم دارد |
| DELETE | `/media/:id` | حذف منطقی با بررسی مالکیت، مجوز archive و عدم استفادهٔ فعال |
| POST | `/attachments` | multipart با file؛ private اجباری، کاربر یا مهمان مجاز؛ `201` |
| GET | `/me/attachments` | فایل‌های خصوصی مجازِ مالک برای انتخاب در گردش مربوط؛ دریافت فهرست، حق اتصال به هر دامنه‌ای نیست |
| GET / HEAD | `/attachments/:id` | فایل مجاز به صورت attachment؛ مالک/مهمان مالک یا scope پرونده |
| GET / HEAD | `/media/:id/content` | فایل public فعال و clean عمومی؛ private نیازمند مجوز است |

فهرست کاربران `kind:all|staff|customer` با پیش‌فرض all، `q` برای جست‌وجوی نام یا ایمیل، `role` اختیاری از نقش‌های معتبر، `active:all|true|false` با پیش‌فرض all و `limit` عدد صحیح ۱ تا ۱۰۰ با پیش‌فرض ۵۰ می‌گیرد. جست‌وجو پس از trim حداکثر ۱۰۰ نویسه دارد و تطبیق زیررشته بدون حساسیت به بزرگی حروف است؛ `%`، `_` و backslash معنای wildcard ندارند. NUL، پارامتر ناشناخته یا تکراری، limit نامعتبر و ترکیب متناقض kind/role با `422 VALIDATION` رد می‌شوند. فیلترها **پیش از محدودکردن تعداد سطرها** در PostgreSQL اعمال می‌شوند؛ زیادشدن ثبت‌نام مشتریان، کارکنان یا مشتریان قدیمی را از دسترس مدیریت خارج نمی‌کند. نمونه: `GET /api/v1/users?kind=staff&active=true&q=editor&limit=50`.

ترتیب بر پایهٔ `created_at DESC,id DESC` است. برای ادامه، `nextCursor` را بدون تغییر با همان kind/q/role/active بفرستید؛ مقدار null یعنی صفحهٔ دیگری وجود ندارد. تغییر اندازهٔ صفحه مجاز است، اما تغییر فیلتر باید cursor قبلی را کنار بگذارد. cursor نامعتبر یا ناسازگار با فیلتر `422 USER_DIRECTORY_CURSOR` می‌دهد؛ cursor خالی یا بیش از ۲۰۴۸ نویسه خطای validation است. مرز زمانی cursor شش رقم اعشار PostgreSQL را حفظ می‌کند تا حساب‌های ایجادشده در یک میلی‌ثانیه جا نیفتند؛ زمان‌های نمایشی DTO به صورت ISO هستند. این مرور، snapshot ثابت همهٔ حساب‌ها نیست: حساب تازه‌تر در ادامهٔ مرز قبلی وارد نمی‌شود و با تازه‌سازی صفحهٔ اول دیده می‌شود؛ ویرایش یا غیرفعال‌سازی هم‌زمان نیز مطابق فیلتر جاری اثر دارد.

هر صفحه فقط اطلاعات مدیریتی مجاز حساب، وضعیت MFA/تأیید ایمیل، زبان‌ها و grantها را برمی‌گرداند؛ password hash، راز MFA، کد بازیابی و دادهٔ نشست در پاسخ نیست. cursor مجوز دسترسی ایجاد نمی‌کند؛ نقش، فعال‌بودن حساب و MFA جاری در هر درخواست دوباره بررسی می‌شوند. پیش‌فرض تولیدی `hybrid` است؛ `canCreate,canManageGrants` و `capabilities` هر ردیف، اختیار جاری و حالت پیکربندی را منعکس می‌کنند. `capabilities` شامل `canEdit,canChangeEmail,canManageGrants,canResetPassword,canResetMfa,canDeactivate,canReactivate` است؛ مجوز نهایی همیشه در سرور و هنگام عملیات دوباره بررسی می‌شود. profile در فهرست عمومی مدیران bulk ارسال نمی‌شود و فقط با GET تفصیلی حساب مجاز خوانده می‌شود. سقف مستقل گیرنده‌های handover برابر ۱۰۰۰ کارمند فعال دارای MFA است و عبور از آن همچنان `413 STAFF_DIRECTORY_LIMIT` می‌دهد؛ تعداد مشتریان این سقف را پر نمی‌کند.

مهاجرت افزایشی [042_user_directory.sql](../db/migrations/042_user_directory.sql) دو ایندکس مرتب برای مرور همهٔ حساب‌ها و کارکنان می‌افزاید و داده/اعتبارنامه را تغییر نمی‌دهد. آن را با migrator عادی پروژه اجرا کنید؛ ساخت ایندکس در تراکنش و بدون `CONCURRENTLY` است، بنابراین روی جدول بزرگ می‌تواند نوشتن را تا پایان تراکنش منتظر بگذارد و باید در پنجرهٔ نگهداری مناسب اجرا شود. مهاجرت‌های قبلی را بازنویسی نکنید. قرارداد نوع در [user-management.ts](../src/types/user-management.ts) و آزمون واقعی پایگاه داده/API، دقت cursor و اجرای دوبارهٔ migrator در [server-user-directory.pg.mjs](../tests/server-user-directory.pg.mjs) است.

فقط superAdmin می‌تواند نقش کارمندی یا grantهای CRM/کیفیت اعطا کند؛ `crmScope:assigned|team|all` و `crmPermissions:{contact,financial,baseCost,assign,intake}` نیز فیلدهای صریح کاربران هستند. نقش‌های غیرمدیریتی بدون grant دسترسی گسترده نمی‌گیرند؛ admin/superAdmin در دامنه‌های مجاز نقش خود اختیار مدیریتی مؤثر دارند، ولی quality scope مستقل است. admin عادی نمی‌تواند admin/superAdmin دیگری را مدیریت کند و ایجاد او به customer محدود است. آخرین superAdmin فعال و تغییر نقش خود شخص محافظت می‌شوند. غیرفعال‌سازی یا تبدیل کارمند دارای کار باز به customer تا تحویل کامل بخش ۱۳ با `409 STAFF_HANDOVER_REQUIRED` رد می‌شود. در حالت hybrid مدیر ارشد می‌تواند ایمیل ورود کارکنان را اصلاح کند؛ مدیر عادی فقط ایمیل/رمز مشتری را تغییر می‌دهد. PATCH رمز نمی‌پذیرد؛ از POST مستقل password استفاده کنید. این endpoint برای تغییر رمز خود شخص `403 SELF_PASSWORD_RESET` می‌دهد؛ مسیر امنیت شخصی رمز فعلی می‌خواهد. رمز جدید ۱۲ تا ۱۲۸ نویسه و مطابق سیاست رمز سرور است؛ پاسخ یا audit شامل رمز/hash/secret نیست. POST موفق، `updatedAt` جدید را برمی‌گرداند. پنل فقط پس از reset شرطی موفق از همین نسخهٔ حساب، مبنای زمانی را جلو می‌برد و پیش‌نویس اطلاعات را حفظ می‌کند.

`profile` فقط `phone,contactEmail,organization,profession,bio,website,country,city,address` را می‌پذیرد؛ نام در فیلد سطح اول `name` است. نام/عکس/مجوز درون profile قابل overpost نیستند. `profileRevision` باید عدد صحیح جاری GET تفصیلی باشد: نبود آن `428 PRECONDITION_REQUIRED` و نسخه قدیمی `409 PROFILE_CONFLICT` می‌دهد. اگر `expectedUpdatedAt` ارسال شود، مقدار باید همان ISO برگردانده‌شده باشد؛ مبنای متفاوت `409 USER_CONFLICT` می‌دهد. ایمیل تکراری `409 EMAIL_EXISTS` است و تراکنش تمام تغییرات همراه، از جمله پروفایل، را برمی‌گرداند.

در POST رمز نیز `expectedUpdatedAt` همان زمان نسخهٔ حسابِ GET تفصیلی است. پنل آن را همیشه می‌فرستد؛ سرور پیش از hash و دوباره زیر قفل نهایی حساب هدف آن را بررسی می‌کند. اگر نام، ایمیل، نقش/مجوز یا نسخهٔ حساب در این فاصله تغییر کند، پاسخ `409 USER_CONFLICT` است و این reset هیچ رمز، نشست یا challenge را تغییر نمی‌دهد. فرم نسخه و پیش‌نویس قبلی خود را حفظ می‌کند تا تغییر هم‌زمان پوشانده نشود. برای سازگاری با فراخوان‌های مدیریتی قبلی، حذف این فیلد از API همچنان reset صریح و بدون شرط نسخه است؛ مصرف‌کننده‌ای که یک ویرایشگر باز را حفظ می‌کند باید آن را بفرستد. مقدار نامعتبر timestamp با `422 VALIDATION` رد می‌شود.

تغییر واقعی ایمیل ورود، وضعیت تأیید ایمیل را false و تمام نشست‌ها و challengeها را باطل می‌کند؛ ایمیل تماس مستقل پروفایل خودکار بازنویسی نمی‌شود. پاسخ PATCH در اصلاح ایمیل خود مدیر `requiresReauthentication:true` دارد. تغییر مجوز یا وضعیت نیز نشست‌ها/challengeهای پیشین را باطل می‌کند. حذف grant تماس/مالی، محدودکردن scope، زبان یا quality scope از پنل حتی با وجود کار باز فوراً اعمال می‌شود؛ handover همچنان برای غیرفعال‌سازی یا تبدیل کارمند به customer اجباری است. reset رمز قفل تلاش‌های ناموفق و MFA نیمه‌تمام را پاک می‌کند، ولی authenticator ثبت‌شده و کدهای بازیابی معتبر را نگه می‌دارد. اختیار جاری، حساب فعال، MFA و نشست مدیر پس از hash رمز دوباره زیر قفل تراکنش بررسی می‌شوند. تغییر اختیار خود مدیر، غیرفعال‌سازی خود و حذف آخرین superAdmin فعال ممنوع است. شرح عملی در [USER-MANAGEMENT.fa.md](USER-MANAGEMENT.fa.md) و آزمون واقعی در [server-user-management.pg.mjs](../tests/server-user-management.pg.mjs) است.

فرمت‌های آپلود: PNG، JPEG، WebP، PDF، DOCX، MP4، MP3 و WAV؛ تشخیص اولیه با bytes فایل است، نه MIME ارسالی مرورگر. اندازهٔ پیش‌فرض هر فایل ۲۰ MiB است؛ مدیر می‌تواند حد عمومی، حد جداگانه نوع فایل و سهمیه حساب/مهمان/سایت را در پنل تغییر دهد. سقف حفاظتی این نسخه ۸۰ MiB برای یک فایل است؛ قرارداد policy در بخش «سیاست جاری حجم فایل و ذخیره‌سازی» و [UPLOAD-STORAGE.fa.md](UPLOAD-STORAGE.fa.md) آمده است. تصویر decode، جهت‌دهی، محدودسازی ابعاد و بازتولید WebP می‌شود تا metadata و payload اضافی باقی نماند. سایر فایل‌ها در `scanStatus:pending` می‌مانند تا ClamAV نتیجهٔ واقعی بدهد؛ نبود scanner هیچ فایلی را خودکار clean نمی‌کند. پاسخ قرنطینه `409 QUARANTINED` است. asset دارای `id,url,filename,name,size,bytes,mimeType,visibility,scanStatus,createdAt` است.

**فایل نسخهٔ سند کنترل‌شده:** آپلود خصوصی در پنل منابع از `POST /attachments` و انتخاب فایل‌های مالک از `GET /me/attachments` استفاده می‌کند. سپس `POST /resources/:id/versions` با `If-Match` نسخهٔ جاری منبع و بدنهٔ `{assetId,label,locale,rightsConfirmed:true,rightsExpiresAt?}` یک نسخهٔ فایل ایجاد می‌کند و `201` می‌دهد. همین مسیر برای هر هشت فرمت بالا معتبر است؛ تصویر به WebP خصوصی و بدون پیوند DAM تبدیل می‌شود و فایل غیرتصویری تا scan موفق قابل اتصال نیست. مدیر تجاریِ اتاق داده با مجوز مالی جاری می‌تواند از این مسیر استفاده کند، حتی وقتی مجوز ایجاد media ندارد. آپلود تصویر از `/media` عمداً اصل خام و منبع DAM حفظ‌شده می‌سازد؛ اتصال آن خانواده، مشتق‌ها، مدرک CRM/مناقصه یا فایل سند دیگری به یک منبع تازه با `409 ASSET_IN_USE` رد می‌شود. حضور فایل در انتخابگر مالک این محدودیت را دور نمی‌زند. [آزمون آپلود منابع](../tests/server-resource-uploads.pg.mjs) مسیر واقعی HTTP، بازبینی مستقل، دانلود و پس‌گرفتن دسترسی را پوشش می‌دهد؛ تغییر وضعیت scan غیرتصویری در آن یک fixture صریحِ پایگاه داده است و اثبات اجرای زندهٔ ClamAV نیست.

رسانهٔ private و اصل خام DAM در `/public` قرار نمی‌گیرند. derivative تصویر/ویدیو تاریخچهٔ منبع را حذف نمی‌کند؛ پاک‌بودن scan، حقوق استفاده و انقضای اجداد نیز هنگام تحویل کنترل می‌شوند. HTTP Range تک‌بازه‌ای `bytes=start-end`، `bytes=start-` و `bytes=-length` پشتیبانی می‌شود؛ چندبازه، ورودی نامعتبر یا بازه خارج از فایل `416` می‌گیرد. `If-Range` فقط با ETag قوی منطبق، بازه را فعال می‌کند؛ ناسازگاری، ETag ضعیف یا تاریخ، پاسخ کامل می‌دهد. فایل عمومی ETag مبتنی بر SHA-256 و Last-Modified دارد و شرط `If-None-Match` پس از کنترل تازه مجوز/اسکن/حقوق می‌تواند `304` بدهد. فایل خصوصی `304` نمی‌دهد. HEAD در دو مسیر جدول همان metadata و بدون بدنه است و Range را نادیده می‌گیرد. تحویل و hash فایل به‌صورت جریان محدود انجام می‌شوند؛ حافظه به اندازه کل فایل تخصیص نمی‌یابد. خرابی bytes، فایل جایگزین یا symlink مجاز به دورزدن hash نیست. پاسخ private دارای no-store و فایل‌های غیررسانه‌ای attachment هستند. حذف منطقی فایل حفظ‌شدهٔ پرونده، منبع، کتابخانهٔ مشترک، پاکت یا lineage مجاز نیست؛ جایگزینی مدرک فعلی، نگهداری مدرک تاریخی را از بین نمی‌برد. مسیرهای dedicated فایل، مجوز عمومی media را گسترش نمی‌دهند.

## ۹. هوش مصنوعی و کارهای رسانه‌ای

| روش | مسیر | قرارداد |
|---|---|---|
| GET | `/ai/status` | وضعیت پیکربندی provider/model و capabilities واقعی؛ عمومی |
| POST | `/ai/chat` | schema generate با mode فقط chat؛ ورود یا فعال‌بودن صریح AI_PUBLIC_CHAT |
| POST | `/ai/generate` | chat یا ابزار استودیو با مجوز AI و MFA؛ پاسخ JSON تکمیل‌شده |
| POST | `/ai/jobs` | `{mode:'video'\|'audio',prompt,locale,duration?}`؛ `202 {id,status:'pending'}` |
| GET | `/ai/jobs` | `{items}`؛ آخرین ۱۰۰ job متعلق به actor |
| GET | `/ai/jobs/:id` | وضعیت همان job و خروجی خصوصی/وضعیت scan؛ مالک لازم است |
| POST | `/ai/jobs/:id/cancel` | فقط job هنوز pending و بدون provider_id؛ `{ok:true}` |
| POST | `/webhooks/openrouter` | webhook امضاشده؛ ثبت dedupe و تحریک polling، نه اعتماد به URL خروجی وب‌هوک |

ورودی generate: `prompt` با ۱ تا ۱۰۰۰۰ نویسه، `locale` اجباری و `mode` از chat/text/rewrite/translation/document/image/video/audio/crm_assist. `history` حداکثر ۱۶ پیام `{role:'user'|'model',text}` با مجموع ۳۰۰۰۰ نویسه، `context` حداکثر ۱۸۰۰۰، `referenceImage` مسیر تصویر کاتالوگ مجاز، یا `imageData:{mimeType,data}` از تصویر base64 پذیرفته می‌شود. مرجع decoded حداکثر ۴ MiB است. context دلخواه برای chat عمومی نادیده گرفته می‌شود؛ دانش بازیابی‌شده فقط محتوای عمومی معتبر و منتشرشده است.

`crm_assist` فقط برای کارمند مجاز است و `recordIds` یک تا پنج شناسهٔ مجاز و `crmTask:summary|reply|fields|next_steps` می‌پذیرد. context/history یا تصویر دلخواه در این mode ممنوع است؛ داده با scope فعلی و حذف تماس/مالی/base-cost غیرمجاز از سرور خوانده می‌شود. پاسخ پیشنهاد است و هیچ رکورد CRM را خودکار تغییر نمی‌دهد. نمایهٔ دانش عمومی و jobهای embedding از `/ai/knowledge` مدیریت می‌شوند؛ پیکربندی/وضعیت retrieval در `/ai/status` منعکس می‌شود و منبع withdrawشده حتی با vector قدیمی قابل استناد نیست.

modeهای video/audio در **generate همگام** خروجی متن/سناریو تولید می‌کنند؛ فایل ویدیو/صوت واقعی از `/ai/jobs` ساخته می‌شود. duration job در صورت ارسال عدد صحیح ۲ تا ۱۲ است. هیچ قابلیت بدون key و model سازگار فعال فرض نمی‌شود؛ `503 NOT_CONFIGURED` خطای واقعی است. پاسخ generate شامل `id,text,image?,model,provider,tokens,sources` است؛ source شامل عنوان و URL منبع عمومی است. تصویر و سایر خروجی‌های تولیدی ابتدا private هستند و مجوز انتشار محتوا را دور نمی‌زنند.

سقف روزانه و ماهانهٔ هزینه در DB به‌صورت رزرو عددی و قفل سراسری اعمال می‌شود. وقتی provider رسید قطعی ندهد رزرو حفظ و وضعیت uncertain ثبت می‌شود؛ تلاش خودکار نامحدود و دوباره‌ارسال کور وجود ندارد. وضعیت job ممکن است pending/running/in_progress/completed/failed/uncertain/cancelled باشد. completed بودن job صوت/ویدیو به معنی clean بودن فایل نیست؛ `output.media.scanStatus` پیش از دانلود باید clean باشد. پس از آغاز provider، cancel با `409 JOB_ALREADY_RUNNING` رد می‌شود.

امضای webhook در `X-OpenRouter-Signature` به شکل `t=<unix-seconds>,v1=<hex>` است و HMAC-SHA256 روی `t + ',' + rawBody` با secret سرور بررسی می‌شود؛ اختلاف زمانی حداکثر ۳۰۰ ثانیه و body حداکثر ۶۴ KiB است. بدنه `type,created_at,data:{id}` دارد. هش بدنه replay دقیق را حذف می‌کند؛ وضعیت نهایی و فایل از provider پیکربندی‌شده دوباره خوانده می‌شوند. مسیرهای قدیمی GET/POST زیر `/api/ai/*` به handler همان AI وصل هستند؛ مسیر canonical جدید `/api/v1/ai/*` است.

## ۱۰. اتوماسیون CRM

قانون اتوماسیون یک record مجموعهٔ `automations` است و با CRUD معمول workspace و `expectedVersion` ذخیره می‌شود. قانون فعال هم `record.status === 'active'` و هم `details.automationRule.enabled === true` لازم دارد:

```json
{
  "schemaVersion": 1,
  "enabled": true,
  "event": "record.created",
  "collection": "leads",
  "conditions": { "status": "new" },
  "actions": [
    { "type": "create_activity", "title": "پیگیری سرنخ جدید", "owner": "business", "dueMinutes": 60 }
  ],
  "maxDepth": 1
}
```

event از `record.created`, `record.updated`, `activity.due` است. collectionهای مجاز accounts/contacts/leads/opportunities/tickets/samples/handoffs/partners/activities هستند. conditions اختیاری و ترکیب AND از `status,owner,tag,kind` است؛ kind نوع واقعی درخواست متصل را می‌سنجد. اقدامات مجاز `create_activity` با title/owner/dueMinutes، `assign_owner` با owner و `add_tag` با tag هستند. dueMinutes فاصلهٔ واقعی از زمان اجراست، نه تقویم SLA ساعات کاری. حداکثر عمق بین ۱ تا ۳ و پیش‌فرض ۱ است؛ افزودن tag کیفیت یا افزایش دسترسی با قانون مجاز نیست.

| روش | مسیر | قرارداد |
|---|---|---|
| POST | `/automations/dry-run` | `{ruleId,limit?}` با سقف ۲۰۰؛ `{ruleId,enabled,event,matchedCount,truncated,matches,note}`؛ بدون نوشتن داده |
| POST | `/automations/run` | `{ruleId,recordIds,idempotencyKey}`، ۱ تا ۱۰۰ شناسه؛ `202 {queued,eventIds,duplicate}` |
| GET | `/automations/runs?ruleId=…&limit=50` | `{runs}`؛ هر اجرا با منبع، attempts، نتیجه، errorCode و زمان‌ها |

dry-run وضعیت فعلی شرط‌ها را می‌سنجد و ادعا نمی‌کند رویداد تاریخی دوباره رخ داده است. اجرای دستی نیز به همان scope کاربر و سازندهٔ قانون محدود است. worker قبل از اقدام نقش، MFA، فعال‌بودن سازنده، fingerprint فعلی قانون و وضعیت آخرین record را دوباره بررسی می‌کند. تغییرات record، audit و رویدادهای فرزند اتمیک هستند. dedupe رویداد/قانون و maxDepth جلوی چرخهٔ خودتحریک را می‌گیرند؛ یادآوری due نیز عمق علت اصلی را حفظ می‌کند. یادآوری‌ها اعلان داخلی واقعی هستند؛ موتور قانون اجرای کد دلخواه یا ارسال خارجی آزاد ندارد.

## ۱۱. ارسال اعلان و پایش

| روش | مسیر | قرارداد |
|---|---|---|
| POST | `/notifications` | کارمند MFAدار از superAdmin/admin/business/support؛ ایجاد outbox با `202 {id,status:'pending'}` |
| GET | `/monitoring` | superAdmin/admin/analyst با MFA؛ DB، heartbeat، صف، storage و شمار درخواست‌ها |
| GET / PATCH | `/me/notification-preferences` | دریافت `{version,preferences,channels}`؛ ذخیرهٔ `{expectedVersion,preferences}` |
| GET | `/me/communication-channels` | `{items,capabilities,locale,phoneAvailable}`؛ مقصدهای تأییدشدهٔ خود حساب و قابلیت‌های جاری |
| POST | `/me/communication-channels` | `{channel:'sms'\|'telegram'\|'push',endpointId?,pushToken?}`؛ آغاز اثبات مالکیت، `202` |
| PATCH | `/me/communication-channels/:bindingId` | `{preferences}` و `If-Match`؛ فقط اتصال متعلق به همین گیرنده |
| DELETE | `/me/communication-channels/:bindingId` | `If-Match`؛ ابطال اتصال و بی‌اعتبارشدن پیام‌های وابسته |
| GET | `/crm/contacts/:contactId/communication-channels` | اتصال‌های مخاطب مستقل با scope تماس جاری؛ در صورت نیاز `phoneEndpoints` قابل انتخاب |
| POST | `/crm/contacts/:contactId/communication-channels` | `{channel:'sms',endpointId}`؛ فقط درخواست اثبات شمارهٔ ذخیره‌شده، `202` |
| POST | `/crm/contacts/:contactId/endpoints/:endpointId/verification` | آغاز اثبات ایمیل همان مقصد؛ کد در DTO برنمی‌گردد |
| POST | `/crm/contacts/:contactId/endpoints/:endpointId/preferences` | درخواست لینک مرکز ترجیح برای ایمیل تأییدشدهٔ همان مخاطب، `202` |
| GET | `/crm/campaign-recipients` | جست‌وجوی محدود گیرنده‌های typed در scope فعلی فرستنده؛ حساب و مخاطب مستقل ادغام نمی‌شوند |

schema ارسال دستی شامل `channel:email|sms|telegram|push|in-app`, `body`, `title?`, `purpose:transactional|marketing`, `topic?`, `userId?`, `recipientId?`, `bindingId?`, `requestId?`, `to?`, `href?` است. purpose پیش‌فرض transactional و topic متناظر آن requests است؛ marketing فقط products/research/events را می‌پذیرد. href باید مسیر محلی امن با یک slash آغازین باشد؛ مقصد خارجی، backslash، فاصله و کنترل‌کاراکتر رد می‌شود. مجوز نقش به‌تنهایی اجازهٔ ارسال به هر گیرنده را نمی‌دهد؛ scope و رابطهٔ جاری درخواست/مخاطب دوباره بررسی می‌شوند.

برای **email و in-app**، این endpoint حساب را با `userId` انتخاب می‌کند؛ `recipientId` و `bindingId` در این شاخه پذیرفته نمی‌شوند. مقصد از هویت حساب استخراج می‌شود و `to` اختیاری نباید با آن مغایرت داشته باشد. marketing ایمیلی به تأیید نشانی، رضایت جاری موضوع/کانال، عدم suppression و قابلیت پیکربندی‌شده نیاز دارد. ارسال email مخاطب مستقل از مسیر کمپین و endpoint تأییدشدهٔ همان namespace عبور می‌کند.

برای **SMS، Telegram خصوصی و Push**، دقیقاً یکی از `userId` یا `recipientId` انتخاب می‌شود؛ `bindingId` اختیاری فقط یک اتصال متعلق به همان گیرنده را مشخص می‌کند. فرستادن `to` خام با `422 RECIPIENT` رد می‌شود. سرور binding تأییدشده، نسخه و fingerprint مقصد، رضایت همان موضوع و sender scope را هنگام enqueue و دوباره پیش از dispatch بررسی می‌کند. حدود title/body به شمارش نویسه برای SMS برابر ۱۲۰/۴۰۰، Telegram برابر ۲۰۰/۲۲۰۰ و Push برابر ۱۰۰/۳۰۰ است؛ سقف عمومی body ایمیل/in-app ده‌هزار نویسه است. شماره یا chat ID تایپ‌شدهٔ اپراتور، اثبات مالکیت محسوب نمی‌شود.

سیاست ایمیل/in-app چنین ساختاری دارد: `preferences:{schemaVersion:1,timezone,topics:{requests,products,research,events}}` که هر topic دو کلید `email` و `inApp` دارد. مقدار هر کانال `{enabled,frequency:'instant'|'daily'|'weekly',quietStart:null|'HH:mm',quietEnd:null|'HH:mm'}` است؛ هر دو ساعت باید null یا دو ساعت متفاوت باشند. سیاست هر binding غیرایمیلی نیز همین چهار topic و timezone را دارد، اما مقدار هر topic مستقیماً سیاست همان کانال است. grant کارمند اجازهٔ opt-in کردن یک گیرنده را از طرف او نمی‌دهد.

دفتر outbox بین pending/running/batched/delivered/failed/cancelled/uncertain تمایز می‌گذارد. `batched` یعنی عضویت در digest، نه تحویل. `delivered` خارجی یعنی آداپتور شاهد پذیرش گرفته است؛ برای SMTP مدرک خوانده‌شدن یا تحویل به Inbox نهایی نیست. قطع ارتباط پس از احتمال پذیرش خارجی به uncertain می‌رود و worker آن را کورکورانه دوباره نمی‌فرستد. برای in-app، بررسی مجوز جاری، INSERT اعلان و ثبت پذیرش در یک تراکنش و زیر قفل workspace انجام می‌شود. یادآوری وظیفه و alert گواهی از همین سیاست عبور می‌کنند؛ بخش‌های ۱۷ و ۱۸.

پیش‌فرض `NOTIFICATIONS_MODE=disabled` و `CRM_CAMPAIGNS_ENABLED=false` است. قابلیت‌های اتصال از configuration و پیش‌شرط واقعی provider خوانده می‌شوند؛ نبود تنظیمات، حالت disabled یا مقصد تأییدنشده به معنای ارسال موفق نیست. کاوه‌نگار به الگوی OTP و فرستندهٔ واقعی، Telegram به اثبات private chat و webhook secret، و Najva به website ID، **کلید سروری `NAJVA_API_KEY` در هدر دقیق `apiKey`** و SDK/worker مجاز اپراتور نیاز دارند. هیچ کلید provider در پاسخ قابلیت‌ها قرار نمی‌گیرد. مجوزهای اضافهٔ CSP نجوا فقط به صفحهٔ دقیق اتصال دستگاه و worker ریشه محدودند. تنظیمات و محدودیت شواهد اجرای واقعی در [COMMUNICATIONS.fa.md](COMMUNICATIONS.fa.md) آمده است؛ گذراندن آزمون با provider شبیه‌سازی‌شده اثبات ارسال زنده نیست.

پایش، incident و SLO مسیرهای مجزای `/monitoring/incidents` و `/monitoring/slos` دارند. analyst اطلاعات حساس زیرساخت و audit تفصیلی را دریافت نمی‌کند. `configured` وجود تنظیمات را نشان می‌دهد؛ اندازه‌گیری کافی، پاسخ سالم مقصد یا رسید تحویل را تضمین نمی‌کند. وضعیت بدون شاهد باید unknown باقی بماند. endpoint عمومی آزاد برای replay نامطمئن همهٔ providerها وجود ندارد؛ عمل مجاز و reconciliation طبق [OPERATIONS.fa.md](OPERATIONS.fa.md) انجام می‌شود.

## ۱۲. لینک محدود، preview و حریم خصوصی capability

این مسیرها پیش از خواندن session اجرا می‌شوند؛ هویت موجود در کوکی نمی‌تواند گیرندهٔ لینک را عوض کند. پاسخ‌های حساس no-store، no-referrer و noindex هستند. کلاینت capability باید `credentials:'omit'` و برای درخواست حساس `redirect:'error'` داشته باشد و از bootstrap عمومی API استفاده نکند. URL/کد capability را در analytics، لاگ، localStorage یا پیام خطا بازنشر نکنید.

| روش | مسیر | اختیار محدود |
|---|---|---|
| GET | `/content-previews/:token` | HTML sandbox از revision ذخیره‌شدهٔ مجاز؛ بدون ورود، محدود به عمر و وضعیت token و source |
| GET | `/wishlist-shares/:token` | فهرست اشتراکی با فیلتر دسترسی عمومی **فعلی**؛ هیچ grant برای resource خصوصی ایجاد نمی‌کند |
| GET / POST | `/surveys/forms/:token` | فرم CSAT/NPS مقید به همان دعوت؛ GET شامل `csrfToken`، POST با `X-Survey-CSRF` و Origin همان مبدأ |
| GET / PATCH | `/communication-preferences/:token` | ترجیح همان endpoint؛ PATCH با `X-Communication-CSRF`، Origin و `{expectedVersion,preferences}` |
| GET / PATCH | `/communication-verification/:token` | اثبات اتصال؛ PATCH با `X-Communication-CSRF` و `{confirm:true,code?}`؛ code شش رقم برای SMS |
| GET / POST | `/communication-preferences/:token/channels` | فهرست/آغاز اتصال متعلق به گیرندهٔ capability، نه حساب احتمالی مرورگر |
| PATCH / DELETE | `/communication-preferences/:token/channels/:bindingId` | `X-Communication-CSRF` و `If-Match`؛ PATCH شامل `{preferences}` |
| GET / POST | `/communication-unsubscribe/:token` | لغو محدود به مقصد/موضوع مجاز؛ GET فقط نمایش، POST فرم one-click |
| GET / POST | `/notifications/unsubscribe/:token` | لغو ایمیل حساب؛ GET بدون تغییر و POST طبق قرارداد one-click |

GET هیچ‌کدام از مسیرهای لغو، رضایت را عوض نمی‌کند. قرارداد one-click بدنهٔ `application/x-www-form-urlencoded` با `List-Unsubscribe=One-Click` دارد. تغییر endpoint، لغو یا انقضای token، grant capability قبلی را معتبر نگه نمی‌دارد. مصرف فرم survey یک‌باره است؛ توکن آن مجوز بستن پروندهٔ کیفیت یا ایجاد testimonial عمومی نیست.

وب‌هوک‌ها نیز استثنای **محدود** احراز هویت خود هستند: `POST /webhooks/openrouter` طبق بخش ۹، `POST /connectors/:id/events` با HMAC دقیق bytes/time و dedupe اتصال، و `POST /communication-channels/telegram-webhook` با secret هدر پیکربندی‌شده و شناسهٔ update. هیچ‌کدام API عمومی بدون اعتبارسنجی مقصد محسوب نمی‌شوند. توکن تأیید اولیهٔ ایمیل مخاطب در `POST /crm/contact-endpoints/confirm` مسیر متفاوتی است و همچنان کنترل CSRF عادی فرم را دارد.

## ۱۳. دعوت، تحویل کار و خروج کارکنان — 025

**سیاست تولیدی جدید:** پیش‌فرض `STAFF_PROVISIONING_MODE=hybrid` است و ساخت اولیه از env همراه مدیریت مجاز پنل فعال می‌ماند. با انتخاب صریح `STAFF_PROVISIONING_MODE=env`، ایجاد/پذیرش دعوت کارمندی و تغییر نقش، زبان، quality scope و مجوز CRM از API با `403 STAFF_ENV_MANAGED` رد می‌شود؛ خواندن فهرست، لغو دعوت و تحویل/غیرفعال‌سازی مجاز باقی می‌مانند. `GET /users` علاوه بر `items`، مقادیر `provisioningMode,canCreate,canManageGrants` و فهرست دعوت‌ها `provisioningMode,canInvite` را برمی‌گرداند. قرارداد دعوت زیر در حالت‌های `hybrid` و `panel` فعال است. ثبت‌نام عمومی در همه حالت‌ها فقط مشتری می‌سازد. راهنمای ایجاد همه نقش‌ها، sync صریح، چرخش رمز و فعال‌سازی از محیط: [STAFF-ENV.fa.md](STAFF-ENV.fa.md).

| روش | مسیر | قرارداد |
|---|---|---|
| GET | `/staff/invitations` | `{items,canInvite}`؛ حداکثر ۲۰۰ دعوت قابل مشاهده، بدون token |
| POST | `/staff/invitations` | grant صریح دعوت؛ `201` و DTO دعوت |
| DELETE | `/staff/invitations/:id` | `{expectedVersion}`؛ لغو دعوت تکمیل‌نشده |
| POST | `/staff/invitations/accept` | `{token}`؛ حساب customer فعال با ایمیل تأییدشدهٔ دقیقاً منطبق |
| GET | `/staff/:userId/handover` | پیش‌نمایش تازهٔ کارهای باز و گیرندگان مجاز |
| POST | `/staff/:userId/offboard` | `{expectedWorkspaceVersion,planHash,reason,assignments}`؛ انتقال کامل و غیرفعال‌سازی اتمیک |

بدنهٔ دعوت: `email,role,allowedLocales,qualityScope?,crmScope?,crmPermissions?,teamIds?,territoryIds?,locale?,expiresInHours?`. نقش customer برای دعوت کارمندی پذیرفته نمی‌شود. زبان‌ها از پنج زبان سایت و بدون تکرارند؛ translator زبان فارسی نمی‌گیرد. پیش‌فرض کیفیت false، scope برابر assigned، permissionهای CRM false و گروه‌ها خالی است. زمان اعتبار از ۱ تا ۱۶۸ ساعت با پیش‌فرض ۷۲ است. **فقط superAdmin جاری** دعوت کارمندی ایجاد می‌کند؛ زبان/کیفیت/گروه و اختیارات دعوت نمی‌توانند مجوز جاری دعوت‌کننده را دور بزنند. admin فقط دامنهٔ مدیریتی مجاز خودش را می‌بیند.

توکن ۶۴رقمی hex فقط به‌صورت هش ذخیره می‌شود و کد خام در payload رمزگذاری‌شدهٔ پیام دعوت است؛ پاسخ فهرست/ایجاد و audit آن را برنمی‌گردانند. پیام به صفحهٔ account/security راهنمایی می‌کند و کد در فرم پذیرش وارد می‌شود؛ کد در query URL قرار نمی‌گیرد. پذیرش، ایمیل تأییدشدهٔ فعلی، حساب موردنظر، انقضا، مصرف‌نشدن و اختیارات جاری دعوت‌کننده را در تراکنش بررسی می‌کند. صرف تشابه نام یا ایمیل یک پروفایل CRM سبب اتصال خودکار حساب نمی‌شود.

پاسخ پذیرش `{accepted:true,signInRequired:true,mfaEnrollmentRequired}` است. همهٔ sessionها و challengeهای قبلی همان حساب باطل می‌شوند؛ ورود مجدد و در صورت نیاز ثبت MFA لازم است. رمز موجود بازنویسی نمی‌شود و «تغییر اجباری رمز» از این پاسخ استنباط نشود. ابطال/انقضا یا ازبین‌رفتن اختیار دعوت‌کننده، پیام دعوت هنوز در صف را هم پیش از provider متوقف می‌کند.

پیش‌نمایش handover شامل `user,workspaceVersion,planHash,items,recipients,blockedCount,canOffboard` است. هر item نوع record/request/task، شناسه، نسخه، مسئولیت owner/assignee و `eligibleUserIds` دارد. بدنهٔ فرمان باید برای **تمام** اقلام تازه دقیقاً یک `{kind,id,toUserId}` بفرستد؛ سقف ۵۰۰۰ و reason بین ۱۰ تا ۲۰۰۰ نویسه است. ایجاد کار تازه، تغییر نسخه/مسئول، یا تغییر scope/کیفیت گیرنده پیش‌نمایش قبلی را نامعتبر می‌کند. task و درخواست محرمانه به گیرنده‌ای با نقش ظاهراً مناسب ولی scope ناکافی منتقل نمی‌شوند.

انتقال record، درخواست و task، ابطال نشست/گروه/دعوت‌های وابسته، audit و `active:false` یک تراکنش‌اند؛ شکست audit همه را rollback می‌کند. خروج خود شخص، خروج آخرین superAdmin و اقدام admin روی admin/superAdmin محافظت می‌شوند. کار باز از مسیر قدیمی `/users/:id` قابل دورزدن نیست. غیرفعال‌سازی حذف فیزیکی یا حذف سوابق نیست.

مرجع: [staff-lifecycle.ts](../src/server/staff-lifecycle.ts)، [typeهای دعوت و handover](../src/types/staff-lifecycle.ts)، [آزمون مستقل PostgreSQL](../tests/server-staff-lifecycle.pg.mjs).

## ۱۴. اتصال صریح سازمان پرتال و account داخلی — 026

| روش | مسیر | نتیجه/ورودی |
|---|---|---|
| GET | `/crm/portal-organizations` | `{items,nextCursor}`؛ `search,limit,cursor` |
| GET | `/crm/portal-organizations/:id` | نمای مدیریتی همان سازمان با account قابل مشاهده |
| GET | `/crm/portal-organizations/:id/accounts` | candidateهای فعلی و مجاز برای اتصال؛ همان query صفحه‌بندی |
| PUT | `/crm/portal-organizations/:id/account` | `{accountId,expectedOrganizationVersion,expectedAccountVersion,expectedAccountRecordVersion,reason}` |
| GET | `/crm/portal-organizations/:id/history` | تاریخچهٔ immutable اتصال، پس از بررسی دسترسی فعلی |

این مسیرها کارمند دارای MFA، مجوز ویرایش accounts، grant تماس و دسترسی واقعی به حساب مبدأ و مقصد را لازم دارند. search حداکثر ۱۲۰ نویسه، limit بین ۱ تا ۵۰ با پیش‌فرض ۳۰ و cursor opaque وابسته به کاربر/فیلتر است. candidate بایگانی‌شده، خارج از scope یا متصل به سازمان فعال دیگری انتخاب نمی‌شود. شناسهٔ account از فهرست مجاز گرفته شود، نه از تطبیق نام یا ایمیل.

نمای مدیریت شامل `id,name,city,country,version,account,linkState,linkedAt,memberCount,sharedRequestCount` است. `account` دارای `id,displayName,version,recordVersion` است؛ هر سه نسخهٔ فرمان اتصال باید از همین دادهٔ جاری گرفته شوند. reason بین ۱۰ تا ۲۰۰۰ نویسه است. اتصال و سابقه و نسخه‌ها اتمیک‌اند و دو فرمان هم‌زمان با نسخه‌های یکسان تنها یک commit دارند. تاریخچه نیز حق خواندن حساب‌های پنهان را ایجاد نمی‌کند.

ایجاد سازمان مشتری ابتدا یک prospect مستقلِ pending/unverified می‌سازد. ویرایش مشتری در نام/شهر/کشور سازمان، هویت و فیلدهای نگهداری‌شده توسط کارکنان در CRM را بازنویسی نمی‌کند. اتصال حساب داخلی به سازمان هیچ عضویت، consent بازاریابی یا share جدیدی نمی‌سازد؛ اشتراک درخواست همچنان فرمان صریح بخش ۵ است. migration 026 برای سازمان‌های از قبل موجود نیز prospect مستقل و سابقهٔ pending می‌سازد و عضویت/اشتراک/رضایت قبلی را تغییر نمی‌دهد؛ ledger مهاجرت قبلاً اجراشده بازنویسی نمی‌شود.

مرجع: [organizations.ts](../src/server/organizations.ts)، [migration 026](../db/migrations/026_portal_crm_accounts.sql)، [آزمون populated upgrade و race/rollback](../tests/server-portal-mapping.pg.mjs).

## ۱۵. فراخوان و پاکت‌های محرمانهٔ مناقصه — 032

### فراخوان عمومی و مدیریت

| روش | مسیر | قرارداد |
|---|---|---|
| GET | `/tenders?locale=fa` | حداکثر ۱۰۰ فراخوان عمومی open/closed؛ `{items}` |
| GET | `/tenders/:id?locale=fa` | هویت revision، متن زبان انتخابی، زمان‌ها و `canSubmit` واقعی |
| GET / POST | `/crm/tenders` | فهرست مدیریتی مجاز / ایجاد draft؛ POST تعریف مستقیم، `201` |
| GET / PUT | `/crm/tenders/:id` | دریافت / `{expectedVersion,value}` برای draft |
| POST | `/crm/tenders/:id/review` | `{expectedVersion,decision:'approved'\|'rejected',reason}`؛ بازبین مستقل |
| POST | `/crm/tenders/:id/state` | `{expectedVersion,status:'open'\|'closed'\|'cancelled'}` طبق فرمان و وضعیت فعلی |
| GET / PUT | `/crm/tenders/:id/reviewers` | GET directory؛ PUT `{expectedVersion,technicalUserIds,financialUserIds}` |
| GET | `/crm/tenders/:id/bids` | پیشنهادهای قابل مشاهده با `search,limit,cursor` |

تعریف فراخوان `{title,summary,opensAt,deadlineAt,timezone}` است. title و summary نقشهٔ پنج‌زبانه‌اند؛ هر title غیرخالی و حداکثر ۲۴۰، summary حداکثر ۱۰۰۰۰ نویسه است. زمان‌ها ISO دارای offset، timezone معتبر IANA و بازهٔ پذیرش مثبت و حداکثر ۳۶۶ روز است. ساخت و تغییر زمان مشترک به اختیار همهٔ زبان‌ها نیاز دارد؛ ویرایش ترجمه به زبان‌های مجاز شخص محدود است. پس از انتشار، متن فراخوان revision ثابت است.

مدیریت واقعی با `capabilities.edit/review/publish/close/manageReviewers` و مجوز فعلی سرور تعیین می‌شود. برای انتشار، revision دقیق باید مستقل تأیید شده باشد و برای زبان‌ها بازبین فنی و مالی واجد اختیارِ جدا وجود داشته باشند؛ حداکثر ۲۵ شناسه در هر گروه. فهرست reviewer از directory واقعی گرفته می‌شود. بستن زودتر فراخوان، قفل زمانی پاکت‌ها را پیش از deadline واقعی باز نمی‌کند.

### ثبت و دسترسی پیشنهاد

| روش | مسیر | قرارداد |
|---|---|---|
| GET | `/me/tender-bids` | فهرست پیشنهادهای خود شخص با `search,limit,cursor` |
| POST | `/tenders/:callId/bids` | submission زیر + `Idempotency-Key`؛ ثبت اتمیک، `201` |
| GET | `/tender-bids/:id` | revision جاری؛ فقط envelopeهای مجاز و `capabilities` |
| PUT | `/tender-bids/:id` | submission + `expectedVersion` و `Idempotency-Key`؛ جایگزینی پیش از مهلت |
| POST | `/tender-bids/:id/withdraw` | `{expectedVersion,reason}`؛ انصراف مجاز مالک |
| GET | `/tender-bids/:id/revisions/:revisionId` | revision تاریخی مجاز؛ شناسهٔ تاریخچه مجوز دیدن محتوا نیست |
| POST | `/crm/tender-bids/:id/technical-review` | `{expectedVersion,decision:'accepted'\|'rejected',reason}` پس از deadline |
| POST | `/crm/tender-bids/:id/finance-open` | `{expectedVersion,reason}`؛ پس از پذیرش فنی معتبر توسط شخص دیگر |
| GET | `/tender-bids/:id/revisions/:revisionId/envelopes/:kind/assets/:assetId` | فایل private همان envelope؛ kind فقط technical/financial |

submission شامل `callRevisionId,locale,organization,phone,country,technical,financial,consent` است. `technical:{body,assetIds}` و `financial:{body,assetIds,amountDecimal,currency}`؛ متن هر پاکت بین ۲۰ تا ۵۰۰۰۰ نویسه و هرکدام یک تا پنج فایل است. amount رشتهٔ decimal مثبت با حداکثر ۱۵ رقم صحیح و دو رقم اعشار است؛ IRR کسر ندارد. currency از IRR/USD/EUR/TRY/RUB است. consent برابر `{purpose:'request_processing',acceptedAt:ISO}` و ایمیل حساب ثبت‌کننده باید تأیید شده باشد. هر حساب فقط یک پیشنهاد برای یک فراخوان دارد؛ revision جدید همان پیشنهاد را جایگزین می‌کند، نه شناسهٔ دیگری را.

فایل‌ها باید PDF/DOCX خصوصیِ همان مالک، scan-clean، دارای حقوق معتبر و قابل تخصیص به همین پاکت باشند. یک asset در پاکت فنی و مالی مشترک نمی‌شود؛ فایل دارای وابستگی حفظ‌شده به دامنهٔ دیگری، منبع خام DAM یا منبع processing پذیرفته نمی‌شود. revision، contact snapshot، bytes hash و محتوای رمزگذاری‌شدهٔ دو پاکت حفظ می‌شوند. جایگزینی فایل فعلی، حق حذف یا اتصال مجدد فایل تاریخی را آزاد نمی‌کند.

کارمند حتی با نقش admin، پیش از deadline به متن یا فایل پاکت‌ها دسترسی ندارد. پس از مهلت، grant فعلی فنی به پاکت فنی و grant مالی پس از گشودن مجاز به مالی دسترسی می‌دهد. پذیرش فنی و گشودن مالی دو شخص جدا هستند و وضعیت فعلی بازبین، زبان، MFA و scope دوباره کنترل می‌شود. فرم عمومی درخواست فقط رسید ایجاد می‌کند و شامل متن/فایل پاکت نیست؛ پیام عادی پرونده جایگزین این گردش نمی‌شود. دانلود dedicated، checksum و scan و حقوق فعلی را زیر همان قفل دسترسی بررسی می‌کند؛ لینک عمومی فایل صادر نمی‌شود.

فهرست‌ها search حداکثر ۱۲۰، limit یک تا ۵۰ با پیش‌فرض ۳۰ و cursor محدود به actor دارند. پس از 409 پیش‌نویس محلی را نگه دارید و نسخهٔ تازه را صریح مقایسه کنید؛ فرمان را با شمارهٔ دلخواه دوباره ارسال نکنید.

مرجع: [tenders.ts](../src/server/tenders.ts)، [DTOهای مشتق‌شده از سرویس](../src/types/tenders.ts)، [آزمون مهلت واقعی، افشای فایل و rollback](../tests/server-tender-envelopes.pg.mjs).

## ۱۶. merge سبد مهمان و فهرست‌های نام‌دار — 027/033

`POST /me/collection/merge` پس از ورود `{id:UUID,locale,items}` می‌گیرد. items یک تا ۵۰۰ خط با schema سبد بخش ۴ است. شناسهٔ id را برای **همان intent** در retry حفظ کنید. قفل collection و رسید immutable، افزودن را اتمیک و دقیقاً یک‌بار می‌کنند؛ همان id با حساب یا محتوای دیگر `409 IDEMPOTENCY_CONFLICT` می‌دهد. پاسخ `{collection,summary,duplicate}` است و summary شامل `sourceLines,addedLines,combinedLines,totalLines` است.

خطوط هم‌هویت تنها در صورت note یکسان تجمیع می‌شوند؛ مقدار بیش از ۱۰۰۰۰۰ و بیش از ۵۰۰ خط پذیرفته نیست. وضعیت عمومی محصول، variant و مشخصات SKU/unit/shade/mould در زبان merge از سرور کنترل می‌شود. هر خط نامعتبر کل merge را با `422 INQUIRY_MERGE_REVIEW` و `issues[{index,code}]` متوقف می‌کند؛ هیچ قسمتی به‌طور پنهان حذف یا اضافه نمی‌شود. retry موفق collection جاری را همراه رسید همان intent برمی‌گرداند؛ تغییرات بعدی کاربر را با snapshot قدیمی جایگزین نمی‌کند.

`GET /me/collection` شمارندهٔ `collectionVersion` می‌دهد و PATCH inquiries/compare باید آن را در بدنه بفرستد. تغییر saved نیازمند `savedVersion` و `savedLocale` است. فهرست‌های نام‌دار از `GET/POST /me/wishlists` و `GET/PUT/DELETE /me/wishlists/:id` مدیریت می‌شوند؛ تغییر/حذف فهرست `If-Match` همان فهرست لازم دارد. کاتالوگ انتخابگر `/me/wishlist-catalog` است. referenceها typed هستند و URL خام یا private asset دلخواه به معنی قلم عمومی قابل اشتراک نیست.

پیش‌نمایش و ساخت share و جابه‌جایی اقلام فرمان‌های مجزای همان فهرست‌اند؛ مسیرهای دقیق در [wishlists.ts](../src/server/wishlists.ts) و [router.ts](../src/server/router.ts) آمده‌اند. share عمومی همواره منابع **فعلاً عمومی** را دوباره resolve می‌کند؛ note خصوصی، منبع withdrawشده یا مجوز اتاق داده همراه لینک افشا نمی‌شود. خروج/تعویض حساب نباید پیش‌نویس یا cache قبلی را زیر حساب تازه نشان دهد.

مرجع merge: [inquiry-collection.ts](../src/server/inquiry-collection.ts)؛ قرارداد ذخیرهٔ collection: [account.ts](../src/server/account.ts).

## ۱۷. رجیستری گواهی‌های شرکت — 035

| روش | مسیر | قرارداد |
|---|---|---|
| GET | `/company-certificates?locale=fa` | `{items}` عمومی؛ snapshot منتشرشده و وضعیت فعلی، بدون نیاز به session |
| GET | `/company-certificates?manage=true&locale=fa` | `{items,canCreate}`؛ نمای مدیریتی مجاز همان زبان با draft، تاریخچه، نسخه و capabilities |
| GET | `/company-certificates/sources?locale=fa` | فقط ResourceVersion عمومی و واقعاً قابل استفاده؛ زبان واقعی فایل در نتیجه باقی می‌ماند |
| POST | `/company-certificates` | `{slug,locale,definition}`؛ draft، `201` |
| PUT | `/company-certificates/:id` | `{locale,expectedVersion,definition}`؛ revision تازهٔ draft |
| POST | `/company-certificates/:id/review` | `{locale,expectedVersion,decision:'approved'\|'rejected',reason?}` |
| POST | `/company-certificates/:id/publish` | `{locale,expectedVersion}`؛ انتشار همان revision بازبینی‌شده |
| POST | `/company-certificates/:id/withdraw` | `{locale,expectedVersion,reason}`؛ لغو فقط همان زبان |
| POST | `/company-certificates/:id/revoke` | `{locale?,expectedVersion,reason}`؛ ابطال سراسری هویت گواهی |
| POST | `/company-certificates/:id/state` | `{locale?,expectedVersion,archived,reason}`؛ archive/restore مدیریتی |

تعریف شامل `title,summary,issuer,certificateNumber,standard,validFrom,validUntil,issuerUrl,resourceId,resourceVersionId` است. عنوان/صادرکننده/استاندارد حداکثر ۲۴۰، شماره حداکثر ۲۰۰ و summary حداکثر ۵۰۰۰ نویسه‌اند. تاریخ‌ها روز واقعی میلادی `YYYY-MM-DD` بین ۱۹۰۰ تا ۲۲۰۰ هستند؛ روز پایانی اعتبار شامل همان روز UTC است. URL صادرکننده خالی یا HTTPS بدون credential است. هر دو شناسهٔ resource باید هم‌زمان null یا UUID معتبر باشند. slug یکتا، ۲ تا ۱۲۰ نویسه و حروف کوچک لاتین/عدد با hyphen است.

draft ناقص قابل ذخیره است. برای approval و publication، عنوان، توضیح، صادرکننده، شماره، استاندارد، دو تاریخ و **نسخهٔ دقیق منبع عمومیِ منتشرشده و مستقلاً بازبینی‌شده** الزامی‌اند؛ issuerUrl به‌تنهایی سند جایگزین نیست. انتخابگر فایل خصوصی یا نسخهٔ غیرجاری را افشا نمی‌کند. زبان فایل می‌تواند با زبان صفحه متفاوت باشد و باید صریح نمایش داده شود. اطلاعات و سند واقعی باید توسط مالک سامانه تأمین شوند؛ دادهٔ نمونهٔ معتبرنمای گواهی نصب نمی‌شود.

هر mutation، `ManagedCompanyCertificate` مستقیم برمی‌گرداند. `version` شمارندهٔ خود گواهی در تمام زبان‌هاست، نه شمارندهٔ workspace. دسترسی هر عملیات به منابع و locale جاری متکی است؛ بازبین مستقل quality scope لازم دارد. revoke/archive سراسری به اختیار همهٔ زبان‌های موجود وابسته است؛ انتشارهای هر زبان snapshot مستقل و immutable دارند. ذخیرهٔ draft نسخهٔ زندهٔ قبلی را تغییر نمی‌دهد. revoke قابل برگشت به «معتبر» نیست؛ تمدید/صدور جدید هویت جدا می‌خواهد.

وضعیت عمومی از `current,expiring,expired,not-yet-valid,revoked,source-unavailable` است. آستانهٔ expiring سی روز است. مدخل تاریخی منتشرشده می‌تواند expired/revoked را نشان دهد؛ این برچسب ادعای گواهی جاری نیست. source نامعتبر یا خارج از دسترس لینک قابل دانلود نمی‌دهد. archive یا withdrawal مدخل مربوط را از انتشار خارج می‌کند.

worker برای revision/گیرنده/نوع expiring یا expired یک alert بادوام با dedupe می‌سازد؛ اعلان فقط in-app و تابع ترجیح requests، quiet hours و digest است. در dispatch، وضعیت گواهی، source، زبان، quality scope و اختیار فعلی گیرنده دوباره کنترل می‌شوند. نتیجهٔ queued/suppressed با تحویل واقعی اشتباه گرفته نمی‌شود. این بخش به provider واقعی پیام خارجی نمی‌فرستد.

مرجع: [company-certificates.ts](../src/server/company-certificates.ts)، [DTOهای دقیق](../src/types/company-certificates.ts)، [راهنمای اپراتور](COMPANY-CERTIFICATES.fa.md)، [آزمون PostgreSQL](../tests/server-company-certificates.pg.mjs).

## ۱۸. فعالیت، وظیفه و یادآوری پذیرفته‌شده — 019/036

| روش | مسیر | قرارداد |
|---|---|---|
| GET | `/crm/records/:recordId/timeline` | timeline داخلی مجاز با cursor و limit |
| POST | `/crm/timeline` | ثبت call/meeting/note با زمان رخداد جدا از زمان ثبت سرور |
| PATCH / DELETE | `/crm/timeline/:id` | تغییر مجاز با `If-Match` همان ورودی و audit |
| GET / POST | `/crm/tasks` | فهرست با `recordId?` / ساخت تعریف task و رخدادهای محدود، `201` |
| GET | `/crm/tasks/:id` | تعریف، generation و occurrences فعلی/تاریخی مجاز |
| PUT / DELETE | `/crm/tasks/:id` | تعریف تازه/لغو با `If-Match` سری task |
| PATCH | `/crm/task-occurrences/:id` | `{status:'completed'\|'cancelled'}` و `If-Match` همان رخداد |
| POST | `/crm/reports/forecast` | محاسبه از مرحله و probability معتبر سرور با scope جاری |
| GET / POST | `/crm/reports/snapshots` | فهرست/ثبت snapshot گزارش immutable |
| GET | `/crm/reports/snapshots/:id` | خواندن snapshot پس از کنترل مجدد scope منابع آن |
| GET / POST | `/crm/success-plans` | فهرست با `recordId` / ثبت برنامهٔ موفقیت مشتری |
| PUT | `/crm/success-plans/:id` | تغییر نسخه‌دار با `If-Match` |
| GET / POST | `/crm/surveys` | فهرست با `requestId` / دعوت محدود survey |
| DELETE | `/crm/surveys/:id` | لغو دعوت مجاز؛ پاسخ عمومی survey در بخش ۱۲ است |

تعریف task شامل `recordId,assigneeUserId,title,body,due,recurrence,reminderMinutes` است. due یا `{kind:'instant',at:ISO}` یا `{kind:'date',date:'YYYY-MM-DD',timezone:IANA}` است؛ تاریخ بدون ساعت با لحظهٔ UTC یکی فرض نمی‌شود. recurrence برابر null یا `{frequency:'daily'|'weekly'|'monthly',interval:1..30,count:1..52}` و reminderMinutes بین ۰ تا ۱۰۰۸۰ است. رخدادها محدود و از قبل بسط داده می‌شوند؛ replan، generation تازه می‌سازد و تاریخچهٔ تکمیل‌شده را بازنویسی نمی‌کند. گیرنده باید مسئول واقعی و در scope فعلی همان record باشد.

`reminderStatus` از pending/queued/delivered/cancelled/failed/uncertain است. **queued به معنی enqueue است** و `remindedAt` پذیرفته‌شدن هنوز null است. quiet hours و digest همین حالت را تا پذیرش واقعی نگه می‌دارند. فقط commit اعلان in-app یا پذیرش batch مجاز، رخداد منبع را delivered می‌کند. تکمیل/لغو/replan، تغییر مسئول، غیرفعال‌شدن حساب یا لغو کیفیت/نقش/scope، نسخهٔ صف‌شدهٔ قدیمی را بی‌اثر می‌کند. ارسال به مسئول قبلی با claim قدیمی مجاز نمی‌شود.

در migration 036، رسیدهای تاریخی که واقعاً در notifications ثبت و همراه وضعیت delivered commit شده‌اند حفظ می‌شوند؛ timestamp قبلی به زمان enqueue فرضی تبدیل نمی‌شود و یادآوری مجدد ساخته نمی‌شود. آزمون populated upgrade این مسیر تاریخی را با رسید واقعی بررسی می‌کند. دلیل این migration افزودن مسیر مشترک سیاست/صف و تکمیل قابل‌ردیابی است، نه بازنویسی دلخواه شواهد پیشین.

گزارش از probability نسخهٔ تأییدشدهٔ pipeline استفاده می‌کند؛ مبلغ نامعلوم با صفر یکی نیست و ارزها جمع بی‌معنا نمی‌شوند. success plan یا survey به‌تنهایی پروندهٔ کیفیت را نمی‌بندد و پاسخ مشتری را testimonial عمومی نمی‌کند. مرجع: [crm-operations.ts](../src/server/crm-operations.ts)، [آزمون رقابت dispatch و closure](../tests/server-task-reminder-policy.pg.mjs)، [آزمون حفظ رسید تاریخی](../tests/server-task-reminder-upgrade.pg.mjs).

## ۱۹. واژه‌نامه، metadata واقعی SEO و آدرس‌های منبع

واژه‌نامه collection واقعی `glossary` در workspace است و CRUD، ترجمه، review مستقل، publish، schedule و restore معمول CMS را دارد؛ endpoint موازی برای دورزدن انتشار تعریف نشده است. `title` اصطلاح و `summary` تعریف پنج‌زبانه‌اند. aliasها در `details.glossary:{schemaVersion:1,aliases:{fa?:string[],en?:string[],tr?:string[],ar?:string[],ru?:string[]}}` ذخیره می‌شوند؛ برای هر زبان حداکثر ۱۲ alias، هرکدام ۲ تا ۱۰۰ نویسهٔ literal و بدون کاراکتر کنترلی. aliasهای نرمال‌شدهٔ تکراری رد می‌شوند. translator فقط زبان‌های مجاز خودش را تغییر می‌دهد و source provenance یا ساختار را دستکاری نمی‌کند.

خروجی عمومی glossary فقط title/definition و alias همان locale منتشرشده را دارد. تطبیق اصطلاح literal است، regex دلخواه اجرا نمی‌شود، alias مبهم چند اصطلاح نادیده گرفته می‌شود و تعداد پردازش‌ها محدود است. نسخهٔ اولیه دوازده تعریف موجود در رابط قبلی را با منبع مشخص به‌صورت **draft بازبینی‌نشده** وارد می‌کند؛ نصب، بازبینی علمی یا انتشار خودکار محسوب نمی‌شود. import مجدد ویرایش اپراتور یا حذف حفظ‌شده را برنمی‌گرداند و fallback عمومیِ تعاریف منتشرنشده وجود ندارد. مرجع: [آزمون منبع و انتشار glossary](../tests/server-glossary.pg.mjs) و validatorهای workspace.

متن کامل و metadata SEO محدود در `details.editorialContent` همراه content revision نگهداری می‌شوند؛ `body` نقشهٔ متن زبان‌ها و `seo` نقشهٔ اختیاری locale به metadata همان زبان است. metadata فقط کلیدهای سازگار با نوع منبع، مانند article/video/event/job را می‌پذیرد؛ `publication.seo` فقط metadata همان انتشار است. Article/Video/Event/Job فقط زمانی JSON-LD مربوط را می‌دهند که فیلدهای واقعی لازم ثبت، معتبر و منتشر شده باشند؛ editor محل تزریق arbitrary JSON-LD نیست. نویسنده، تاریخ، حقوق، آدرس یا دستمزد از روی حدس ساخته نمی‌شود. شغل بسته/منقضی آگهی فعال محسوب نمی‌شود و `jobRecordId` هنگام ایجاد درخواست نیز زیر قفل منبع فعلی کنترل می‌شود. schema و parser مشترک در [editorial-seo.ts](../src/lib/editorial-seo.ts) است.

redirectهای منبع خارج از پیشوند API هستند: جدول محدود و منبع‌دارِ مسیرهای قدیمی `/pages/...` پاسخ اولیهٔ **301** به مقصد عمومی فعلی می‌دهد؛ شناسه/alias ناشناخته یا منبع withdrawشده 404 است و query مقصد دلخواه نمی‌سازد. مسیر معمول صفحه با قاعدهٔ جداگانهٔ 308 به اسلش نهایی می‌رود. این قواعد نه URL دلخواه تولید می‌کنند، نه source پنهان را از کاتالوگ اولیه زنده می‌کنند؛ visibility همان بخش ۲ مرجع مشترک است.

## ۲۰. scope، دامنهٔ CRM، قیمت‌نامه، pipeline و واگذاری

`GET /crm/scopes` دایرکتوری و اختیار مؤثر فعلی را می‌دهد. `ownerId`، `assigneeId`، `teamId` و `territoryId` هویت‌های واقعی‌اند؛ فیلد legacy `owner` نقش است و جای مالک یا مسئول را نمی‌گیرد. برای نقش‌های غیرمدیریتی، نبود grant صریح دسترسی را assigned نگه می‌دارد و تماس/مالی/base-cost/assign/intake را باز نمی‌کند. admin/superAdmin در collectionهای مجاز نقش خود scope مؤثر all و permissionهای مدیریتی دارند؛ quality scope و مجوز نوع عملیات همچنان جدا بررسی می‌شوند. برداشتن فیلدهای protected از نمای شخص، اجازهٔ حذف یا صفرکردن آن‌ها در ذخیرهٔ دوباره نیست.

| روش | مسیر | گردش و مرجع |
|---|---|---|
| GET / POST | `/crm/teams` و `/crm/territories` | گروه‌های واقعی؛ ساخت فقط با مدیریت مجاز |
| PATCH / DELETE | `/crm/teams/:id` و `/crm/territories/:id` | `If-Match`؛ DELETE غیرفعال‌سازی است |
| PUT / DELETE | `/crm/teams/:id/members/:userId` و معادل territories | عضویت صریح با `If-Match` گروه |
| POST | `/workspace/assign` | فرمان تخصیص با نسخهٔ workspace؛ دسترسی جاری به record و مقصد لازم است |
| GET / PUT | `/crm/records/:recordId/domain` | تعریف typed حساب/مخاطب/سرنخ/فرصت/نمونه/هندآف/شریک؛ PUT شامل `{expectedVersion,value}` |
| POST | `/crm/leads/:id/convert` | تبدیل اتمیک صلاحیت پذیرفته‌شده به account/contact/opportunity؛ بدون تبدیل ظاهری با patch وضعیت |
| POST | `/crm/samples/:id/transition` | انتقال مرحلهٔ مجاز، shipment/evaluation و ارجاع کیفیت |
| POST | `/crm/handoffs/:id/transition` | تفکیک وضعیت داخلی/بیرونی، مدرک و reconciliation وضعیت uncertain |
| GET | `/crm/records/:id/evidence/:assetId` | مدرک خصوصی با مجوز فعلی همان record؛ جایگزین URL عمومی media نیست |
| GET | `/crm/pricebooks/versions` | revisionهای قیمت‌نامهٔ معتبر و قابل انتخاب |
| GET / PUT | `/crm/commercial-policy` | سقف تخفیف و سیاست تجاری نسخه‌دار با اختیار مدیریتی لازم |
| GET / POST | `/crm/pipelines` | فهرست و ساخت pipeline |
| PUT | `/crm/pipelines/:id` | ذخیرهٔ draft نسخه‌دار مراحل و probability |
| POST | `/crm/pipelines/:id/approve` | تصویب مستقل و mapping صریح مرحلهٔ حذف‌شدهٔ دارای فرصت |
| GET | `/crm/routing` | تقویم‌ها و قواعد واگذاری مجاز |
| POST | `/crm/calendars` | تعریف مستقیم تقویم تجاری |
| PUT | `/crm/calendars/:id` | `{expectedVersion,value}` تقویم |
| POST | `/crm/routing-rules` | تعریف مستقیم قاعدهٔ تخصیص |
| PUT | `/crm/routing-rules/:id` | `{expectedVersion,value}` قاعده |
| GET | `/crm/request-routing/:requestId` | مسئول، تقویم snapshot و مهلت‌های قابل مشاهدهٔ همان درخواست |

هر domain view capabilityهای واقعی مانند قابلیت ویرایش، تبدیل، transition و visibility تماس/مالی را برمی‌گرداند. اگر ارتباط account/contact از نمای فرصت حذف شده، کلاینت برای آن [] یا null ساختگی نسازد؛ قرارداد حفظ فیلد پنهان سرویس را رعایت کند. affiliationهای تاریخ‌دار، شعب، requestهای چندبه‌چند فرصت، snapshot اقلام و توافق نماینده مدل مستقل دارند. CRUD عمومی record جایگزین فرمان‌های دامنه‌ای و سابقهٔ آن‌ها نیست.

قیمت‌نامه از collection مربوط در workspace به draft/review مستقل/نسخهٔ immutable می‌رسد؛ صدور quote به revision انتخاب‌شده، بازار/ارز/اعتبار و ceiling جاری نقش مقید است. pipeline نیز probability دلخواه مرورگر را نمی‌پذیرد؛ مرحلهٔ فرصت از revision تصویب‌شده و checklist ورود می‌آید. حذف مرحلهٔ اشغال‌شده بدون mapping مقصد معتبر مجاز نیست.

تقویم IANA ساعات هفتگی و تعطیلات صریح دارد؛ شمارش مهلت بر اساس دقیقهٔ کاری است. round-robin فقط میان اعضای **فعلاً واجد اختیار** تیم در همان تراکنش تخصیص می‌چرخد؛ کیفیت و scope گیرنده حفظ می‌شوند. توقف waiting_customer و ازسرگیری، snapshot تقویم همان پرونده را رعایت می‌کنند. تغییر تقویم جاری نباید گذشتهٔ رسید را بی‌صدا بازنویسی کند.

قراردادهای دقیق بدنه و نتیجه در [workspace-scopes.ts](../src/server/workspace-scopes.ts)، [workspace-domain-core.ts](../src/server/workspace-domain-core.ts)، [workspace-domain-operations.ts](../src/server/workspace-domain-operations.ts)، [workspace-commercial.ts](../src/server/workspace-commercial.ts)، [workspace-pipelines.ts](../src/server/workspace-pipelines.ts) و [workspace-routing.ts](../src/server/workspace-routing.ts) قرار دارند. این مسیرها version مستقل یا workspace version مشخص خود را می‌خواهند؛ آن‌ها را از روی نام فیلد با هم جایگزین نکنید.

## ۲۱. نمای عمومی نمایندگان و مجوز فعالیت — 031

| روش | مسیر | قرارداد |
|---|---|---|
| GET | `/representatives` | `locale,search,country,province,city,family,cursor,limit`؛ `{items,nextCursor,sampledAt}` |
| GET | `/representatives/:slug?locale=fa` | DTO عمومی همان زبان؛ بدون توافق، یادداشت داخلی یا endpoint خصوصی |
| POST | `/representatives/:slug/corrections` | `{locale,name,email,message,consent:true,submittedAt}` و `Idempotency-Key`؛ رسید contact، `201` |
| GET | `/crm/partner-profiles/:partnerRecordId?locale=fa` | نمای profile همان partner، یا null وقتی هنوز ساخته نشده |
| PUT | `/crm/partner-profiles/:partnerRecordId` | `{locale,slug,expectedVersion,value}`؛ ایجاد اولیه با expectedVersion صفر |
| POST | `/crm/partner-profiles/:profileId/commands` | `{action,reason,revisionId?}` و `If-Match` **نسخهٔ profile** |
| GET | `/crm/partner-profiles/:profileId/history?before=…` | تاریخچهٔ مجاز با صفحهٔ حداکثر ۵۰ revision |

شناسهٔ GET/PUT، record شریک داخلی است؛ شناسهٔ commands/history، `id` profile بازگشتی است. action از submit/approve/publish/unpublish/archive/restore/restore-revision و reason از ۱۰ تا ۲۰۰۰ نویسه است. تعریف عمومی شامل `name,summary,country,province,city,address,email,phone,website,coordinates,families,license` است. coordinates یا null یا latitude/longitude معتبر، families زیرمجموعهٔ teeth/materials، و license دارای `number,issuer,validFrom,validTo,state:'verified'|'suspended',verificationNote` است. verificationNote داخلی در DTO عمومی نمایش داده نمی‌شود.

مدیریت profile به partner agreement ساختاریافته و account قابل دسترسی، contact grant، زبان و role/MFA جاری وابسته است. revision به نسخهٔ توافق متصل و مستقلاً بازبینی می‌شود. انتشار دوباره اختیار فعلی بازبین و اعتبار توافق را بررسی می‌کند. انتشار عمومی فقط تا زمانی برقرار است که توافق همان revision فعال و معتبر، partner/account فعال و منبع archiveنشده باشد. تغییر توافق می‌تواند نسخهٔ عمومی قبلی را فوراً از دسترس خارج کند؛ ویرایش draft به‌تنهایی انتشار قدیمیِ هنوز معتبر را تغییر نمی‌دهد.

اعتبار licence از دادهٔ واقعی ثبت‌شده با برچسب current/expiring/expired/not-yet-valid/suspended محاسبه می‌شود. licence منقضی یا معلق **ممکن است روی مدخل تاریخیِ دارای توافق فعال دیده شود** و نباید برچسب معتبر بگیرد؛ انقضای/غیرفعال‌بودن خود توافق، شرط جداگانهٔ visibility است. کشور/شهر/نقشه از همان snapshot عمومی است و هیچ مختصاتی ساخته نمی‌شود. نشانی صفحه `/{locale}/distributors/:slug/` است و sitemap/JSON-LD فقط نمای عمومی مجاز را مصرف می‌کنند.

limit عمومی یک تا ۱۰۰ با پیش‌فرض ۳۰، search حداکثر ۱۲۰ و family یکی از teeth/materials است. فرم اصلاح، دادهٔ profile را مستقیم تغییر نمی‌دهد؛ درخواست قابل پیگیری در workflow کارکنان می‌سازد. مهمان نیز به CSRF عادی و رضایت صریح همان فرم نیاز دارد. مرجع دقیق: [partner-directory.ts](../src/server/partner-directory.ts).

## ۲۲. سایر مسیرهای دامنه‌ای و مرجع اعتبارسنجی

جدول زیر محل قراردادهای مکمل را مشخص می‌کند؛ نام خانوادهٔ مسیر به معنی وجود تمام افعال REST روی هر زیرمسیر نیست. روش و schema دقیق هر فرمان در handler لینک‌شده و [router.ts](../src/server/router.ts) قرار دارد.

| خانواده | مسیرهای پیاده‌شدهٔ اصلی | قید اصلی و مرجع |
|---|---|---|
| جست‌وجوی عمومی منابع | GET `/public/resource-search?locale=fa&q=...&limit=12` | q حداکثر ۱۲۰ و limit یک تا ۳۰؛ خروجی metadata جاری `{items,truncated}`، بدون URL فایل؛ مجوز public/review/scan/حقوق و withdrawal دوباره بررسی می‌شود و ورود کارمند دامنه را گسترش نمی‌دهد. |
| منابع کنترل‌شده | GET `/resources`، GET `/resources/:id`، GET `/resources/:id/versions/:versionId/content`، POST `/resources/bundle`، GET `/resources/manage`، POST `/resources`، PATCH/DELETE `/resources/:id`، POST `/resources/:id/versions` و review/publish | revision مستقل، زبان مجاز، scan/rights/expiry و grant فعلی؛ bundle مجوز اضافه ایجاد نمی‌کند؛ [resources.ts](../src/server/resources.ts) |
| اتاق داده | GET `/me/data-rooms` و `/data-rooms/manage`، POST `/data-rooms`، PATCH/DELETE `/data-rooms/:id`؛ GET/POST `/access-grants` با resourceId/roomId، GET `/access-grants/subjects` و DELETE `/access-grants/:id` | grant صریح و منقضی‌شونده؛ بدون استنباط دسترسی از ایمیل؛ [resources.ts](../src/server/resources.ts) |
| رزرو | GET `/event-sessions` و `/event-sessions/:id/calendar`، GET `/me/bookings`، GET `/event-sessions/manage`، POST `/event-sessions`، PATCH/DELETE `/event-sessions/:id`، GET registrations همان session | ظرفیت واقعی و درخواست در یک تراکنش؛ عنوان محدود به locale و تغییر مشترک محدود به همهٔ زبان‌های مربوط؛ [events.ts](../src/server/events.ts) |
| اجارهٔ ویرایش CMS | GET/POST `/content/leases`، PUT/DELETE `/content/leases/:id` | token مالک اجاره؛ هنگام save/restore/اعمال shared block، هدر `X-Content-Leases` شامل حداکثر ۲۰ token hex جدا با comma؛ [content-collaboration.ts](../src/server/content-collaboration.ts) |
| preview | GET/POST `/content/previews`، DELETE `/content/previews/:id` | snapshot ذخیره‌شده و عمر محدود؛ GET عمومی capability بخش ۱۲، نه draft زنده و باز؛ [content-collaboration.ts](../src/server/content-collaboration.ts) |
| بلوک مشترک | GET/POST `/content/blocks`، GET/PATCH `/content/blocks/:id`، revisions/impact/attach/apply و POST `/content/blocks/detach` | reference به revision immutable، کنترل payload بازشده، locale، lease و نسخهٔ workspace؛ detach صریح؛ [shared-blocks.ts](../src/server/shared-blocks.ts) |
| بخش‌بندی و کمپین | `/crm/segments`، preview/snapshots، `/crm/campaigns`، schedule/cancel، `/crm/suppressions` | segment و snapshot audience جدا، محتوا و ۱ تا ۵ مرحلهٔ محدود، scope جاری و snapshot، consent و suppression هر کانال؛ [crm-campaigns.ts](../src/server/crm-campaigns.ts) و [راهنمای ارتباطات](COMMUNICATIONS.fa.md) |
| ورودی CRM | `/crm/connectors`، rotate-secret، `/crm/inbox-items` و associate؛ webhook `/connectors/:id/events` | HMAC، زمان، dedupe و اتصال صریح به پروندهٔ مجاز؛ [crm-inbox.ts](../src/server/crm-inbox.ts) |
| انتقال CSV | `/crm/transfers`، imports/exports، rows، command و file | preview، تأیید تعداد، اجرای محدود و resume، هر سطر و checkpoint اتمیک، CSV محافظت‌شده در برابر formula و scope مجدد دانلود؛ [crm-transfers.ts](../src/server/crm-transfers.ts) |
| حقوق و مشتق DAM | GET `/media/:id/details`، PUT `/media/:id/rights`، POST `/media/:id/derivatives` | اصل private حفظ می‌شود؛ تغییر غیرمخرب و حقوق/انقضای اجداد؛ [dam.ts](../src/server/dam.ts) |
| processing ویدیو | GET `/media/processing`، POST `/media/:id/processing`، GET `/media/processing/:jobId`، POST commands همان job | منبع MP4 حفظ‌شده، profile محدود، scan واقعی خروجی و عدم ارتقای visibility؛ [media-processing.ts](../src/server/media-processing.ts) |
| دانش برداری | GET/POST `/ai/knowledge`، POST `/ai/knowledge/jobs/:id/cancel`، DELETE `/ai/knowledge/sources/:id` | source عمومی جاری، نسخه/اثر انگشت، سهمیه/صف/حذف انتشار و capability provider؛ [knowledge.ts](../src/server/knowledge.ts) |
| حریم خصوصی | `/privacy/requests`، decision/export/execute، `/privacy/holds` | اختیار صاحب داده، تأیید مستقل erasure، hold دارای علت/انقضا و وابستگی‌های نگهداری؛ دفتر خارجی قبل از restore/writers؛ [privacy.ts](../src/server/privacy.ts) |
| incident و SLO | `/monitoring/incidents` و transitions؛ `/monitoring/slos` | رویداد واقعی، نسخه، audit و اندازه‌گیری محدود؛ فقدان شاهد unknown است؛ [operations-incidents.ts](../src/server/operations-incidents.ts)، [operations-slo.ts](../src/server/operations-slo.ts) |

قالب‌های تراکنشی مسیر اختصاصی بخش ۲۳ را دارند؛ نام تاریخی `/notification-deliveries` alias آزاد نیست و دفتر قالب‌ها از `/communications/deliveries` خوانده می‌شود. گردش‌های typed بالا handler واقعی دارند و نباید با محدودیت‌های checkpoint اولیه «هنوز وجود ندارند» توصیف شوند. منابع اصلی برای تغییر قرارداد [router.ts](../src/server/router.ts)، validator همان سرویس و typeهای [src/types](../src/types) هستند.

وجود endpoint، Dockerfile یا تست، شاهد اجرای آن روی Ubuntu مقصد، provider زنده یا GitHub نیست. نتیجهٔ گیت نهایی و بازیابی در گزارش تحویل `docs/VERIFICATION.fa.md`، وضعیت پوشش در [PRODUCTION-COVERAGE.fa.md](PRODUCTION-COVERAGE.fa.md)، و نحوهٔ اجرا در [DEPLOYMENT.fa.md](DEPLOYMENT.fa.md) و [OPERATIONS.fa.md](OPERATIONS.fa.md) ثبت می‌شود. شواهد پس از بازیابی سورس از نتایج تاریخی جدا ثبت می‌شوند؛ migration ledger موجود برای شبیه‌سازی تطابق checksum بازنویسی نمی‌شود.


## ۲۳. قالب‌های تراکنشی، نسخهٔ پیام و دفتر تحویل (037)

پنل `/{locale}/admin/communications/` از سرویس نوع‌دار قالب‌ها استفاده می‌کند. رکورد JSON عمومیِ قدیمی در collection ارتباطات، کد اجرایی یا قالب فعال نیست. هر ترکیب **رویداد × کانال × زبان** حداکثر یک پروفایل دارد؛ تاریخچه، بازبینی و releaseهای آن مستقل و تغییرناپذیرند. قالب‌ها متن ساده‌اند و همهٔ نمایش‌ها آن را به شکل متن رندر می‌کنند؛ HTML، script، template engine اجرایی و URL دلخواه پذیرفته نمی‌شود.

| روش و مسیر | ورودی/خروجی دقیق |
| --- | --- |
| GET `/communications/templates` | query شامل `locale` (پیش‌فرض fa)، `key?` و `channel?`؛ خروجی `{items,catalog,capabilities}`. catalog فقط رویدادهای ثابت، متغیرهای مجاز، متن پایه و مجوزهای فعلی را دارد. |
| POST `/communications/templates` | `{key,channel,locale,definition:{subject,body}}`؛ پروفایل draft و revision نخست؛ ۲۰۱. تکرار همان ترکیب ۴۰۹ است. |
| GET `/communications/templates/:id` | پروفایل، `version`، `currentRevision`، `activeRelease`، حداکثر ۱۰۰ revision/review اخیر و قابلیت‌های فعلی. |
| PUT `/communications/templates/:id` | `{expectedVersion,definition:{subject,body}}`؛ revision تازه و state=draft؛ release زندهٔ قبلی همچنان برای رویدادهای جدید معتبر می‌ماند تا تغییر صریح آن. |
| POST `/communications/templates/:id/preview` | `{expectedVersion,definition?}`؛ اگر definition داده شود مجوز edit لازم است؛ خروجی `{subject,body,locale,channel,sample:true,limits}` فقط با binding نمونهٔ ثابت و غیرواقعی. پیام یا provider فراخوانی نمی‌شود. |
| POST `/communications/templates/:id/commands` | `{expectedVersion,action,reason?,revisionId?}`؛ action یکی از submit/approve/reject/activate/deactivate/archive/restore/restore-revision. همهٔ پاسخ‌ها پروفایل فعلی را برمی‌گردانند. |
| GET `/communications/deliveries` | query شامل `locale,channel?,state?,limit?,cursor?`؛ limit یک تا ۱۰۰، پیش‌فرض ۳۰؛ `{items,nextCursor}`. فقط مدیر فعلی دارای MFA و زبان انتخاب‌شده؛ فرادادهٔ تحویل‌های دارای snapshot قالب 037، بدون مقصد، متن، token یا payload رمز‌شده. |

همهٔ mutations به cookie جلسه و CSRF عادی نیاز دارند؛ از capability عمومی استفاده نمی‌کنند. `expectedVersion` نسخهٔ پروفایل قالب است و به version سراسری workspace ارتباط ندارد. هویت قالب، زبان و کانال پس از ایجاد تغییرپذیر نیست. mismatch نسخه ۴۰۹ می‌دهد و پنل متن محلی را برای مقایسه و بارگیری صریح نگه می‌دارد.

### فهرست رویداد و دامنهٔ کانال واقعی

| key | کانال متصل به تولیدکنندهٔ فعلی | bindingهای مجاز |
| --- | --- | --- |
| `transactional_message` | email، in-app، sms، telegram، push؛ پیام تراکنشی مجاز به گیرندهٔ ذخیره‌شده | `subject,message`؛ message دقیقاً یک بار در body |
| `request_received`, `request_updated` | in-app، در تراکنش واقعی درخواست/تغییر | `reference` دقیقاً یک بار در body |
| `task_reminder`, `activity_reminder` | in-app با مجوز مسئول فعلی | `subject,message`؛ message الزامی |
| `certificate_expiring`, `certificate_expired` | in-app با وضعیت فعلی و مجوز کیفیت هشدار | `subject,message`؛ message الزامی |
| `password_reset`, `email_verification` | email در همان تراکنش challenge | `actionUrl` دقیقاً یک بار در body |
| `staff_invitation` | email، دعوتِ دقیق و منقضی‌شوندهٔ کارمند | `actionUrl,code,expiresAt` هرکدام دقیقاً یک بار در body |
| `organization_invitation` | email، دعوت عضویت صریح | `actionUrl,organization,inviter`؛ دو مورد اول الزامی |
| `contact_verification`, `contact_preferences` | email، endpoint/نسخه/گیرندهٔ فعلی | `actionUrl` دقیقاً یک بار در body |
| `survey_invitation` | email یا in-app مطابق تولیدکنندهٔ مجاز | `subject,message,actionUrl`؛ message و actionUrl الزامی |

هر ردیف به صورت مستقل در fa/en/tr/ar/ru وجود دارد. شکل جای‌نگهدار فقط `{{name}}` است؛ نام ناشناخته، brace ناقص، شرط/حلقه/helper، HTML و literal URL رد می‌شوند. `actionUrl` و `code` نمی‌توانند وارد subject شوند. نمونهٔ پنل فقط `example.invalid` و شناسه/کد SAMPLE دارد. binding واقعی را producer سرور می‌سازد؛ API عمومی map دلخواه variable یا مقصد template دریافت نمی‌کند. URL واقعی باید هم‌مبدأ سایت باشد.

حد متنِ نهایی: email/in-app عنوان ۲۰۰ و بدنه ۱۰٬۰۰۰ code point؛ SMS عنوان ۱۲۰ و بدنه ۴۰۰؛ Telegram عنوان ۲۰۰ و بدنه ۲۲۰۰؛ Push عنوان ۱۰۰ و بدنه ۳۰۰. validator هنگام save، preview و activate قواعد و اندازهٔ نمونه را می‌سنجد. سرویس‌دهنده همچنین حد نهایی پیام شامل link/footer را کنترل می‌کند. OTP کاوه‌نگار همچنان قالب تأییدشدهٔ اپراتور در `KAVENEGAR_OTP_TEMPLATE` را دارد؛ قالب متن معمولی SMS جای آن را نمی‌گیرد.

### مجوز، بازبینی و رفتار صف

business/support در محدودهٔ خود متن عادی را ایجاد/ویرایش و submit می‌کنند. translator فقط زبان‌های فعلی خود را ویرایش/submit می‌کند؛ publisher متن عادی را بازبینی/فعال می‌کند. قالب‌های امنیتیِ رمز، تأیید و دعوت فقط با اختیار admin/superAdmin تغییر/بازبینی/فعال می‌شوند. همهٔ این نقش‌ها MFA و grant زبانی جاری نیاز دارند؛ تغییر role، inactive شدن یا لغو زبان در سرور دوباره بررسی می‌شود. نویسنده نمی‌تواند revision خود را approve کند. activate نیازمند approve مستقلِ **همان revision** و اختیار فعلی بازبین است. reject، deactivate و archive علت ۳ تا ۱۰۰۰ نویسه می‌خواهند. archive release را متوقف می‌کند؛ restore و restore-revision فقط draft می‌سازند و تأیید تازه لازم دارند.

تولیدکنندهٔ رویداد، outbox و snapshot رندر را در همان transaction می‌نویسد. متن و اطلاعات canonical اصلی دست‌نخورده و رمز‌شده می‌ماند تا کنترل رضایت، scope، نوع گیرنده، کار/دعوت/گواهی فعلی و محتوای بازاریابی بتواند همان دادهٔ واقعی را بررسی کند. متن قالب فقط **پس از عبور از این کنترل‌ها** برای ارسال جایگزین می‌شود. snapshot به outbox/رویداد/کانال/زبان و hash متن با امضای سرور متصل است؛ دست‌کاری، پیش از تماس provider پیام را متوقف می‌کند. audit شکست‌خورده یا rollback دامنه، هم نسخه و هم اثر صف را rollback می‌کند.

نبود release، توقف/بایگانی، لغو اختیار بازبین/ناشر یا بزرگ‌شدن binding واقعیِ یک قالب معتبر از حد کانال، متن پایهٔ همان زبان/کانال را به کار می‌گیرد و دلیل در provenance ثبت می‌شود. catalog/locale نامعتبر یا snapshot خراب fallback پنهان ندارند. ایجاد draft یا انتشار متن جدید، snapshot از قبل صف‌شده را بازنویسی نمی‌کند. توقف صریح releaseهای قبلی با ترتیب یکنوای audit ثبت می‌شود؛ فعال‌سازی بعدی، نسخهٔ صف‌شدهٔ قبلاً متوقف‌شده را زنده نمی‌کند. هیچ fallback به کانال یا مقصد دیگری وجود ندارد و رضایت همچنان لازم است.

دفتر 037 فقط hash و metadata نگه می‌دارد؛ body، آدرس ایمیل، شماره، device token و token دعوت/بازیابی در آن نیست. `state=delivered` در outbox همراه receipt نوع `accepted` به معنای پذیرش SMTP/API یا درج اتمیک in-app است، نه اثبات خواندن یا تحویل نهایی مخابراتی. رکوردهای پیش از 037 و محتواهای مستقل کمپین، در این دفتر **snapshot ساختگی تازه نمی‌گیرند**؛ پایش عمومی صف در `/{locale}/admin/monitoring/notifications/` برقرار است. suppressionهای مجاز از همان سرویس کمپین در پنل ارتباطات نمایش داده می‌شوند. محتوای بازاریابی/انتشار عمومی از review و snapshot مستقل خود استفاده می‌کند.

مرجع: [catalog و parser](../src/lib/notification-template-catalog.ts)، [سرویس قالب](../src/server/notification-templates.ts)، [schema 037](../db/migrations/037_notification_templates.sql)، [پنل](../src/components/workspace/NotificationTemplateCenter.tsx)، [تست واقعی PostgreSQL](../tests/server-notification-templates.pg.mjs) و [سناریوی مرورگر](../tests/e2e/notification-templates.spec.ts). تنظیم و محدودیت providerها در [COMMUNICATIONS.fa.md](COMMUNICATIONS.fa.md) است؛ موفقیت mock به عنوان ارسال واقعی گزارش نمی‌شود.


## ۲۴. فرمان‌های فرم و بازبینی ویرایشگر (038)

راهنمای کاربر: [EDITOR-WORKFLOWS.fa.md](EDITOR-WORKFLOWS.fa.md). همهٔ این مسیرها به حساب کارمندی فعال، MFA و مجوز جاری نیاز دارند. mutationها CSRF و `expectedVersion` کلی فضای کاری دارند؛ توکن‌های قفل ویرایش از `X-Content-Leases` ارسال می‌شوند.

| روش | مسیر | ورودی / خروجی |
|---|---|---|
| GET | `/workspace/forms?status=all&limit=50&cursor=…` | status از active/archived/deleted/all؛ limit از ۱ تا ۱۰۰؛ `{items,version,canCreate,nextCursor}` |
| GET | `/workspace/forms/:id` | `{item,version}`؛ item شامل form، status، capabilities و ارجاع‌های فعلاً مجاز است؛ responses در این DTO خالی است. |
| POST | `/workspace/forms` | `{id?,value:{title,fields},expectedVersion}`؛ فرم فعال تألیف و `{state,version}` با HTTP 201 |
| PUT | `/workspace/forms/:id` | `{value:{title,fields},expectedFormVersion,expectedVersion}`؛ نسخهٔ مبنای فرم الزامی؛ `{state,version}` |
| POST | `/workspace/forms/:id/lifecycle` | `{operation,reason,expectedFormVersion,expectedVersion}`؛ operation یکی از archive/delete/restore؛ reason بین ۸ تا ۵۰۰ نویسه؛ `{state,version}` |
| GET | `/workspace/forms/:id/revisions?locale=fa` | `{revisions,version}`؛ حداکثر ۱۰۰ revision واقعی schema بدون پاسخ‌های مشتری |
| POST | `/workspace/forms/:id/restore` | `{revisionId,expectedFormVersion,expectedVersion}`؛ restore فقط برای فرم فعال و قابل ویرایش، با حفظ پاسخ‌ها |
| GET | `/workspace/revisions/:revisionId` | `{revision,bucket,snapshot,version}`؛ records/pages/forms؛ بررسی دسترسی جاری و snapshot تاریخی، خروجی محدود به همان زبان و فیلدهای قابل مشاهده |
| GET | `/workspace/translations?bucket=records&id=…&locale=en&sourceLocale=fa` | bucket از records/pages؛ وضعیت unknown/current/stale/unconfirmed/missing_source/missing_translation و شناسهٔ revisionهای واقعی؛ GET تغییر نمی‌دهد. |
| POST | `/workspace/translations/acknowledge` | `{bucket,id,locale,sourceLocale,sourceRevisionId,targetRevisionId,expectedUpdatedAt,expectedVersion}`؛ رابطهٔ immutable، بررسی نسخهٔ مبدأ و مقصد، timestamp مقصد و مجوز زبان جاری؛ `{state,version}` |

`title` و هر `field.label` نقشهٔ fa/en/tr/ar/ru با متن حداکثر ۳۰۰ نویسه‌اند. fields حداکثر ۵۰ مورد با شناسهٔ پایدار و type یکی از text/email/textarea/select/date دارد. options حداکثر ۱۰۰ گزینه و condition شناسهٔ فیلد پیشین است. نام‌های رزروشده و وابستگی معکوس رد می‌شوند. تغییر ساختار مشترک فقط با مجوز هر پنج زبان انجام می‌شود؛ label-only فقط زبان‌های مجاز را تغییر می‌دهد.

`delete` انتقال قابل بازگردانی به سطل بازیافت است و فقط پس از archive پذیرفته می‌شود؛ پاسخ و revision حذف فیزیکی نمی‌شوند. ارجاع جاریِ پیش‌نویس/انتشار/برنامه مانع archive/delete است. `blocked` می‌تواند بدون فهرست نام‌های غیرمجاز true باشد و تعداد/هویت منابع حفاظت‌شده افشا نمی‌شود. restore هیچ انتشار عمومی نمی‌سازد و شناسهٔ سطل بازیافت قابل استفاده برای create تازه نیست.

قفل‌های `/content/leases` اکنون bucket forms را نیز می‌پذیرند. GET/POST پیش‌نمایش اشتراکی همچنان فقط pages/records است؛ پیش‌نمایش عمومی فرم مستقل تعریف نشده است. schema متصل به صفحه باید از فرم فعال و نسخهٔ واقعاً ذخیره‌شده/نگه‌داشته‌شده بیاید. نسخهٔ متصل به انتشار قبلی با ویرایش فرم تغییر نمی‌کند.

`SOURCE_CHANGED` با HTTP 409 یعنی مبنای فرم، منبع تأیید restore یا revisionهای مقایسه عوض شده‌اند؛ مقدار گرفته‌شده از ویرایشگر قدیمی نباید با شمارهٔ تازه جایگزین و دوباره ارسال شود. ابتدا پیش‌نویس حفظ/خروجی و نسخهٔ تازه صریحاً بارگذاری می‌شود. تأیید مبدأ ترجمه، جای review یا publish نیست؛ فقدان رابطه «نامشخص» است و stale حدسی تولید نمی‌شود.

## ۲۵. چرخهٔ صفحه و بازیافت محتوا

مرجع پیاده‌سازی [page-lifecycle.ts](../src/server/page-lifecycle.ts) و راهنمای پنل [EDITOR-WORKFLOWS.fa.md](EDITOR-WORKFLOWS.fa.md) است. مسیرها زیر پیشوند معمول `/api/v1` قرار دارند و به نشست کارمندی فعال، MFA و مجوز جاری نیاز دارند. دریافت فهرست، جزئیات و تاریخچهٔ این API به زبان مجاز محدود است؛ دریافت صفحهٔ حذف‌شده، مجوز بایگانی را هم می‌خواهد.

| روش | مسیر | قرارداد |
| --- | --- | --- |
| GET | `/workspace/pages?locale=fa&status=all&limit=50&cursor=…` | status از active/archived/deleted/all، limit از ۱ تا ۱۰۰؛ `{items,version,nextCursor}` شامل page، وضعیت چرخه، capabilities و وضعیت انتشار هر مورد. |
| GET | `/workspace/pages/:id` | `{item,version}`؛ وضعیت و مجوز واقعیِ همین منبع ذخیره‌شده. |
| POST | `/workspace/pages/:id/lifecycle` | `{operation,reason,expectedVersion,expectedPageVersion,expectedUpdatedAt}`؛ operation از archive/delete/restore و reason بین ۸ تا ۵۰۰ نویسه؛ `{state,version}`. |
| GET | `/workspace/pages/:id/revisions?locale=fa` | `{revisions,version}`؛ حداکثر ۱۰۰ revision همان صفحه و زبان؛ دسترسی به snapshot از مسیر عمومی revision با کنترل مجوز تاریخی انجام می‌شود. |

mutation به CSRF و در صورت وجود قفل ویرایش فعال، `X-Content-Leases` همان ویرایشگر نیاز دارد. `expectedUpdatedAt` و `expectedPageVersion` باید از صفحه‌ای بیایند که تأیید عملیات با آن باز شده است. تعارض هر مبنا با `409 SOURCE_CHANGED` و قفل ویرایش متعلق به نشست دیگر با `423 CONTENT_LOCKED` رد می‌شود. مجوزها زیر قفل workspace از حساب جاری دوباره خوانده می‌شوند.

archive و delete به مجوز بایگانی همان زبان نیاز دارند؛ اگر انتشار زنده یا برنامهٔ انتشار وجود داشته باشد، مجوز انتشار هر زبان متأثر نیز الزامی است. خارج‌کردن نسخهٔ زنده، لغو زمان‌بندی، ابطال پیش‌نمایش، حفظ نشانگر عدم احیای محتوای اولیه و ثبت audit با تغییر وضعیت در یک تراکنش انجام می‌شوند. delete مستقیم روی صفحهٔ فعال نیز پذیرفته می‌شود؛ برخلاف فرم، بایگانی قبلی شرط آن نیست.

restore به مجوز بایگانی و ویرایش همان زبان نیاز دارد. منبع نگهداری‌شده به draft و revision تازه، بدون تأیید یا برنامه برمی‌گردد؛ انتشارهای قبلی و پیش‌نمایش‌ها غیرفعال باقی می‌مانند. `PAGE_SLUG_IN_USE` با 409، تعارض هویت و مسیر را مشخص می‌کند. revision، تأیید تاریخی، مراجع فایل و پاسخ‌های فرم حذف فیزیکی نمی‌شوند. `PUT /workspace` برای بایگانی، حذف یا احیای صفحهٔ نگهداری‌شده جایگزین این فرمان نیست.

پاسخ mutation از قرارداد اصلی `getWorkspace` پیروی می‌کند؛ نمایش صفحات زبان‌های دیگر برای مقایسهٔ ترجمه در آن قرارداد حفظ شده است و مجوز زبان در تغییرات دوباره اعمال می‌شود. DTO فهرست و جزئیات این API، قرارداد محدودتر همان زبان را دارند.

صفحات `privacy` و `terms` به دلیل توضیح قرارداد حریم خصوصی/رضایت، برای هرگونه ایجاد، ویرایش، تغییر slug، review، انتشار/زمان‌بندی، خروج از انتشار، بایگانی و restore به اختیار **مدیر جاریِ settings با MFA** نیاز دارند. خواندن منبع برای نقش‌های مجاز صفحات باقی می‌ماند؛ ویرایشگر عادی نمی‌تواند با rename، restore تاریخی، shared block یا job قدیمی این مرز را دور بزند. بررسی مستقل و دامنه زبان مدیر همچنان الزامی است؛ این شرط به‌تنهایی تأیید انتشار محسوب نمی‌شود.

## سیاست جاری حجم فایل و ذخیره‌سازی — 039

| روش | مسیر | قرارداد |
| --- | --- | --- |
| GET | `/media/policy` | `{version,maxFileBytes,byType,maxRequestBytes,allowedMimeTypes,canUploadLibrary,canUploadAttachment}`؛ حد مؤثر نشست/مهمان، بدون مصرف کل، سهمیه کل یا داده کارکنان؛ `no-store` |
| GET | `/admin/storage-policy` | مدیر جاری با MFA؛ `{version,limits,source,updatedAt,usage,hardMaxFileBytes,canEdit}` |
| PUT | `/admin/storage-policy` | مدیر جاری با MFA و CSRF؛ `{expectedVersion,limits}`؛ پاسخ همان DTO مدیریتی و خطای `409 STORAGE_POLICY_CONFLICT` برای مبنای قدیمی |
| GET | `/me/storage` | فقط مصرف و سهمیه حساب جاری؛ `storedBytes,reservedBytes,quotaBytes` به شکل رشته بایت |

`limits` شامل `maxFileBytes`، `byType:{image,document,video,audio}`، `totalBytes`، `userBytes` و `guestBytes` است. تمام مقادیر صحیح مثبت هستند؛ سقف عمومی و هر نوع حداکثر `83886080` بایت است. سقف نوع از سقف عمومی و سهمیه حساب/مهمان از سهمیه سایت بیشتر نمی‌شود. `usage` شامل `storedBytes,reservedBytes,quotaBytes` رشته‌ای است. نوع واقعی فایل، ظرفیت رزروهای هم‌زمان و سیاست هنگام commit دوباره کنترل می‌شوند. کاهش سهمیه داده موجود را حذف نمی‌کند؛ seed/restart هم سیاست ذخیره‌شده مدیر را بازنویسی نمی‌کند.

هر درخواست multipart یک `file` دارد و بدنه حداکثر حد فایل مؤثر به‌اضافه `65536` بایت سربار است. سقف حفاظتی HTTP مستقل از تنظیم پایین‌تر مدیر `83951616` بایت است. جزئیات قالب، اسکن، quota، خطاها و تنظیمات اولیه در [UPLOAD-STORAGE.fa.md](UPLOAD-STORAGE.fa.md) آمده است. قراردادهای TypeScript در [upload-policy.ts](../src/lib/upload-policy.ts) مشترک سرور/مرورگر هستند.

## دفتر ثبت شناسه محصول — 041

`GET /public/product-registry?code=…&locale=fa` استعلام دقیق با حد ۳۰ درخواست در دقیقه و پاسخ `no-store/noindex` است. پاسخ نامطابق `{matched:false,code,locale,state:"not_registered"}` است؛ پاسخ مطابق علاوه بر `matched:true,state:"registered"` فقط `kind,status,product:{id,name},batchCode` دارد. مطابقت با دفتر به معنی تعیین اصالت فیزیکی نیست. هیچ کدی در seed ساخته نمی‌شود.

مسیرهای مدیریتی `GET/POST /admin/product-registry`، `PATCH /admin/product-registry/:id` و `POST /admin/product-registry/:id/lifecycle` به مدیر جاری settings با MFA و برای mutation به CSRF نیاز دارند. DTO مشترک در [product-registry.ts](../src/lib/product-registry.ts) و قرارداد کامل CAS، بایگانی و خطاها در [PRODUCT-REGISTRY.fa.md](PRODUCT-REGISTRY.fa.md) آمده است. کد/نوع هویت ثابت‌اند و محصول، بچ، وضعیت و یادداشت داخلی با نسخه فعلی تغییر می‌کنند؛ بایگانی تاریخچه را حذف نمی‌کند.


## Release 2.2 additions

All paths below are relative to `/api/v1`. Existing authentication, CSRF, request limits, MFA, role and current-record authorization remain in force. Public reads never return private CRM or unpublished drafts.

| Method and route | Contract |
| --- | --- |
| GET `/auth/otp/status` | Availability of customer SMS authentication; no credential values. |
| POST `/auth/otp/request` | Customer phone challenge with expiry, resend cooldown and generic response. Real SMS configuration is required for live delivery. |
| POST `/auth/otp/verify` | Single-use customer challenge redemption; existing customer MFA is retained and staff identities cannot authenticate through this endpoint. |
| GET `/public/search` | `locale`, `q` (max160), optional `kind`/`category`, `limit`1–30 and `offset`; current published results, total and facets. |
| GET `/public/engagement` | Canonical locale-relative `path` without leading/trailing slash and `locale`; public counts and latest50 approved comments. |
| POST `/public/engagement/view` | Bounded per-browser/content window measurement. |
| POST `/public/engagement/comment` | Signed-in comment, initially pending independent moderation. |
| POST `/public/engagement/like` | Authenticated idempotent like state. |
| POST `/public/engagement/report` | Authenticated private content/comment report. |
| GET `/engagement/moderation` | Staff MFA plus moderator role and locale; optional locale/state. |
| PATCH `/engagement/comments/{id}` | Approved/rejected state and `expectedVersion`; independently authorized moderator. |
| PATCH `/engagement/reports/{id}` | Resolved/dismissed state and `expectedVersion`; current moderator scope. |
| GET `/analytics/content` | Authorized staff, `days`1–365, optional permitted locale; full totals with at most1000 detail rows and explicit truncation metadata. |
| GET `/usage` | Authorized organizational or personal scope; AI/provider usage and delivery states, unknown costs remain null. |
| GET `/ai/assist/capabilities` | Server-derived optional areas and permitted languages for the current staff actor. |
| POST `/ai/assist` | Explicit optional suggestion; current role/language authority is checked before and after the provider call. |

`/sitemap.xml` is a sitemap index. `/sitemaps/{locale}-{kind}-{number}.xml` serves bounded live shards. These routes include only valid, publicly available, indexable canonical URLs; they are not authentication entry points or private discovery endpoints.

For exact schemas and error codes, consult `customer-otp.ts`, `engagement.ts`, `public-discovery.ts`, `provider-usage.ts`, `ai-assistance.ts` and the central router. Provider acceptance, queue completion and verified end-recipient delivery are distinct states. No provider keys, OTP values, message bodies or private prompts belong in usage reports.
