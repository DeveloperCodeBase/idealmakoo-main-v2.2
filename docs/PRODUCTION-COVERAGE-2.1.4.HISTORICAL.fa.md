# پوشش پیاده‌سازی و شواهد نسخهٔ سروری

این ماتریس قابلیت‌های سورس نسخهٔ ۲.۱ و ۴۱ فایل migration تا 042 را شرح می‌دهد؛ شمارهٔ 005 در مجموعه وجود ندارد. وضعیت اجرای هر گیت در گزارش پذیرش همان نسخه ثبت می‌شود. مرجع نیاز، [سند اصلی](ORIGINAL-SPEC.md) است. نام‌های دارای خط تیره در سند معمولاً در SQL با underscore یا جداول مشترک نوع‌دار پیاده شده‌اند. وجود CRUD عمومی به‌تنهایی به معنی اجرای فرایند تخصصی CRM نیست؛ جدول زیر به مسیر دامنه و کنترل واقعی اشاره می‌کند.

«پیاده‌شده» یعنی قابلیت در سورس و مسیر سرور وجود دارد. اجرای آزمون، مرورگر، build و استقرار مقصد جدا گزارش می‌شوند. پیکربندی‌نبودن provider با موفقیت تحویل نمایش داده نمی‌شود. نتیجهٔ نهایی باید متعلق به همین سورس، migration و build باشد.

اصلاحات جاری شامل مدیریت کاربران از پنل، پایداری provisioning، مجوز فایل‌ها، زبان و metadata، بودجهٔ سلامت کانتینر و بازیابی کامل است. طراحی عمومی حفظ شده است. نتیجهٔ اجرای هر بخش و مرز آن در [گزارش پذیرش](VERIFICATION.fa.md) ثبت می‌شود؛ جدول قابلیت‌ها به‌تنهایی قبولیِ استقرار نهایی را اعلام نمی‌کند.

## ۱. معماری و انتخاب‌های اجرایی

| موضوع | وضعیت واقعی |
| --- | --- |
| برنامه | Next.js App Router و TypeScript strict، خروجی standalone، API هم‌مبدأ و worker مستقل. |
| دیتابیس | PostgreSQL 16 و pgvector؛ دامنه‌های نوع‌دار، constraint و trigger، CAS، قفل تراکنش، audit و outbox. PostgreSQL 17 جدول تاریخی جای الزام 16 سند اصلی را نگرفته است. |
| هویت | users و نشست‌ها مرجع واحدند؛ نقش ارسالی مرورگر هویت نمی‌سازد. در حالت پیش‌فرض hybrid، مالک و تیم اولیه از env محافظت‌شده ایجاد می‌شوند و مدیر مجاز کاربران بعدی را از پنل می‌سازد و ویرایش می‌کند. کارکنان به MFA و مجوز جاری نیاز دارند. ثبت‌نام عمومی فقط مشتری می‌سازد. |
| انتشار | draft/review/release/schedule هر زبان مستقل است؛ پیش‌نویس تازه نسخهٔ عمومی قبلی را بازنویسی نمی‌کند. |
| پراکسی | Caddy نقش reverse proxy و HTTPS را انجام می‌دهد. نام Nginx در الگوی P12 با این انتخاب جایگزین شده؛ اجرای Nginx ادعا نمی‌شود. |
| ایمیل | SMTP پیکربندی‌شده و کنترل DKIM بازاریابی. Compose یک Postfix محلی provision نمی‌کند؛ اتصال به MTA مجاز سازمان قابل تنظیم است. |
| دمو | seed تولید مدیر اولیه، کارکنان تعریف‌شده در env و محتوای مرجع کارخانه شامل ۱۲۰ پیش‌نویس صفحه در پنج زبان را می‌سازد؛ مشتری، فرصت، قرارداد، گواهی شرکت، ثبت اصالت یا تراکنش تجاری فرضی ایجاد نمی‌کند. دمو در production ممنوع است. |
| B2B | فهرست استعلام، نمونه، مذاکره و اعلام تمایل روی پیشنهاد؛ فروشگاه، پرداخت و تأیید اصالت ساختگی تعریف نشده‌اند. |

مراجع: [README](../README.md)، [API](API.md)، [امنیت](../SECURITY.md)، [استقرار](DEPLOYMENT.fa.md) و [عملیات](OPERATIONS.fa.md).

