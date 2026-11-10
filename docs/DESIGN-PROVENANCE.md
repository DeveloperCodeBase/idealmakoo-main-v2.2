# منشأ طراحی و اتصال نمونه‌های ارسالی

این سند مشخص می‌کند هر یک از **پنج ZIP ارسالی کاربر** در کدام بخش فرانت‌اند ایده‌آل ماکو استفاده شده است. اجزای رابط با Next.js، React و TypeScript و برای مسیریابی پنج‌زبانه بازنویسی شده‌اند. موتورهای هندسه و تعامل سه‌بعدی از کد اصلی نمونه‌ها منتقل شده‌اند؛ منشأ و مرز تغییرات آن‌ها جداگانه در [EXPERIENCE-PROVENANCE.md](EXPERIENCE-PROVENANCE.md) ثبت شده است.

محتوای تجاری، نام محصول، تصویر کارخانه و پژوهش از نمونه‌های نمایشی گرفته نشده است. این داده‌ها از وب‌سایت رسمی کارخانه می‌آیند و نشانی هر منبع در [SOURCES.json](SOURCES.json) و [catalog.ts](../src/data/catalog.ts) وجود دارد. نام‌ها، آمار عملیاتی و سوابق نمونه در داشبورد، هرجا استفاده شده‌اند، به‌عنوان داده محلی نمایشی مشخص هستند.

## نگاشت بسته‌های ورودی

| بسته ارسالی | بخش‌های بررسی‌شده در بسته | فایل‌های اصلی در برنامه | نتیجه اتصال |
| --- | --- | --- | --- |
| `landingpage(1).zip` | `liquid-dental-experience/src/page.html`، `style.css`، `navigation.js`، `legacy.js` و موتورهای دندان، آب، هیرو و روبیک | [Home.tsx](../src/components/site/Home.tsx)، [Carousel.tsx](../src/components/site/Carousel.tsx)، [Products.tsx](../src/components/site/Products.tsx)، [globals.css](../src/app/globals.css)، پوشه [experience](../src/components/experience) | هیروی شیشه‌ای با صحنهٔ تمام‌عرض، دندان‌های سه‌بعدی روی سطح اقیانوس، ساختار معرفی محصولات و بخش‌های پایین لندینگ، ناوبری و کروسل‌های مرتبط با محصولات، پژوهش و محتوای کارخانه. |
| `Glassy-Carousel-Source.zip` و `carousel.mp4` | `glassy-carousel/dist/carousel.js`، `carousel.css`، نسخه React و ویدئوی مرجع | [Carousel.tsx](../src/components/site/Carousel.tsx)، [carousel.css](../src/components/site/carousel.css)، [carousel.ts](../src/lib/carousel.ts) | هندسه و حرکت کروسل پنکه‌ای اصلی، بازشدن مرحله‌ای کارت منتخب، داک کنترل و جزئیات عملیاتی کارخانه. |
| `Glassy-Navigation-Source(2).zip` | `Glassy-Navigation/src/navbar.js`، `navbar.css`، `sidebar.js` و `sidebar.css` | [Navigation.tsx](../src/components/site/Navigation.tsx)، [Workspace.tsx](../src/components/workspace/Workspace.tsx)، [workspace.css](../src/components/workspace/workspace.css)، [globals.css](../src/app/globals.css) | سطح نوبار با نور لبه و واکنش به اشاره‌گر، جست‌وجو و منوی بازشونده، سایدبار شیشه‌ای با سه نقطه بالا، جداکننده‌ها، گزینه فعال، شمارنده و حالت جمع‌شده. مسیرها و عنوان‌ها به ساختار کارخانه و نقش‌های سند متصل شده‌اند. |
| `Glassy-CRM-Dashboard (1)(1).zip` | `Glassy-CRM-Dashboard/dist/index.html`، `app.js`، `styles.css`، `liquid-glass.css`، `liquid-responsive.css` و `charts.js` | [Workspace.tsx](../src/components/workspace/Workspace.tsx)، [Overview.tsx](../src/components/workspace/Overview.tsx)، [Pipeline.tsx](../src/components/workspace/Pipeline.tsx)، [Records.tsx](../src/components/workspace/Records.tsx)، [ui.tsx](../src/components/workspace/ui.tsx)، [workspace.css](../src/components/workspace/workspace.css) | ترکیب پوسته مدیریت، نوار بالایی، پنل‌های شیشه‌ای، کارت‌های شاخص، جدول‌ها، نمودارها و انتخاب رکورد به میزکار واحد محتوا، CRM و پایش تبدیل شده است. جست‌وجو، فیلتر، ویرایش، جزئیات، خروجی و تغییر مرحله به داده و رویدادهای مشترک برنامه متصل‌اند. |
| `Luma-Liquid-Glass-v2-login-page(1).zip` | `Luma-Dental/dist/index.html`، `styles.css`، `auth-logic.js`، `app.js`، `tooth-scene.js` و فونت همراه | [AuthPage.tsx](../src/components/account/AuthPage.tsx)، [account.module.css](../src/components/account/account.module.css)، [auth-storage.ts](../src/components/account/auth-storage.ts)، [ToothExperience.tsx](../src/components/experience/ToothExperience.tsx)، [engines/auth.ts](../src/components/experience/engines/auth.ts) | ترکیب فرم و ماسکات دندان، شیشه و روشنایی تم، حرکت چشم و پلک و ژست پوشاندن چشم هنگام تمرکز روی رمز حفظ شده‌اند. ورود، ثبت‌نام، بازیابی و تأیید دومرحله‌ای به گردش حساب محلی و مسیرهای پنج‌زبانه برنامه متصل‌اند. |

## نوبار و سایدبار

نوبار عمومی در `Navigation.tsx` ساختار نمونه شیشه‌ای را با برند واقعی ایده‌آل ماکو، چهار گروه اصلی ناوبری، جست‌وجوی محصولات و پژوهش، فهرست استعلام، حساب، تغییر زبان و تغییر تم ترکیب می‌کند. منوی موبایل نیز به همین مقصدها متصل است.

سایدبار نمونه در `Workspace.tsx` و `workspace.css` برای فضای مدیریت تطبیق داده شده است. گروه‌های «محتوا و انتشار»، «ارتباط با مشتری» و «مدیریت و پایش»، حالت باز و جمع‌شده، منوی موبایل و نوار ابزار از یک پوسته استفاده می‌کنند. برندها و حساب‌های نمایشی موجود در ZIP اصلی به برند و نقش‌های کارخانه تبدیل شده‌اند. خود نمونه مستقل `demo.js` به‌عنوان یک برنامه جداگانه یا iframe در سایت قرار نگرفته است.

## کروسل‌ها

کروسل این اصلاح مستقیماً از بستهٔ مستقل `Glassy-Carousel-Source.zip` و ویدئوی `carousel.mp4` تطبیق داده شده است. مرجع هندسه و حرکت `glassy-carousel/dist/carousel.js` و مرجع ظاهر `carousel.css` است. ساختار پنکه‌ای سه‌بعدی، فاصله و عمق کارت‌ها، چرخش محور Y، تمرکز مرکزی، چرخش ملایم با موس، داک شیشه‌ای، قبلی/بعدی، پخش خودکار، ترتیب تصادفی و تمام‌صفحه حفظ شده‌اند. داده‌ها و تصاویر فیلم‌های نمونه به سایت کارخانه وارد نشده‌اند.

بازشدن کارت فعال دو مرحله دارد: گردآمدن کارت‌ها در ۳۵۰ میلی‌ثانیه و گسترش جزئیات در ۴۸۰ میلی‌ثانیه؛ بستن شامل ۴۴۰ میلی‌ثانیه جمع‌شدن و ۴۴۰ میلی‌ثانیه بازگشت کارت‌هاست. محتوای بازشده همان کامپوننت عملیاتی محصول، پژوهش، کاتالوگ یا خبر است. شناوری بازتاب، شتاب محدود درگ، رفتار RTL و احترام به کاهش حرکت، توسعه‌های سازگار این پروژه هستند. اسکرول عمودی عادی به صفحه می‌رسد؛ اسکرول افقی یا Shift + wheel کروسل را جابه‌جا می‌کند.