## ۲. ماتریس مراحل P01 تا P12

| مرحله | پیاده‌سازی فعلی | شرط پذیرش و مرز آن |
| --- | --- | --- |
| P01 ـ زیرساخت و طراحی | Next/TypeScript، تم روشن/تیره، RTL/LTR، قلم محلی، اجزای طراحی، کاهش حرکت و فرم‌های دارای برچسب و فوکوس. | آزمون‌های browser/Axe برای FA/EN، home/login/contact در دو تم وجود دارند؛ نتیجهٔ اجرای نسخهٔ جاری در گزارش پذیرش است. ممیزی تمام کامپوننت‌ها، نقش‌ها و دستگاه‌ها ادعا نمی‌شود. |
| P02 ـ پنج زبان | fa/en/tr/ar/ru، جهت، محدودیت زبان کارمند، aliasهای شناخته‌شده، حفظ استعلام و مسیرهای خصوصی. | alias نامحدود یا URL دارای token وارد کش/مسیر عمومی نمی‌شود. پوشش همهٔ مرورگرها و تقویم‌ها نیازمند شاهد جداست. |
| P03 ـ داده و انتشار | CAS، revision ثابت، بازبینی مستقل، انتشار هر locale، schedule، withdraw، restore-to-draft و marker منع زنده‌شدن محتوای کارخانه پس از archive. | migration بازسازی‌شده با checksum جعلی روی ledger قدیمی اجرا نمی‌شود؛ backfill داده پذیرش مستقل دارد. |
| P04 ـ هویت و کارکنان | ورود/ثبت‌نام، رمز، ایمیل یک‌بارمصرف، نشست، MFA، دعوت امن کارکنان و انتقال کار هنگام خروج. | ۱۲ نقش دمو مجوز تولید نیستند؛ دامنهٔ دعوت‌کننده و گیرنده در پذیرش/ارسال دوباره بررسی می‌شود. |
| P05 ـ سایت و کاتالوگ | مرجع محصولات/صفحات/مقالات، فیلتر خانواده، مقایسه و انتشار؛ glossary و popover بررسی‌شده و registry گواهی. | ادعای فنی و گواهی تازه به داده و بازبینی واقعی نیاز دارند؛ گواهی فرضی seed نمی‌شود. |
| P06 ـ استعلام و اسناد | RFQ، ادغام مهمان، نمونه، ظرفیت رویداد/بازدید و waitlist، سند نسخه‌دار، ZIP مجاز، data room، همکاری، استخدام، نماینده و مناقصه. | قرنطینه، انقضای حق و لغو دسترسی مانع دریافت‌اند. provider و ERP واقعی نیازمند پیکربندی و پذیرش مستقل‌اند. |
| P07 ـ CMS و DAM | ۲۸ بلوک، صفحه‌ساز با آرشیو/سطل بازیافت/بازیابی پیش‌نویس، فرم‌ساز با بایگانی و بازیابی، مقایسهٔ دو revision، رابطهٔ واقعی مبدأ/مقصد ترجمه، shared block ثابت، lease و preview خصوصی، حقوق رسانه، اصل محفوظ، برش غیرمخرب، مصرف scoped و MP4/VTT. | JavaScript/PHP/plugin دلخواه از پنل اجرا نمی‌شود. پاسخ فرم با بازیابی schema حذف نمی‌شود؛ جزئیات نسخه و نقشهٔ مصرف به مجوز فعلی محدودند. [راهنمای تحریریه](EDITOR-WORKFLOWS.fa.md). |
| P08 ـ CRM | فرایندهای دامنهٔ جدول ۳؛ قیمت، تبدیل و PDF به CRUD عمومی تقلیل داده نشده‌اند. | شاهد P08/CRM-032 با دو سازمان، پنج زبان، شش PDF و نمونه/کیفیت از HTTP واقعی و UI مشتری/گزارش اجرا شده است؛ تمام فرم‌های کارمندی/دستگاه‌ها را exhaustively نمی‌پیماید. |
| P09 ـ خدمات و کیفیت | درخواست/thread واحد، پیام عمومی/داخلی، assignee مستقل، SLA با تقویم/تعطیلات، waiting_customer و qualityScope. | نقش مدیریتی معمولی، مجوز خودکار مشاهدهٔ تمام پرونده‌های کیفیت نیست. |
| P10 ـ AI و RAG | budget ledger اتمی، مدل صریح، کار ناهمگام/HMAC، CRM assist مجاز و ingestion/retrieval عمومی مبتنی بر pgvector. | کلید/مدل لازم‌اند؛ RAG و چت عمومی پیش‌فرض خاموش. دادهٔ private CRM وارد corpus عمومی نمی‌شود. |
| P11 ـ ارتباط و پایش | outbox، recipient نوع‌دار، endpoint/device verification، topic/channel/frequency/quiet hours، digest/unsubscribe، تلگرام انتشار؛ قالب تراکنشی پنج‌زبانه با revision/review/activate و snapshot واقعی صف (037)؛ ۱۲ نمای پایش، incident/SLO. | live پیش‌فرض خاموش؛ mock provider تحویل واقعی را اثبات نمی‌کند. نبود شاهد provider/TLS/recovery با unknown نشان داده می‌شود. |
| P12 ـ استقرار | Docker، DB محدود، worker، Caddy، ClamAV، نصاب Ubuntu تک‌فرمانی، backup رمزنگاری، restore، rollback مشروط و CI. | native و parser پیکربندی معادل daemon داکر، Ubuntu VM خالی یا TLS مقصد نیستند. |