کروسل در مجموعه‌های محصولات، پژوهش، کاتالوگ و خبر منتشرشدهٔ لندینگ، محصولات مرتبط و مخاطبان، منابع، پژوهش‌ها، تحریریه و بلوک‌های صفحه‌ساز استفاده می‌شود. شش آزمون مستقل و مقایسهٔ ۱۰۴ حالت هندسی با تابع اصلی `cardPose` انجام شده است؛ جزئیات در `tests/carousel.test.mjs` و `src/lib/carousel.ts` قرار دارد.


## موتورهای اصلی سه‌بعدی

| منبع اصلی | فایل منتقل‌شده | استفاده در فرانت‌اند |
| --- | --- | --- |
| `landingpage(1).zip` → `src/tooth.js` | [engines/tooth.ts](../src/components/experience/engines/tooth.ts) | هندسه مولر، کاسپ‌ها، ریشه‌ها و مواد مینای دندان. |
| `landingpage(1).zip` → `src/hero.js` | [engines/hero.ts](../src/components/experience/engines/hero.ts) | دو دندان هیرو، کشیدن و رهاکردن، برخورد و بازگشت به جایگاه نمایش. |
| `landingpage(1).zip` → `src/liquid-water.js` | [engines/liquid-water.ts](../src/components/experience/engines/liquid-water.ts) | سطح آب، موج ناشی از اشاره‌گر و برخورد دندان، بازتاب و اعوجاج. |
| `landingpage(1).zip` → `src/rubik.js` | [engines/rubik.ts](../src/components/experience/engines/rubik.ts) | مکعب شیشه‌ای با چرخش لایه‌ها و دندان متصل، در تجربه تعاملی طراحی و تولید. |
| `Luma-Liquid-Glass-v2-login-page(1).zip` → `dist/tooth-scene.js` | [engines/auth.ts](../src/components/experience/engines/auth.ts) | ماسکات دندان صفحه ورود، چشم‌ها، پلک، دست‌ها، دنبال‌کردن اشاره‌گر و نور تم. |

موتورها با `ToothExperience.tsx` و `RubikExperience.tsx` به lifecycle React متصل‌اند. شنونده‌ها، observerها، فریم‌های انیمیشن و منابع WebGL هنگام خروج پاک می‌شوند. توقف در حالت پنهان یا خارج از دید، محدودکردن تراکم پیکسل، کاهش حرکت و جایگزین برداری هنگام نبود WebGL در لایه اتصال مدیریت می‌شوند.

برای روشن‌بودن کیفیت تایپ‌ها، فایل‌های موتور منتقل‌شده دارای توضیح `@ts-nocheck` هستند؛ این فایل‌ها حفظ الگوریتم JavaScript اصلی را نشان می‌دهند. props، مرزهای DOM، lifecycle و رابط‌های اتصال React تایپ شده‌اند. صرف تغییر پسوند موتور به `.ts` به‌عنوان بازنویسی کامل و سخت‌گیرانه الگوریتم معرفی نشده است.

## سیستم مشترک رنگ و زبان

`liquid-theme.css` پس از `globals.css` بارگذاری می‌شود و توکن‌های مشترک دو تم، شفافیت، نور لبه، رنگ خوانا، درخشش نئون و سایه را یکدست می‌کند. `LiquidEffects.tsx` بازتاب سطح را با حرکت اشاره‌گر تنظیم می‌کند. `AppProvider.tsx` زبان، جهت، تم و وضعیت مشترک حساب، مقایسه و استعلام را در اختیار پوسته عمومی و فضای مدیریت قرار می‌دهد. فایل‌های `workspace.css`، `account.module.css` و `content.css` از همین خانواده پنل و رنگ استفاده می‌کنند. فونت Inter از نمونه لندینگ و Vazirmatn از بسته Luma به‌صورت محلی ارائه می‌شوند؛ فایل‌های مجوز فونت در `public/fonts/` نگه داشته شده‌اند.