## ۳. ماتریس CRM-001 تا CRM-032

| بند | فرایند پیاده‌شده | کنترل و حد واقعی |
| --- | --- | --- |
| CRM-001 | هویت واحد، request assignee و مالک/تیم/قلمرو فروش. [scope](../src/server/workspace-scopes.ts) | مسئول درخواست و مالک فرصت مستقل‌اند؛ scope جاری در سرور خوانده می‌شود. |
| CRM-002 | حساب حقوقی/نمایشی، نوع فعالیت، شناسهٔ ثبت، نشانی، شعبه و parent. [schema](../src/server/workspace-domain-schema.ts) | parent و branch معتبر و ضدچرخه‌اند؛ تاریخچهٔ retained حذف کور نمی‌شود. |
| CRM-003 | مخاطب مستقل، affiliation بازه‌دار، email/phone endpoint و challenge، consent و recipient namespace. [endpoints](../src/server/workspace-domain-endpoints.ts) | ایمیل مشترک اشخاص را یکی نمی‌کند؛ CRUD نمی‌تواند verified بسازد یا consent دیگران را به ارث ببرد. |
| CRM-004 | منشأ یکتای lead و routing با معنای تجاری نوع درخواست. [routing](../src/server/workspace-routing.ts) | رزومه، دانلود عمومی و رزرو رویداد خودکار lead فروش نمی‌سازند. |
| CRM-005 | merge با انتخاب فیلد/alias/snapshot و unmerge با کنترل تغییرات بعدی. [CRM](../src/server/workspace-crm.ts) | حساب ورود و رضایت دو شخص جمع نمی‌شوند؛ تعارض بعدی نیازمند تعیین تکلیف است. |
| CRM-006 | qualification و تبدیل اتمی با ساخت/اتصال حساب و مخاطب؛ فرصت create/link/none مستند. [operations](../src/server/workspace-domain-operations.ts) | یکتایی conversion و needKey؛ تغییر دستی status جای فرمان تبدیل نیست. |
| CRM-007 | گروه/عضو/قلمرو، rule نسخه‌دار، round-robin تراکنشی، timezone، ساعات و تعطیلات. [routing](../src/server/workspace-routing.ts) | عضو غیرفعال/فاقد scope انتخاب نمی‌شود؛ تقویم واقعی سازمان را مدیر ثبت می‌کند. |
| CRM-008 | pipeline/stage نسخه‌دار، احتمال، ترتیب، checklist و انتقال با کنترل صفحه‌کلید. [pipeline](../src/server/workspace-pipelines.ts) | مرحلهٔ دارای فرصت باز بدون نگاشت مقصد حذف نمی‌شود. |
| CRM-009 | فرصت و item با snapshot محصول/گونه/واحد، quantity Decimal، حساب/مخاطب و چند request. [domain](../src/server/workspace-domain-operations.ts) | مجوز هر دو سمت request مستقل است؛ مبلغ null صفر نیست. |
| CRM-010 | تماس/جلسه/یادداشت، occurredAt جدا از recordedAt، author واقعی و cursor. [operations](../src/server/crm-operations.ts) | یادداشت داخلی وارد پرتال مشتری نمی‌شود؛ هویت ثبت‌کننده قابل جعل نیست. |
| CRM-011 | task series، UTC/date-only/timezone، تکرار محدود و نسل محفوظ، complete/cancel و reminder durable. [operations](../src/server/crm-operations.ts) | در 036، defer/digest وضعیت queued دارند؛ delivered بعد از تحویل واقعی است. بسته‌شدن، مسئول، scope، نسل و رضایت در لحظه INSERT اعلان بررسی می‌شوند. |
| CRM-012 | pricebook/entry ثابت و بررسی‌شده به تفکیک market/currency و محاسبه Decimal/half-up با policy version. [commercial](../src/server/workspace-commercial.ts) | ارزهای مختلف بدون نرخ مصوب جمع نمی‌شوند؛ unknown صفر نیست و ریال/تومان تفکیک می‌شوند. |
| CRM-013 | سقف تخفیف نقش، سیاست نسخه‌دار و تأیید مستقل snapshot شامل طرفین، نشانی، اقلام، شرایط و اعتبار. [commercial](../src/server/workspace-commercial.ts) | maker و approver مستقل؛ تغییر تجاری نیازمند بازبینی تازه است. |
| CRM-014 | envelope/currentRevisionId فقط هنگام صدور، snapshot ثابت، PDF ذخیره‌شده با SHA بایت واقعی و پاسخ روی همان revision. [artifact](../src/server/quote-artifacts.ts) | draft pointer را تغییر نمی‌دهد؛ legacy origin مشخص است. دریافت تکراری بایت تازه نمی‌سازد. اعلام تمایل، پرداخت یا برد خودکار نیست. |
| CRM-015 | نمونهٔ مرتبط با فرصت/request، reviewed/shipped/received/evaluated، مدرک حامل و ارجاع quality_concern. [domain](../src/server/workspace-domain-operations.ts) | مدرک خصوصی retained است و بازخورد ایمنی به پروندهٔ کیفیت می‌رود. |
| CRM-016 | handoff دستی با وضعیت داخلی جدا از externalStatus، مدرک، مرجع دریافت و reconciliation. [domain](../src/server/workspace-domain-operations.ts) | ERP ناشناخته خودکار متصل نیست؛ uncertain کورکورانه retry نمی‌شود. |
| CRM-017 / OWN-012 | request/thread/case واحد، SLA و pause، پیام عمومی/داخلی و ارجاع کیفیت. [requests](../src/server/requests.ts) | scope و qualityScope مستقل؛ نمای علمی تماس و دادهٔ تجاری را پنهان می‌کند. |
| CRM-018 | قرارداد بازه‌دار قلمرو/محصول و کنترل overlap؛ پروفایل عمومی نماینده جدا با review/publish. [directory](../src/server/partner-directory.ts) | قرارداد خصوصی خودکار public profile نمی‌سازد؛ انقضا/ابطال در نمایش و تماس جاری کنترل می‌شود. |
| CRM-019 | درخت شرط محدود، preview پس از ACL، segment نسخه‌دار و snapshot user/contact. [audience](../src/server/crm-audience.ts) | آمار پنهان افشا نمی‌شود؛ dedupe مقصد+locale+campaignRevision هویت اشخاص را ادغام نمی‌کند. |
| CRM-020 | revision ثابت، start صریح، حداکثر پنج step، enrollment، suppression و cancel. [campaigns](../src/server/crm-campaigns.ts) | endpoint/consent/quiet/frequency/sender scope در dispatch جاری‌اند. CRM_CAMPAIGNS_ENABLED پیش‌فرض false؛ شمار سفر معادل تحویل نیست. |
| CRM-021 | connector secret و HMAC raw bytes، inbox یکتا، association صریح و audit. [inbox](../src/server/crm-inbox.ts) | replay دقیق از body متعارض جداست؛ ایمیل/شمارهٔ ادعایی فرستنده، مالکیت حساب یا دسترسی پرونده نمی‌سازد. |
| CRM-022 | سازمان پرتال با FK حساب CRM، membership مشتق و تاریخچهٔ اتصال، اشتراک صریح viewer/reply. [organizations](../src/server/organizations.ts) | revoke عضویت/اشتراک یا archive، دریافت بعدی request/attachment/PDF را می‌بندد؛ contact معادل عضو نیست. |
| CRM-023 | crm_assist با context رکورد/فیلد مجاز، شاهد و متن/اقدام پیشنهادی، درگاه بودجهٔ مرکزی. [AI](../src/server/ai.ts) | مدل/کلید لازم؛ خروجی AI حق تغییر قیمت، مالک، مرحله یا بستن کیفیت ندارد. |
| CRM-024 | forecast با probability مصوب، currency و unknown مجزا، snapshot تاریخی scoped. [operations](../src/server/crm-operations.ts) | weighted total به پوشش معتبر نیاز دارد؛ snapshot مجوز فعلی را دور نمی‌زند. |
| CRM-025 | success plan با factor/weight/evidence/coverage و CSAT/NPS با scoped token و expiry/revoke. [operations](../src/server/crm-operations.ts) | سکوت امتیاز مثبت/نظر عمومی نیست؛ مالک/endpoint/inviter scope پیش از تحویل دوباره کنترل می‌شوند. |
| CRM-026 | rule/event/run، dry-run، execute با key، dedupe و chainDepth/kill switch. [automation](../src/server/automation.ts) | شرط محدود و create_activity/assign_owner/add_tag؛ script/webhook/cron دلخواه ندارد. |
| CRM-027 | job/row CSV پایدار، preview/اصلاح، resume/cancel، خطای ردیفی و export ضدفرمول، جستجوی جدا. [transfers](../src/server/crm-transfers.ts) | import این نسخه create-only برای leads/contacts است؛ تغییر همهٔ مجموعه‌ها با CSV عمومی تعریف نشده. scope و tombstone هنگام worker کنترل می‌شوند. |
| CRM-028 | scope فرد/تیم/قلمرو/all و grant مستقل contact/financial/baseCost/assign/intake در DTO/PDF/AI/export/report. [scope](../src/server/workspace-scopes.ts) | grant غایب اختیار گسترده نمی‌سازد؛ نام نقش legacy مالکیت کاربری نیست. |
| CRM-029 | subject نوع‌دار، approval مستقل، export، legal hold/version/expiry و erasure ledger امضاشده مستقل از backup. [privacy](../src/server/privacy.ts) | وابستگی مالی/رضایت/مدرک retained می‌تواند حذف را مسدود کند؛ blocked یا pseudonymization حذف کامل نامیده نمی‌شود. restore باید دفتر جاری را replay کند؛ فقدان زنجیره fail-closed است. |
| CRM-030 | RFC 9457، CSRF، CAS/idempotency مشخص هر فرمان، mutation/audit/outbox هم‌تراکنش. [API](API.md) | همهٔ PATCHها نسخه‌دار فرض نمی‌شوند؛ If-Match با expectedVersion میزکار تفاوت دارد. snapshot ثابت با generic patch تغییر نمی‌کند. |
| CRM-031 | راهنمای نقش‌ها، backup قبل upgrade، rollback کد سازگار و restore با privacy gate. [عملیات](OPERATIONS.fa.md) | rollback ناسازگار خودکار نیست؛ دفتر حذف به snapshot قدیمی برنمی‌گردد. |
| CRM-032 | fixture علامت‌دار، DB جدا و آزمون‌های دامنه/API/مرورگر برای چرخهٔ درخواست و تعامل. [tests](../tests) | مشتری فرضی در تولید seed نمی‌شود. شاهد یکپارچهٔ `crm-lifecycle.spec.ts` در مرورگر نهایی موفق است؛ ساخت حساب fixture از دادهٔ کسب‌وکار HTTP جدا و provider زنده غیرفعال است. |

## ۴. قابلیت‌های اختصاصی

| قابلیت | رفتار جاری |
| --- | --- |
| اسناد/data room | [resources](../src/server/resources.ts): فایل نسخه‌دار ثابت، review مستقل، publication، grant view/download، expiry/revoke و ZIP مجاز. پنل منابع و account/data-rooms از همین API استفاده می‌کنند. |
| پاکت مناقصه | [tenders](../src/server/tenders.ts): نسخهٔ تسلیم‌شدهٔ فنی/مالی جدا، فایل خصوصی clean، reviewer ACL همان پاکت و retained history؛ لینک رسانهٔ عمومی جای آن نیست. |
| رویداد/بازدید | [events](../src/server/events.ts): جلسه، ظرفیت تراکنشی، booking/waitlist/cancel/attendance؛ رسید رزرو transactional است و رضایت بازاریابی نمی‌سازد. |
| استخدام | application و پیوست خصوصی، کنترل concurrency و عدم ساخت lead فروش؛ scanner غایب فایل را clean نمی‌کند. |
| گواهی شرکت 035 | [راهنما](COMPANY-CERTIFICATES.fa.md): draft/review/release هر locale، سند عمومی جاری بررسی‌شده، وضعیت اعتبار/انقضا/ابطال/source-unavailable و هشدار داخلیِ dedupe با scope جاری. گواهی فرضی ساخته نشده است. |
| glossary | [ماژول](../src/server/workspace-glossary.ts): اصطلاح و popover از نسخهٔ منتشرشدهٔ locale جاری؛ seed پیش‌نویس، انتشار خودکار نیست. |
| DAM | [dam](../src/server/dam.ts)، [processing](../src/server/media-processing.ts) و [پنل](../src/components/media/ProductionMediaLibrary.tsx): فرادادهٔ واقعی، اسکن، policy نسخه‌دار، اصل خصوصی، crop، MP4/VTT و مصرف scoped. |
| اشتراک/دانش عمومی | [wishlists](../src/server/wishlists.ts) و [corpus](../src/server/public-knowledge.ts): share فاقد دادهٔ خصوصی است؛ انتشار جاری مقاله/محصول/صفحه در نمایش و retrieval کنترل می‌شود. |
| قالب تراکنشی | [notification-templates](../src/server/notification-templates.ts): ۱۴ رویداد بسته، پنج زبان، email/in-app و متن معمولی SMS/Telegram/Push، review مستقل، CAS/rollback، نمونهٔ بدون token، snapshot رمز‌شده و دفتر metadata؛ پنل واقعی communications و suppressionهای مجاز. OTP/provider proof و محتوای بازاریابی مستقل حفظ می‌شوند؛ fallback فقط متن پایهٔ همان کانال/زبان پس از policy جاری است. |
| پایش | [monitoring](../src/server/operations-monitoring.ts): ۱۲ نمای scoped با نمونه/بازه/coverage، incident append-only و SLO؛ anonymous telemetry فقط با consent و مسیر عمومیِ بدون شناسه. |
| تنظیمات و اعلان عمومی | [راهنما](PUBLIC-SURFACE.fa.md): نشانی مستقل دفتر/کارخانه و فوتر در پنج زبان، اعلان از revision بررسی‌شده با زمان شروع/انقضا، کنترل مشاهدهٔ صفحه و جست‌وجوی اسناد عمومی جاری. |
| تحریریهٔ 038 | [راهنما](EDITOR-WORKFLOWS.fa.md): schema فرم با قفل و نسخهٔ ثبت‌شده، بایگانی/بازیافت/بازیابی، پاسخ‌های محفوظ، مقایسهٔ revision مجاز و تأیید صریح مبنای ترجمه؛ تازه‌شدن ساعت کلی workspace مبنای کهنه را معتبر نمی‌کند. |