مسیرها در پنج زبان `fa`، `en`، `tr`، `ar` و `ru` ساخته می‌شوند؛ فارسی و عربی RTL هستند. در محتوای مستند، متن اصلی پژوهش فارسی باقی می‌ماند و عنوان و خلاصه ترجمه‌شده همراه پیوند منبع ارائه می‌شود.

## مرز محتوا و سرویس‌ها

- تصاویر کارخانه و محصول از `public/media/official/` و داده مستند از `src/data/catalog.ts` خوانده می‌شوند. تصاویر سه‌بعدی رابط، ادعای ابعاد یا عملکرد بالینی یک SKU مشخص نیستند.
- عملیات محلی صفحه‌ساز، انتشار، حساب، استعلام و CRM برای بررسی مستقل فرانت‌اند آماده‌اند. اتصال به احراز هویت سرور، ارسال واقعی درخواست و سرویس‌های تولید محتوا در قراردادهای جداگانه برنامه تعریف می‌شود.
- نسخهٔ بازبینی‌شده و منتشرشدهٔ محصول، داده‌های نمای عمومی شامل متن، گالری، جنس، مشخصات، خانواده، برند و دانلود را تغییر می‌دهد. دادهٔ مرجع اولیه جداگانه نگه داشته می‌شود. محصول تازهٔ ثبت‌شده در پنل منشأ `editor` دارد و به فهرست مستند اولیه اضافهٔ ساختگی نمی‌شود.
- خروجی منابع، فایل JPG واقعیِ موجود در سایت مرجع است؛ PDF، IFU، SDS، قیمت عمومی، گواهی یا ماتریس شید تأییدنشده برای پرکردن رابط ساخته نشده است.

## شناسه بسته‌های ورودی

برای شناسایی دقیق نسخه بررسی‌شده، SHA-256 پنج فایل ارسالی در محیط ساخت محاسبه شده است:

```text
landingpage(1).zip
8b7f9f811ebd289a475b8bc550b778a27ae6302e5fa9959eac6309cbb8079394

Glassy-Navigation-Source(2).zip
7e3d9260f04361c16d876fdd0813ead66884232210a3b66ac53d7af7870f4eba

Glassy-CRM-Dashboard (1)(1).zip
0d639403f4e327c29b396e5c36a79d79f5e3a9087c2404abf69acfec7def55df

Luma-Liquid-Glass-v2-login-page(1).zip
cf4d407d5725a21e62a70e503c70eb15a1e933bf32c1871ca34a4a761b0098e2

Glassy-Carousel-Source.zip
b2b0d4ec86820051192e8961adb8fdabaa755942792be218475d1546506778f9
```

## دامنه اعتبارسنجی

فرمان `node scripts/verify.mjs` خروجی ساخته‌شده در `out/` را بررسی می‌کند: مسیرهای اعلام‌شده هر پنج زبان و aliasهای مدیریت، `lang` و `dir`، لینک‌ها و دارایی‌های محلی HTML/CSS، وجود تصاویر مرجع، پوشش برچسب‌های ترجمه و متادیتای عمومی بدون Offer یا قیمت ساختگی. مسیر ناموجود به `index.html` ریشه یا صفحه ۴۰۴ نگاشت نمی‌شود. با `--out <directory>` می‌توان یک پوشه خروجی دیگر را بررسی کرد.

تست‌های منطق و TypeScript، اتصال داده و قواعد تعریف‌شده را پوشش می‌دهند. بررسی ایستا به معنی تأیید بصری یا اجرای تعامل اشاره‌گر در مرورگر نیست. در این مرحله، مرورگر یا آزمون خودکار مرورگر اجرا نشده است؛ نتایج QA داخل ZIPهای اولیه نیز به‌عنوان آزمون نسخه ادغام‌شده گزارش نمی‌شوند.