### مسیرهای عمومی و دامنهٔ مدل محتوا

| موضوع | پیاده‌سازی و مرز آن |
| --- | --- |
| SEO و مسیرهای تاریخی | [structured data](../src/server/public-structured-data.ts)، [redirectها](../src/lib/legacy-redirects.ts) و [visibility](../src/lib/public-visibility.ts): دادهٔ ساختاریافته فقط با شواهد واقعی، ۴۰ نگاشت تاریخی، canonical/sitemap و جلوگیری از برگشت محتوای لغوشده؛ درصد خام Caddy قرارداد مجزا دارد. |
| Press Kit و مطالعات موردی | Press Kit در `/press-kit` است و `/media` مرکز ویدیو/رسانه؛ این تفاوت مسیر با سند اولیه صریح است. مطالعهٔ موردی از صفحه/مقالهٔ سفارشی قابل انتشار است؛ مدل اختصاصی جدا یا نمونهٔ علمی ساختگی seed نشده. |

## فهرست و چرخهٔ کارکنان و مشتریان

فهرست حساب‌ها از API با جست‌وجوی نام/ایمیل، نوع حساب، نقش دقیق، وضعیت فعال و صفحه‌بندی پایدار خوانده می‌شود؛ تعداد زیاد مشتریان جدید، حساب قدیمی را از دسترس خارج نمی‌کند. API پیش از اعمال اندازهٔ صفحه فیلتر می‌کند، در هر دریافت نقش/MFA و نشست فعلی را می‌سنجد و فقط فیلدهای مجاز را برمی‌گرداند. پنل، نتیجهٔ دیررسِ حساب یا جست‌وجوی قبلی را به وضعیت فعلی اعمال نمی‌کند. انتخاب کارمند برای واگذاری کار و خاتمهٔ دسترسی مستقل از فهرست قابل جست‌وجو نگه داشته می‌شود و پیش‌نمایش همان شخص، مجوز و وضعیت جاری را تعیین می‌کند.

در حالت پیش‌فرض `hybrid`، مدیر ارشد دارای MFA می‌تواند کاربران و کارکنان را با نقش‌های مجاز از پنل ایجاد و مدیریت کند؛ حساب‌های اولیهٔ محیطی نیز هویت ثابت دارند و تغییرات پنل با seed عادی بازنویسی نمی‌شوند. حالت محدود `env` همچنان انتخاب صریح اپراتور است. خطا یا خالی‌شدن جست‌وجو، خودکار شخص دیگری را برای عملیات انتخاب نمی‌کند. حد مستقل واگذاری برای بیش از هزار کارمند فعال دارای MFA همچنان برقرار است. [راهنمای مدیریت کاربران](USER-MANAGEMENT.fa.md)، [قرارداد API](API.md)، [راهنمای اپراتور](operator-and-crm-guide.md) و نتیجهٔ رگرسیون PostgreSQL/رابط در [گزارش پذیرش](VERIFICATION.fa.md) قابل بررسی‌اند.

## ۵. شواهد نهایی و مرز اعتبار

مرجع اعداد و وضعیت جاری، [گزارش نسخهٔ جاری](VERIFICATION.fa.md) و شواهد همان اجراست که آن گزارش صریحاً انتخاب می‌کند. [گیت‌های ماشین‌خوان قبلی](verification-evidence/acceptance.json) برای حفظ تاریخچه باقی می‌مانند و نتیجهٔ build جاری نیستند. اجرای نصب Ubuntu، بازیابی و Lighthouse فقط پس از ثبت نتیجهٔ واقعی همان دامنه، پذیرفته محسوب می‌شود؛ گزارش‌های قبلی فرانت‌اند، build یا checkpoint جای آن نتیجه را نمی‌گیرند.

گیت نسخهٔ ۲.۱ شامل unit، تمام فایل‌های PostgreSQL، API واقعی، build و TypeScript، مرورگر از Caddy، نصب Ubuntu/Docker، backup/restore واقعی، بررسی هدر/nonce و لاگ، اسکن secret و ممیزی کامل مسیرهای عمومی است. نتیجه، زمان، تعداد، شکست و skip فقط در گزارش پذیرش همان نسخه درج می‌شود؛ تکرار شمارهای قدیمی در راهنمای قابلیت‌ها معیار پذیرش تازه نیست.

چرخهٔ CRM، دو سازمان، RFQ/تبدیل، پیش‌فاکتور پنج زبان، پاسخ مشتری در پرتال، USD/EUR جدا، نمونه و قرنطینهٔ کیفیت را از HTTP واقعی و UI می‌سنجد. آزمون‌های دامنهٔ کانال‌ها، populated upgrade، کارکنان، مناقصه، گواهی، glossary، قالب تراکنشی، یادآور، فرم، سهمیهٔ آپلود، ترجمهٔ AI، رسانهٔ AI، اصالت و امنیت restore در runner کامل قرار دارند؛ آزمون‌های متمرکز دوباره به شمار کل اضافه نمی‌شوند.

شمار آزمون‌ها پوشش خط کد یا ممیزی تمام ترکیب‌های نقش/صفحه/دستگاه نیست. دیتابیس پذیرش مستقل است و محدودیت واقعی درخواست‌ها برای کسب نتیجهٔ موفق دست‌کاری نمی‌شود. اسکن وابستگی‌های runtime و ابزارهای ساخت جدا گزارش می‌شوند؛ صفر بودن advisory اجرایی به معنی صفر بودن advisory ابزار توسعه نیست.

## ۶. migration، recovery و بسته

اکنون ۴۱ فایل migration از 001 تا 042 وجود دارد؛ شمارهٔ 005 از ابتدا در این مجموعه نیست. 001–024 با checksum تاریخی از checkpoint برگشتند. 025–034 reconstruction صریح با checksum تازه‌اند و ledger دیتابیس اصلی تغییر نکرده است. ۱٬۰۷۰ شیء SQL schema 034 در checkpoint بازسازی روی DB تازه با dump سالم تطبیق داده شد. این شاهد تاریخیِ ساختار است؛ تمام backfillهای گم‌شده را احیاشده فرض نمی‌کند. upgrade دارای دادهٔ 026 و 034 جدا آزموده شده‌اند. پس از اصلاح 026، دیتابیس پذیرش دوباره از صفر ساخته شد و checksum تاریخی یا ledger قبلی بازنویسی نشد.

035 گواهی، 036 سیاست یادآور، 037 قالب تراکنشی و 038 گردش ویرایشگر را افزودند. در نسخهٔ ۲.۱، 039 اتصال مالکانهٔ حساب‌های env و سیاست storage، 040 مصرف یک‌بارهٔ پیشنهاد ترجمهٔ AI، 041 ثبت نسخه‌دار اطلاعات اصالت و 042 دو index مرتب‌شدهٔ فهرست کاربران اضافه شدند. کنترل owner/runtime و grantهای لازم همراه migration و نصب اعمال می‌شوند. گزارش native با ۳۷ migration مربوط به نسخهٔ ۲.۰ است؛ نتیجهٔ جدید backup/restore باید همهٔ ۴۱ فایل، ledger و دادهٔ نمونهٔ واقعی را پوشش دهد.

Backup format3، سورس، DB، رسانه، env، release، فایل‌های integration، دفتر privacy و داده/پیکربندی TLS را رمزنگاری می‌کند؛ کلید مستقل age خارج از آرشیو نگهداری می‌شود و manifest با کلید مشتق‌شده از آن احراز اصالت می‌شود. بازیابی روی نصب موجود دفتر جاری و محدودیت حساب‌های جاری را حفظ می‌کند. روی میزبان تازه هدف باید خالی باشد؛ اگر دفتر مستقل جدیدتری وجود دارد باید ارائه شود. restore، integrity، ساختار/ردیف/sequence، فایل، replay و readiness را می‌سنجد و نشست‌ها و proofهای بازیابی‌شده را باطل می‌کند. حذف مجاز یا دسترسی لغوشده نباید با restore قدیمی احیا شود؛ ناسازگاری یا ledger ناقص باعث توقف آشکار می‌شود. مراحل کامل در [بکاپ و بازیابی](BACKUP-RESTORE.fa.md) است.

Package فقط سورس، دارایی، migration، تست و راهنماهای مجاز را همراه SHA-256 و بررسی credential جمع می‌کند. runtime، .env واقعی، کلید، storage، backup، log، pycache، node_modules و build کنار گذاشته می‌شوند. ZIP زیر public نیست؛ مقصد ../deliverables است. نبود سند الزامی یا credential مشکوک، بسته‌بندی را متوقف می‌کند.

## ۷. پذیرش وابسته به محیط بهره‌برداری

SMTP/DKIM، قالب OTP، bot/channel، کلید نجوا، SDK و worker رسمی حساب باید برای ارسال زنده تنظیم و جدا با گیرندهٔ آزمون مجاز بررسی شوند. الزام apiKey طبق [نمونهٔ رسمی نجوا](https://www.najva.com/api-docs/) در ۲۰۲۶-۱۰-۱۹ بررسی شده است. credential واقعی در سورس یا این گزارش نیست.

DNS، درگاه‌ها، منابع، scanner و TLS باید روی مقصد واقعی سنجیده شوند. اسکریپت و CI مراحل را تعریف می‌کنند؛ native PostgreSQL یا وجود Dockerfile اجرای Docker روی Ubuntu خالی نیست. replication، HA چندسروری، PITR مبتنی بر WAL و ذخیره‌سازی بیرونی با پشتهٔ تک‌سروری حاضر خودکار ایجاد نمی‌شوند.

تحویل باید با مرز آزموده‌شدهٔ کد گزارش شود. «بی‌نقص»، «تأیید همهٔ providerها» یا «پوشش تمام جزئیات» بدون گیت متناظر ادعا نشده است.

