/** Visually inspected user-supplied references.
 * Web page numbers refer to the derived PDFs; original page/panel numbers remain explicit.
 * These archival images are not a verified current variant, price, availability or certificate database.
 */
import type {Localized} from './catalog';
export interface ReferenceTable {id:string;title:Localized;columns:{key:string;label:Localized}[];rows:Record<string,string>[];note:Localized}
export interface ReferenceSection {id:string;title:Localized;summary:Localized;text:string;pageStart:number;pageEnd:number;language:'fa'|'en'|'mixed';image:string;sourcePage:number;sourcePanel?:number;productIds?:string[];tables?:ReferenceTable[]}
export interface ReferencePage {page:number;title:Localized;image:string;width:number;height:number;sourcePage:number;sourcePanel?:number}
export interface ReferenceDocument {id:string;slug:string;title:Localized;summary:Localized;kind:'mould-chart'|'product-catalogue';sourceBrand:string;relationship:'company'|'external-reference';sourceType:'user-upload';url:string;localDownloadUrl:string;pageCount:number;sourcePageCount:number;bytes:number;webBytes:number;webSha256:string;sourceBytes:number;sourceSha256:string;originalFileName:string;publishedAt:null;extractionNote:Localized;derivativeNote:Localized;sections:ReferenceSection[];pages:ReferencePage[]}

export const referenceDocuments:ReferenceDocument[] = [
  {
    "id": "ideal-makoo-mould-poster",
    "originalFileName": "ideal makoo neww complete1graynew.pdf",
    "sourcePageCount": 1,
    "sourceBytes": 47886307,
    "sourceSha256": "a41652ba6e9b55c0cf135d13b14c3fc5e4d64e98e392f80776453f4edafa895e",
    "pageCount": 26,
    "webBytes": 8051624,
    "webSha256": "77f1b0321778fcf2efbe8483964cfe496dcfc0a2daeb8953fde497831cc451c7",
    "url": "/media/documents/ideal-makoo-complete-catalogue-web.pdf",
    "localDownloadUrl": "/media/documents/ideal-makoo-complete-catalogue-web.pdf",
    "slug": "ideal-makoo-mould-poster",
    "title": {
      "fa": "کاتالوگ جامع و چارت قالب ایده‌آل ماکو",
      "en": "Ideal Makoo complete catalogue and mould chart",
      "tr": "Ideal Makoo kapsamlı katalog ve kalıp çizelgesi",
      "ar": "كتالوج إيده‌آل ماكو الشامل وجدول القوالب",
      "ru": "Полный каталог и формы Ideal Makoo"
    },
    "summary": {
      "fa": "از فرم دندان و ابعاد تا معرفی ۱۲ سری در سند؛ نسخهٔ ۲۶ صفحه‌ای خوانا از پوستر ارسالی.",
      "en": "Tooth forms, dimensions and 12 series profiles in the document, presented as a readable 26-page edition of the supplied poster.",
      "tr": "Diş formları, ölçüler ve belgedeki 12 seri tanıtımı; sağlanan posterin okunabilir 26 sayfalık sürümü.",
      "ar": "أشكال الأسنان وأبعادها وتعريف 12 سلسلة في الوثيقة، في نسخة مقروءة من 26 صفحة للملصق المرفوع.",
      "ru": "Формы, размеры и 12 описаний серий в документе; читаемая версия загруженного плаката на 26 страницах."
    },
    "kind": "product-catalogue",
    "sourceBrand": "Ideal Makoo",
    "relationship": "company",
    "sourceType": "user-upload",
    "publishedAt": null,
    "bytes": 8051624,
    "extractionNote": {
      "fa": "پوستر تک‌صفحه‌ای اصلی، متن قابل استخراج نداشت؛ متن‌های این بخش با مشاهدهٔ تصاویر بازنویسی شده‌اند. خانه‌های خالی و اختلاف نام‌های چاپ‌شده حفظ شده‌اند.",
      "en": "The original one-page poster has no extractable text. These notes were transcribed or summarised by inspecting its images; empty cells and conflicting labels are retained.",
      "tr": "Tek sayfalık asıl posterde çıkarılabilir metin yoktur. Notlar görseller incelenerek yazılmıştır; boş hücreler ve çelişen etiketler korunmuştur.",
      "ar": "لا يحتوي الملصق الأصلي على نص قابل للاستخراج. أُعدت الملاحظات بمراجعة الصور؛ حُفظت الخانات الفارغة وتسميات المصدر المتعارضة.",
      "ru": "Одностраничный оригинал не содержит извлекаемого текста. Заметки подготовлены по изображениям; пустые ячейки и противоречивые подписи сохранены."
    },
    "derivativeNote": {
      "fa": "نسخهٔ وبِ مشتق‌شده: جلد و ۲۵ پنل شماره‌دارِ پوستر در ۲۶ صفحه جدا شده‌اند؛ تصاویر برای وب بهینه شده‌اند و شمارهٔ پنل اصلی حفظ شده است. فایل بارگذاری‌شدهٔ اصلی تغییر نکرده است.",
      "en": "Derived web edition: the cover and 25 numbered poster panels are separated into 26 pages, with optimized images and original panel numbers retained. The uploaded original is unchanged.",
      "tr": "Türetilmiş web sürümü: kapak ve 25 numaralı poster paneli 26 sayfaya ayrıldı; görseller optimize edildi, özgün panel numaraları korundu. Yüklenen asıl dosya değişmedi.",
      "ar": "نسخة ويب مشتقة: فُصل الغلاف و25 لوحة مرقمة إلى 26 صفحة، مع تحسين الصور والحفاظ على أرقام اللوحات الأصلية. الملف المرفوع لم يتغير.",
      "ru": "Веб-версия: обложка и 25 панелей разделены на 26 страниц; изображения оптимизированы, исходные номера сохранены. Загруженный оригинал не изменён."
    },
    "sections": [
      {
        "id": "cover",
        "title": {
          "fa": "جلد و هویت سند",
          "en": "Cover and document identity",
          "tr": "Kapak ve belge kimliği",
          "ar": "الغلاف وهوية الوثيقة",
          "ru": "Обложка и происхождение"
        },
        "summary": {
          "fa": "فایل ارسالی با برند ایده‌آل ماکو؛ تاریخ انتشار تأیید نشده است.",
          "en": "An Ideal Makoo branded upload; publication date is unverified.",
          "tr": "Ideal Makoo markalı yükleme; yayın tarihi doğrulanmamıştır.",
          "ar": "ملف مرفوع بعلامة إيده‌آل ماكو؛ تاريخ النشر غير مؤكّد.",
          "ru": "Загруженный документ с брендом Ideal Makoo; дата публикации не подтверждена."
        },
        "text": "جلد با نشان IDEAL MAKOO DENTAL GROUP و عنوان Mould Chart ارائه شده است. این یک فایل ارسالی بدون تاریخ انتشار تأییدشده است. نشان‌های چاپ‌شده در آثار آرشیوی به معنی تأیید اعتبار فعلی گواهی یا موجودی محصول نیستند.",
        "pageStart": 1,
        "pageEnd": 1,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-01.jpg",
        "sourcePage": 1,
        "sourcePanel": 0
      },
      {
        "id": "appearance",
        "title": {
          "fa": "ساختار و جلوهٔ دندان",
          "en": "Tooth structure and appearance",
          "tr": "Diş yapısı ve görünümü",
          "ar": "بنية السن ومظهره",
          "ru": "Структура и внешний вид зубов"
        },
        "summary": {
          "fa": "تصویر توضیحیِ لایه‌های ظاهری، گردن تیره‌تر و شفافیت لبهٔ دندان.",
          "en": "An annotated illustration of darker necks, surface character and incisal translucency.",
          "tr": "Koyu boyun bölgesi, yüzey karakteri ve kesici kenar saydamlığının açıklamalı görseli.",
          "ar": "رسم توضيحي لعنق أغمق وملامح السطح وشفافية الحافة القاطعة.",
          "ru": "Иллюстрация тёмной шейки, фактуры поверхности и прозрачности режущего края."
        },
        "text": "صفحهٔ معرفی دندان‌های ایده‌آل ماکو، الگوگیری از شکل دندان طبیعی و تقارن دندان‌های چپ و راست را توضیح می‌دهد. تصویر به ناحیهٔ گردنی تیره‌تر، ساختارهای داخلی، جلوهٔ آبی/سفید، بازتاب سطح و شفافیت بیشتر لبهٔ اینسایزال اشاره می‌کند. متن، پیوند دندان با آکریل و ویژگی‌های ظاهری، پرداخت و ثبات رنگ را توصیف می‌کند؛ این توصیف‌های کاتالوگی جایگزین گزارش آزمون یا راهنمای کاربرد محصول نیستند. در بخش پایین این پنل دو طرح شماتیک شبکهٔ پلیمری نیز چاپ شده است؛ این تصاویر نمودار توضیحی‌اند و اندازه‌گیری آزمایشگاهی محسوب نمی‌شوند.",
        "pageStart": 2,
        "pageEnd": 2,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-02.jpg",
        "sourcePage": 1,
        "sourcePanel": 1
      },
      {
        "id": "mould-families",
        "title": {
          "fa": "فرم‌های مربعی، مثلثی و بیضی",
          "en": "Square, triangular and oval forms",
          "tr": "Kare, üçgen ve oval formlar",
          "ar": "الأشكال المربعة والمثلثة والبيضاوية",
          "ru": "Квадратные, треугольные и овальные формы"
        },
        "summary": {
          "fa": "سه خانوادهٔ شکلیِ قالب در تصویر اصلی؛ انتخاب نهایی به بررسی متخصص نیاز دارد.",
          "en": "The three illustrated mould families; final selection requires professional assessment.",
          "tr": "Kaynakta gösterilen üç kalıp ailesi; son seçim uzman değerlendirmesi gerektirir.",
          "ar": "عائلات القوالب الثلاث في الرسم الأصلي؛ الاختيار النهائي يحتاج تقييم المختص.",
          "ru": "Три группы форм на исходной иллюстрации; выбор требует оценки специалиста."
        },
        "text": "سند، فرم دندان‌های قدامی بالا را با سه گروه square tooth، triangular tooth و oval tooth شرح می‌دهد. تصویر راهنما، صورت‌های مربعی، قلبی/مثلثی و بیضی را کنار نماد قالب نشان می‌دهد. فرم مربعی زوایای مشخص‌تر، فرم مثلثی ظاهر کشیده‌تر و فرم بیضی قوس ملایم‌تر دارد. این دسته‌بندی تصویری به‌خودی‌خود دستور انتخاب بالینی یا جدول سازگاری قالب با برند نیست.",
        "pageStart": 3,
        "pageEnd": 3,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-03.jpg",
        "sourcePage": 1,
        "sourcePanel": 2
      },
      {
        "id": "square-upper",
        "title": {
          "fa": "قالب‌های مربعی قدامی بالا",
          "en": "Square upper anterior moulds",
          "tr": "Kare üst ön diş kalıpları",
          "ar": "قوالب أمامية علوية مربعة",
          "ru": "Квадратные формы верхних передних зубов"
        },
        "summary": {
          "fa": "کدهای چاپ‌شدهٔ قالب‌های مربعی؛ بعضی خانه‌ها در فایل اصلی خالی‌اند.",
          "en": "Printed square mould codes; some cells are empty in the supplied original.",
          "tr": "Basılı kare kalıp kodları; sağlanan asıldaki bazı hücreler boştur.",
          "ar": "رموز القوالب المربعة المطبوعة؛ بعض الخانات فارغة في الملف الأصلي.",
          "ru": "Напечатанные коды квадратных форм; часть ячеек в оригинале пуста."
        },
        "text": "صفحهٔ Upper Anteriors / square tooth کدهای I10، I11، I12، I13، I14، I15، I16، I56، I64، I66 و I68 را نشان می‌دهد. برخی خانه‌ها یا تصاویر ردیف‌ها در نسخهٔ ارسالی خالی هستند. فقط وجود این کدها در سند ثبت می‌شود؛ تصویر یا عدد خالی بازسازی نشده و از این صفحه برای تولید فهرست واریانت قابل سفارش استفاده نشده است.",
        "pageStart": 4,
        "pageEnd": 4,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-04.jpg",
        "sourcePage": 1,
        "sourcePanel": 3
      },
      {
        "id": "triangular-upper",
        "title": {
          "fa": "قالب‌های مثلثی قدامی بالا",
          "en": "Triangular upper anterior moulds",
          "tr": "Üçgen üst ön diş kalıpları",
          "ar": "قوالب أمامية علوية مثلثة",
          "ru": "Треугольные формы верхних передних зубов"
        },
        "summary": {
          "fa": "ردیف‌های مثلثی در نسخهٔ ارسالی؛ ابعاد ناقص یا نامطمئن تکمیل نشده‌اند.",
          "en": "Triangular rows from the upload; incomplete or uncertain dimensions remain unfilled.",
          "tr": "Yüklemedeki üçgen satırlar; eksik veya belirsiz ölçüler doldurulmamıştır.",
          "ar": "صفوف القوالب المثلثة؛ لم تُستكمل الأبعاد الناقصة أو غير المؤكدة.",
          "ru": "Ряды треугольных форм; неполные или неясные размеры не дополнялись."
        },
        "text": "صفحهٔ Upper Anteriors / triangular tooth ردیف‌هایی با کدهای I21، I22، I24، I26، I27، I41، I4، I42 و I43 دارد. ردیف‌ها، تصاویر و بعضی مقادیر در نسخهٔ بازیابی‌شده کامل نیستند. متن پنهان یا تکراریِ استخراج‌شده از PDF برای پر کردن ابعاد استفاده نشده است؛ ملاک مشاهدهٔ صفحهٔ واقعی است.",
        "pageStart": 5,
        "pageEnd": 5,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-05.jpg",
        "sourcePage": 1,
        "sourcePanel": 4
      },
      {
        "id": "oval-upper",
        "title": {
          "fa": "قالب‌های بیضی قدامی بالا",
          "en": "Oval upper anterior moulds",
          "tr": "Oval üst ön diş kalıpları",
          "ar": "قوالب أمامية علوية بيضاوية",
          "ru": "Овальные формы верхних передних зубов"
        },
        "summary": {
          "fa": "گروه بیضی و کدهای قابل‌خواندنِ منبع، همراه خانه‌های خالی اصلی.",
          "en": "The oval group and legible source codes, retaining the original empty cells.",
          "tr": "Oval grup ve okunabilir kaynak kodları; özgün boş hücreler korunmuştur.",
          "ar": "المجموعة البيضاوية والرموز المقروءة مع الخانات الأصلية الفارغة.",
          "ru": "Овальная группа и читаемые коды с сохранёнными пустыми ячейками."
        },
        "text": "صفحهٔ Upper Anteriors / oval tooth شامل کدهای I31، I32، I34، I36، I52 و I54 است. نماد بیضی کنار گروه و نمودارهای اندازه دیده می‌شود. تصاویر یا خانه‌های خالیِ نسخهٔ ارسالی حفظ شده‌اند. کدهای این صفحه به معنای موجودی فعلی یا سازگاری با تمام سری‌های محصول نیستند.",
        "pageStart": 6,
        "pageEnd": 6,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-06.jpg",
        "sourcePage": 1,
        "sourcePanel": 5
      },
      {
        "id": "lower-anterior",
        "title": {
          "fa": "قالب‌های دندان قدامی پایین",
          "en": "Lower anterior moulds",
          "tr": "Alt ön diş kalıpları",
          "ar": "قوالب الأسنان الأمامية السفلية",
          "ru": "Формы нижних передних зубов"
        },
        "summary": {
          "fa": "نمای ردیف‌های قدامی پایین؛ وضعیت ناقص بعضی خانه‌ها حفظ شده است.",
          "en": "Lower anterior rows with the source’s incomplete cells retained.",
          "tr": "Kaynağın eksik hücreleri korunarak alt ön diş satırları.",
          "ar": "صفوف الأسنان الأمامية السفلية مع الحفاظ على الخانات الناقصة.",
          "ru": "Ряды нижних передних зубов с сохранением неполных ячеек."
        },
        "text": "صفحهٔ lower Anteriors tooth گروه دندان‌های قدامی پایین را با کدهای I1، I2، I3، I5، I6، I7، I8 و I10 نمایش می‌دهد. بعضی ردیف‌ها فاقد تصویر یا ابعاد خوانا هستند. دادهٔ تکمیلی برای ردیف‌های خالی ساخته نشده است.",
        "pageStart": 7,
        "pageEnd": 7,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-07.jpg",
        "sourcePage": 1,
        "sourcePanel": 6
      },
      {
        "id": "posterior-n-t",
        "title": {
          "fa": "گروه‌های خلفی N و T",
          "en": "N and T posterior groups",
          "tr": "N ve T arka diş grupları",
          "ar": "مجموعات الأسنان الخلفية N وT",
          "ru": "Группы боковых зубов N и T"
        },
        "summary": {
          "fa": "نمای کلی خانواده‌های N و T؛ این صفحه جدول تطبیق قطعی ارائه نمی‌کند.",
          "en": "An overview of N and T families; this page does not establish a compatibility matrix.",
          "tr": "N ve T ailelerine genel bakış; bu sayfa uyumluluk matrisi oluşturmaz.",
          "ar": "نظرة عامة على عائلتي N وT؛ الصفحة لا تثبت جدول توافق.",
          "ru": "Обзор групп N и T; страница не подтверждает таблицу совместимости."
        },
        "text": "صفحهٔ posterier tooth گروه N را با N3، N4 و N5 و گروه T را با T4 نشان می‌دهد. این صفحهٔ نمای کلی با جدول اندازه‌های تصویریِ پایانی متفاوت است. محل‌های خالیِ تصویر و جدول، اطلاعات تأییدشدهٔ تطبیق قدامی و خلفی فراهم نمی‌کنند.",
        "pageStart": 8,
        "pageEnd": 8,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-08.jpg",
        "sourcePage": 1,
        "sourcePanel": 7
      },
      {
        "id": "matching-square",
        "title": {
          "fa": "جدول تطبیق مربعی؛ خانه‌های خالی",
          "en": "Square matching table · empty cells",
          "tr": "Kare eşleştirme tablosu · boş hücreler",
          "ar": "جدول التوافق المربع · خانات فارغة",
          "ru": "Таблица квадратных форм · пустые ячейки"
        },
        "summary": {
          "fa": "قالب جدول در سند وجود دارد؛ بدنهٔ آن فاقد دادهٔ قابل‌استفاده است.",
          "en": "The table layout is present, but its body contains no usable matching data.",
          "tr": "Tablo düzeni vardır; gövdesinde kullanılabilir eşleştirme verisi yoktur.",
          "ar": "هيكل الجدول موجود؛ جسمه لا يحتوي بيانات توافق قابلة للاستخدام.",
          "ru": "Разметка таблицы есть, но данных для сопоставления в ней нет."
        },
        "text": "جدول square tooth ستون‌های anterior tooth، upper، lower و posterior teeth را دارد، اما خانه‌های بدنه در نسخهٔ ارسالی خالی هستند. هیچ جفت قالب قدامی/خلفی از این جدول استخراج نشده است.",
        "pageStart": 9,
        "pageEnd": 9,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-09.jpg",
        "sourcePage": 1,
        "sourcePanel": 8
      },
      {
        "id": "matching-triangular",
        "title": {
          "fa": "جدول تطبیق مثلثی؛ خانه‌های خالی",
          "en": "Triangular matching table · empty cells",
          "tr": "Üçgen eşleştirme tablosu · boş hücreler",
          "ar": "جدول التوافق المثلث · خانات فارغة",
          "ru": "Таблица треугольных форм · пустые ячейки"
        },
        "summary": {
          "fa": "خانه‌های جدول منبع خالی هستند و به‌عنوان دادهٔ محصول استفاده نشده‌اند.",
          "en": "The source cells are empty and have not been used as product data.",
          "tr": "Kaynak hücreleri boştur ve ürün verisi olarak kullanılmamıştır.",
          "ar": "خانات المصدر فارغة ولم تُستخدم كبيانات للمنتج.",
          "ru": "Ячейки источника пусты и не используются как данные о продукте."
        },
        "text": "جدول triangular tooth عنوان‌ها و خطوط شبکه را نشان می‌دهد، اما خانه‌های تطبیق دندان قدامی بالا، پایین و خلفی در فایل اصلی خالی‌اند. نبود داده به‌صورت صریح حفظ شده و با دادهٔ سری دیگری جایگزین نشده است.",
        "pageStart": 10,
        "pageEnd": 10,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-10.jpg",
        "sourcePage": 1,
        "sourcePanel": 9
      },
      {
        "id": "matching-oval",
        "title": {
          "fa": "جدول تطبیق بیضی؛ خانه‌های خالی",
          "en": "Oval matching table · empty cells",
          "tr": "Oval eşleştirme tablosu · boş hücreler",
          "ar": "جدول التوافق البيضاوي · خانات فارغة",
          "ru": "Таблица овальных форм · пустые ячейки"
        },
        "summary": {
          "fa": "نسخهٔ اصلی فقط ساختار جدول را نشان می‌دهد؛ کد تطبیق درج نشده است.",
          "en": "The original shows only the table structure; no matching codes are supplied.",
          "tr": "Asıl belge yalnızca tablo yapısını gösterir; eşleştirme kodu verilmemiştir.",
          "ar": "يعرض الأصل بنية الجدول فقط؛ لا توجد رموز توافق.",
          "ru": "В оригинале показана только структура таблицы без кодов соответствия."
        },
        "text": "جدول oval tooth شامل سربرگ تطبیق دندان‌های قدامی و خلفی است. ردیف‌های بدنه فاقد کد و مقدارند. از این صفحه نمی‌توان سازگاری قالب یا ترکیب سفارش نتیجه گرفت.",
        "pageStart": 11,
        "pageEnd": 11,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-11.jpg",
        "sourcePage": 1,
        "sourcePanel": 10
      },
      {
        "id": "small-medium-anterior",
        "title": {
          "fa": "ابعاد قدامی کوچک و متوسط",
          "en": "Small and medium anterior dimensions",
          "tr": "Küçük ve orta ön diş ölçüleri",
          "ar": "أبعاد الأسنان الأمامية الصغيرة والمتوسطة",
          "ru": "Размеры малых и средних передних зубов"
        },
        "summary": {
          "fa": "تصاویر و اندازه‌های Small/Medium در ستون‌های Soft و Bold؛ بخشی از ردیف‌ها ناقص است.",
          "en": "Small/Medium illustrations and measurements in Soft and Bold columns; some rows are incomplete.",
          "tr": "Soft ve Bold sütunlarında Small/Medium görselleri ve ölçüler; bazı satırlar eksiktir.",
          "ar": "صور وأبعاد Small/Medium ضمن عمودي Soft وBold؛ بعض الصفوف ناقصة.",
          "ru": "Иллюстрации и размеры Small/Medium в столбцах Soft и Bold; часть строк неполна."
        },
        "text": "جدول Anterior Teeth دو گروه SMALL و MEDIUM و دو ستون SOFT و Bold را نمایش می‌دهد. فلش short تا long ترتیب نسبی ارتفاع را نشان می‌دهد. برخی ردیف‌ها عکس دارند و برخی عکس یا عدد کامل ندارند. ابعادِ قابل‌خواندن در کنار تصویر گروه و طرح یک دندان درج شده‌اند؛ واحد اندازه در این صفحه صریحاً نوشته نشده است. مقدار نامطمئن یا کد ناقص بازنویسی نشده است.",
        "pageStart": 12,
        "pageEnd": 12,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-12.jpg",
        "sourcePage": 1,
        "sourcePanel": 11
      },
      {
        "id": "large-lower-anterior",
        "title": {
          "fa": "ابعاد قدامی بزرگ و فک پایین",
          "en": "Large and lower anterior dimensions",
          "tr": "Büyük ve alt ön diş ölçüleri",
          "ar": "أبعاد الأسنان الأمامية الكبيرة والسفلية",
          "ru": "Размеры крупных и нижних передних зубов"
        },
        "summary": {
          "fa": "دندان‌های قدامی بزرگ و پایین با نماهای گروهی و تکی؛ کدهای ناخوانا حدس زده نشده‌اند.",
          "en": "Large and lower anterior group and individual views; unreadable codes were not guessed.",
          "tr": "Büyük ve alt ön dişlerin grup ve tekli görünümleri; okunamayan kodlar tahmin edilmedi.",
          "ar": "مناظر جماعية وفردية للأسنان الأمامية الكبيرة والسفلية؛ لم تُخمَّن الرموز غير المقروءة.",
          "ru": "Групповые и одиночные виды крупных и нижних передних зубов; нечитаемые коды не угадывались."
        },
        "text": "بخش بالایی LARGE Anterior Teeth و بخش پایینی Anterior lower Teeth را در ستون‌های SOFT و Bold نشان می‌دهد. کدهای خوانای نمونه شامل I68، A56، I27، A17 در بخش بالا و I6، I7 و I8 در بخش پایین است. بعضی کدها در فایل ارسالی دیده نمی‌شوند؛ از روی عکس یا طول گروه حدس زده نشده‌اند. اعداد کنار طرح دندان باید همراه همان تصویر و بدون فرض واحد یا سازگاری با یک برند خوانده شوند.",
        "pageStart": 13,
        "pageEnd": 13,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-13.jpg",
        "sourcePage": 1,
        "sourcePanel": 12
      },
      {
        "id": "posterior-dimensions",
        "title": {
          "fa": "ابعاد تصویری دندان‌های خلفی",
          "en": "Illustrated posterior dimensions",
          "tr": "Görselli arka diş ölçüleri",
          "ar": "الأبعاد المصورة للأسنان الخلفية",
          "ru": "Иллюстрированные размеры боковых зубов"
        },
        "summary": {
          "fa": "پنج ردیف T4 و N3 تا N6 با اعداد قابل‌خواندن؛ عکس N4 در منبع خالی است.",
          "en": "Five legible rows, T4 and N3–N6; the N4 tooth photograph is absent in the source.",
          "tr": "T4 ve N3–N6 olmak üzere beş okunabilir satır; kaynakta N4 diş fotoğrafı yoktur.",
          "ar": "خمسة صفوف مقروءة T4 وN3–N6؛ صورة أسنان N4 غير موجودة في المصدر.",
          "ru": "Пять читаемых рядов T4 и N3–N6; фотография зубов N4 отсутствует в источнике."
        },
        "text": "جدول Posterior Teeth ردیف‌های T4، N3، N4، N5 و N6 را نشان می‌دهد. طول گروه بالا و پایین به‌ترتیب چنین چاپ شده است: T4 برابر 30.3 و 32.5؛ N3 برابر 29 و 31.5؛ N4 برابر 31.8 و 34.3؛ N5 برابر 31.1 و 33.6؛ N6 برابر 34.1 و 36.4. ردیف N4 در فایل ارسالی فاقد عکس دندان است، اما اعداد و طرح کناری آن وجود دارد. واحد در این صفحه تصریح نشده است. این جدول تنها بازنویسی مقادیر چاپ‌شدهٔ سند است و ارتباط آن با تمام سری‌ها، موجودی یا نسخهٔ فعلی محصول تأیید نشده است.",
        "pageStart": 14,
        "pageEnd": 14,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-14.jpg",
        "sourcePage": 1,
        "sourcePanel": 13,
        "tables": [
          {
            "id": "posterior-printed-measurements",
            "title": {
              "fa": "مقادیر چاپ‌شده در نمودار خلفی",
              "en": "Values printed in the posterior diagram",
              "tr": "Arka diş şemasında basılı değerler",
              "ar": "القيم المطبوعة في مخطط الأسنان الخلفية",
              "ru": "Значения из схемы боковых зубов"
            },
            "columns": [
              {
                "key": "code",
                "label": {
                  "fa": "کد",
                  "en": "Code",
                  "tr": "Kod",
                  "ar": "الرمز",
                  "ru": "Код"
                }
              },
              {
                "key": "upperSpan",
                "label": {
                  "fa": "طول گروه بالا",
                  "en": "Upper group span",
                  "tr": "Üst grup genişliği",
                  "ar": "امتداد المجموعة العلوية",
                  "ru": "Протяжённость верхней группы"
                }
              },
              {
                "key": "lowerSpan",
                "label": {
                  "fa": "طول گروه پایین",
                  "en": "Lower group span",
                  "tr": "Alt grup genişliği",
                  "ar": "امتداد المجموعة السفلية",
                  "ru": "Протяжённость нижней группы"
                }
              },
              {
                "key": "upperWidth",
                "label": {
                  "fa": "عدد عرض طرح بالا",
                  "en": "Upper outline width",
                  "tr": "Üst kontur genişliği",
                  "ar": "عرض المخطط العلوي",
                  "ru": "Ширина верхнего контура"
                }
              },
              {
                "key": "lowerWidth",
                "label": {
                  "fa": "عدد عرض طرح پایین",
                  "en": "Lower outline width",
                  "tr": "Alt kontur genişliği",
                  "ar": "عرض المخطط السفلي",
                  "ru": "Ширина нижнего контура"
                }
              }
            ],
            "rows": [
              {
                "code": "T4",
                "upperSpan": "30.3",
                "lowerSpan": "32.5",
                "upperWidth": "8.5",
                "lowerWidth": "8"
              },
              {
                "code": "N3",
                "upperSpan": "29",
                "lowerSpan": "31.5",
                "upperWidth": "8.5",
                "lowerWidth": "8"
              },
              {
                "code": "N4",
                "upperSpan": "31.8",
                "lowerSpan": "34.3",
                "upperWidth": "9.1",
                "lowerWidth": "8.7"
              },
              {
                "code": "N5",
                "upperSpan": "31.1",
                "lowerSpan": "33.6",
                "upperWidth": "8.4",
                "lowerWidth": "8"
              },
              {
                "code": "N6",
                "upperSpan": "34.1",
                "lowerSpan": "36.4",
                "upperWidth": "9.74",
                "lowerWidth": "9.18"
              }
            ],
            "note": {
              "fa": "واحد در این صفحه نوشته نشده است. عنوان ستون‌ها شرح جای اعداد در تصویر است. عکس N4 در اصل خالی است. این جدول برای تأیید موجودی، واریانت یا سازگاری با یک محصول کافی نیست.",
              "en": "Units are not stated on this page. Column labels describe the positions in the diagram. The N4 photograph is missing in the original. This table does not establish availability, variants or compatibility with a product.",
              "tr": "Bu sayfada birim belirtilmemiştir. Sütun adları şemadaki konumları açıklar. Asılda N4 fotoğrafı yoktur. Tablo stok, varyant veya ürün uyumluluğunu doğrulamaz.",
              "ar": "الوحدة غير مذكورة في الصفحة. تصف عناوين الأعمدة مواضع الأرقام في الرسم. صورة N4 مفقودة في الأصل. لا يثبت الجدول التوفر أو المتغيرات أو التوافق مع منتج.",
              "ru": "Единицы на странице не указаны. Заголовки поясняют расположение чисел на схеме. Фото N4 в оригинале отсутствует. Таблица не подтверждает наличие, варианты или совместимость с продуктом."
            }
          }
        ]
      },
      {
        "id": "president",
        "title": {
          "fa": "معرفی پرزیدنت در کاتالوگ",
          "en": "President catalogue profile",
          "tr": "President katalog tanıtımı",
          "ar": "تعريف پرزیدنت في الكتالوج",
          "ru": "President в каталоге"
        },
        "summary": {
          "fa": "معرفی آرشیوی پرزیدنت: 5 لایه و 6 پخت در متن سند.",
          "en": "Archival President profile: 5 layers and 6 curing steps are printed.",
          "tr": "Arşivdeki President tanıtımı: belgede 5 katman ve 6 pişirme adımı yazılıdır.",
          "ar": "تعريف أرشيفي لـپرزیدنت: يذكر النص 5 طبقات و6 مراحل معالجة.",
          "ru": "Архивное описание President: в документе указаны 5 слоя и 6 этапа обработки."
        },
        "text": "پنل معرفی پرزیدنت، تصویر بسته‌های قدامی و خلفی، شرح فارسی محصول و جعبهٔ مواد را نشان می‌دهد. تعداد لایه و پختِ چاپ‌شده: 5 layer + 6 cook. نانوکامپوزیت؛ بدون درصد ترکیب در این پنل. متن ویژگی‌ها به ظاهر، پرداخت، رنگ و قالب اشاره می‌کند. ارقام و ادعاهای این سند آرشیوی با برچسب منبع نگهداری می‌شوند و جایگزین برگهٔ فنیِ نسخهٔ جاری، گزارش آزمون، IFU، موجودی یا جدول واریانت قابل سفارش نیستند.",
        "pageStart": 15,
        "pageEnd": 15,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-15.jpg",
        "sourcePage": 1,
        "sourcePanel": 14,
        "productIds": [
          "president"
        ]
      },
      {
        "id": "bstar-nano-composite",
        "title": {
          "fa": "معرفی بی‌استار نانوکامپوزیت در کاتالوگ",
          "en": "B.STAR nanocomposite catalogue profile",
          "tr": "B.STAR nanocomposite katalog tanıtımı",
          "ar": "تعريف بی‌استار نانوکامپوزیت في الكتالوج",
          "ru": "B.STAR nanocomposite в каталоге"
        },
        "summary": {
          "fa": "معرفی آرشیوی بی‌استار نانوکامپوزیت: 4 لایه و 5 پخت در متن سند.",
          "en": "Archival B.STAR nanocomposite profile: 4 layers and 5 curing steps are printed.",
          "tr": "Arşivdeki B.STAR nanocomposite tanıtımı: belgede 4 katman ve 5 pişirme adımı yazılıdır.",
          "ar": "تعريف أرشيفي لـبی‌استار نانوکامپوزیت: يذكر النص 4 طبقات و5 مراحل معالجة.",
          "ru": "Архивное описание B.STAR nanocomposite: в документе указаны 4 слоя и 5 этапа обработки."
        },
        "text": "پنل معرفی بی‌استار نانوکامپوزیت، تصویر بسته‌های قدامی و خلفی، شرح فارسی محصول و جعبهٔ مواد را نشان می‌دهد. تعداد لایه و پختِ چاپ‌شده: 4 layer + 5 cook. 35% NANO COMPOSIT MATERIAL + 20% THF MMA + 5% Ray sorb MATERIAL + 40% PMMA Nano Grade. این واژه‌ها عین برچسب انگلیسی هستند و تعریف مستقل ماده یا نتیجهٔ آزمایش محسوب نمی‌شوند. متن ویژگی‌ها به ظاهر، پرداخت، رنگ و قالب اشاره می‌کند. ارقام و ادعاهای این سند آرشیوی با برچسب منبع نگهداری می‌شوند و جایگزین برگهٔ فنیِ نسخهٔ جاری، گزارش آزمون، IFU، موجودی یا جدول واریانت قابل سفارش نیستند.",
        "pageStart": 16,
        "pageEnd": 16,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-16.jpg",
        "sourcePage": 1,
        "sourcePanel": 15,
        "productIds": [
          "bstar-nano-composite"
        ]
      },
      {
        "id": "bstar-nano-glass-archive",
        "title": {
          "fa": "معرفی بی‌استار نانو پلن / نانو گلس (عنوان سند) در کاتالوگ",
          "en": "B.STAR nano plan / nano glas catalogue profile",
          "tr": "B.STAR nano plan / nano glas katalog tanıtımı",
          "ar": "تعريف بی‌استار نانو پلن / نانو گلس (عنوان سند) في الكتالوج",
          "ru": "B.STAR nano plan / nano glas в каталоге"
        },
        "summary": {
          "fa": "معرفی آرشیوی بی‌استار نانو پلن / نانو گلس (عنوان سند): 4 لایه و 5 پخت در متن سند.",
          "en": "Archival B.STAR nano plan / nano glas profile: 4 layers and 5 curing steps are printed.",
          "tr": "Arşivdeki B.STAR nano plan / nano glas tanıtımı: belgede 4 katman ve 5 pişirme adımı yazılıdır.",
          "ar": "تعريف أرشيفي لـبی‌استار نانو پلن / نانو گلس (عنوان سند): يذكر النص 4 طبقات و5 مراحل معالجة.",
          "ru": "Архивное описание B.STAR nano plan / nano glas: в документе указаны 4 слоя и 5 этапа обработки."
        },
        "text": "پنل معرفی بی‌استار نانو پلن / نانو گلس (عنوان سند)، تصویر بسته‌های قدامی و خلفی، شرح فارسی محصول و جعبهٔ مواد را نشان می‌دهد. تعداد لایه و پختِ چاپ‌شده: 4 layer + 5 cook. 35% NANO COMPOSIT MATERIAL + 20% THF MMA + 5% Ray sorb MATERIAL + 40% PMMA Nano Grade. عنوان بالای پنل nano plan_ nano glas است، درحالی‌که روی تصویر بسته‌ها NANOBASE دیده می‌شود؛ این ناهمخوانی سند به محصول جاری جدید تبدیل نشده است. متن ویژگی‌ها به ظاهر، پرداخت، رنگ و قالب اشاره می‌کند. ارقام و ادعاهای این سند آرشیوی با برچسب منبع نگهداری می‌شوند و جایگزین برگهٔ فنیِ نسخهٔ جاری، گزارش آزمون، IFU، موجودی یا جدول واریانت قابل سفارش نیستند.",
        "pageStart": 17,
        "pageEnd": 17,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-17.jpg",
        "sourcePage": 1,
        "sourcePanel": 16
      },
      {
        "id": "bstar-nano-base",
        "title": {
          "fa": "معرفی بی‌استار نانو بیس در کاتالوگ",
          "en": "B.STAR nano base catalogue profile",
          "tr": "B.STAR nano base katalog tanıtımı",
          "ar": "تعريف بی‌استار نانو بیس في الكتالوج",
          "ru": "B.STAR nano base в каталоге"
        },
        "summary": {
          "fa": "معرفی آرشیوی بی‌استار نانو بیس: 4 لایه و 5 پخت در متن سند.",
          "en": "Archival B.STAR nano base profile: 4 layers and 5 curing steps are printed.",
          "tr": "Arşivdeki B.STAR nano base tanıtımı: belgede 4 katman ve 5 pişirme adımı yazılıdır.",
          "ar": "تعريف أرشيفي لـبی‌استار نانو بیس: يذكر النص 4 طبقات و5 مراحل معالجة.",
          "ru": "Архивное описание B.STAR nano base: в документе указаны 4 слоя и 5 этапа обработки."
        },
        "text": "پنل معرفی بی‌استار نانو بیس، تصویر بسته‌های قدامی و خلفی، شرح فارسی محصول و جعبهٔ مواد را نشان می‌دهد. تعداد لایه و پختِ چاپ‌شده: 4 layer + 5 cook. در این پنل، عنوان B.STAR nano base است اما متن بدنه و جعبهٔ مواد B-STAR Nano Glass را ذکر می‌کنند. برچسب 35% NANO COMPOSIT MATERIAL + 20% THF MMA + 5% Ray sorb MATERIAL + 40% PMMA Nano Grade چاپ شده است. این اختلاف نام‌ها بدون اصلاح حدسی حفظ شده است. متن ویژگی‌ها به ظاهر، پرداخت، رنگ و قالب اشاره می‌کند. ارقام و ادعاهای این سند آرشیوی با برچسب منبع نگهداری می‌شوند و جایگزین برگهٔ فنیِ نسخهٔ جاری، گزارش آزمون، IFU، موجودی یا جدول واریانت قابل سفارش نیستند.",
        "pageStart": 18,
        "pageEnd": 18,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-18.jpg",
        "sourcePage": 1,
        "sourcePanel": 17,
        "productIds": [
          "bstar-nano-base"
        ]
      },
      {
        "id": "apple",
        "title": {
          "fa": "معرفی اپل در کاتالوگ",
          "en": "Apple catalogue profile",
          "tr": "Apple katalog tanıtımı",
          "ar": "تعريف اپل في الكتالوج",
          "ru": "Apple в каталоге"
        },
        "summary": {
          "fa": "معرفی آرشیوی اپل: 4 لایه و 5 پخت در متن سند.",
          "en": "Archival Apple profile: 4 layers and 5 curing steps are printed.",
          "tr": "Arşivdeki Apple tanıtımı: belgede 4 katman ve 5 pişirme adımı yazılıdır.",
          "ar": "تعريف أرشيفي لـاپل: يذكر النص 4 طبقات و5 مراحل معالجة.",
          "ru": "Архивное описание Apple: в документе указаны 4 слоя и 5 этапа обработки."
        },
        "text": "پنل معرفی اپل، تصویر بسته‌های قدامی و خلفی، شرح فارسی محصول و جعبهٔ مواد را نشان می‌دهد. تعداد لایه و پختِ چاپ‌شده: 4 layer + 5 cook. 30% coposite + 20 isosit + 10% glanz + 40% PMMA. عبارت‌های coposite و glanz واژه‌های چاپ‌شدهٔ سند هستند. متن ویژگی‌ها به ظاهر، پرداخت، رنگ و قالب اشاره می‌کند. ارقام و ادعاهای این سند آرشیوی با برچسب منبع نگهداری می‌شوند و جایگزین برگهٔ فنیِ نسخهٔ جاری، گزارش آزمون، IFU، موجودی یا جدول واریانت قابل سفارش نیستند.",
        "pageStart": 19,
        "pageEnd": 19,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-19.jpg",
        "sourcePage": 1,
        "sourcePanel": 18,
        "productIds": [
          "apple"
        ]
      },
      {
        "id": "glamour",
        "title": {
          "fa": "معرفی گلامور در کاتالوگ",
          "en": "Glamour catalogue profile",
          "tr": "Glamour katalog tanıtımı",
          "ar": "تعريف گلامور في الكتالوج",
          "ru": "Glamour в каталоге"
        },
        "summary": {
          "fa": "معرفی آرشیوی گلامور: 4 لایه و 5 پخت در متن سند.",
          "en": "Archival Glamour profile: 4 layers and 5 curing steps are printed.",
          "tr": "Arşivdeki Glamour tanıtımı: belgede 4 katman ve 5 pişirme adımı yazılıdır.",
          "ar": "تعريف أرشيفي لـگلامور: يذكر النص 4 طبقات و5 مراحل معالجة.",
          "ru": "Архивное описание Glamour: в документе указаны 4 слоя и 5 этапа обработки."
        },
        "text": "پنل معرفی گلامور، تصویر بسته‌های قدامی و خلفی، شرح فارسی محصول و جعبهٔ مواد را نشان می‌دهد. تعداد لایه و پختِ چاپ‌شده: 4 layer + 5 cook. 25% coposite + 25 isosit + 50% PMMA، مطابق نوشتار جعبهٔ ترکیب در سند. متن ویژگی‌ها به ظاهر، پرداخت، رنگ و قالب اشاره می‌کند. ارقام و ادعاهای این سند آرشیوی با برچسب منبع نگهداری می‌شوند و جایگزین برگهٔ فنیِ نسخهٔ جاری، گزارش آزمون، IFU، موجودی یا جدول واریانت قابل سفارش نیستند.",
        "pageStart": 20,
        "pageEnd": 20,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-20.jpg",
        "sourcePage": 1,
        "sourcePanel": 19,
        "productIds": [
          "glamour"
        ]
      },
      {
        "id": "yaghoot",
        "title": {
          "fa": "معرفی یاقوت در کاتالوگ",
          "en": "Yaghoot catalogue profile",
          "tr": "Yaghoot katalog tanıtımı",
          "ar": "تعريف یاقوت في الكتالوج",
          "ru": "Yaghoot в каталоге"
        },
        "summary": {
          "fa": "معرفی آرشیوی یاقوت: 3 لایه و 4 پخت در متن سند.",
          "en": "Archival Yaghoot profile: 3 layers and 4 curing steps are printed.",
          "tr": "Arşivdeki Yaghoot tanıtımı: belgede 3 katman ve 4 pişirme adımı yazılıdır.",
          "ar": "تعريف أرشيفي لـیاقوت: يذكر النص 3 طبقات و4 مراحل معالجة.",
          "ru": "Архивное описание Yaghoot: в документе указаны 3 слоя и 4 этапа обработки."
        },
        "text": "پنل معرفی یاقوت، تصویر بسته‌های قدامی و خلفی، شرح فارسی محصول و جعبهٔ مواد را نشان می‌دهد. تعداد لایه و پختِ چاپ‌شده: 3 layer + 4 cook. 25% coposite + 20 isosit + 55% PMMA، مطابق نوشتار جعبهٔ ترکیب در سند. متن ویژگی‌ها به ظاهر، پرداخت، رنگ و قالب اشاره می‌کند. ارقام و ادعاهای این سند آرشیوی با برچسب منبع نگهداری می‌شوند و جایگزین برگهٔ فنیِ نسخهٔ جاری، گزارش آزمون، IFU، موجودی یا جدول واریانت قابل سفارش نیستند.",
        "pageStart": 21,
        "pageEnd": 21,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-21.jpg",
        "sourcePage": 1,
        "sourcePanel": 20,
        "productIds": [
          "yaghoot"
        ]
      },
      {
        "id": "super-berelian",
        "title": {
          "fa": "معرفی سوپر برلیان در کاتالوگ",
          "en": "Super Berelian catalogue profile",
          "tr": "Super Berelian katalog tanıtımı",
          "ar": "تعريف سوپر برلیان في الكتالوج",
          "ru": "Super Berelian в каталоге"
        },
        "summary": {
          "fa": "معرفی آرشیوی سوپر برلیان: 3 لایه و 4 پخت در متن سند.",
          "en": "Archival Super Berelian profile: 3 layers and 4 curing steps are printed.",
          "tr": "Arşivdeki Super Berelian tanıtımı: belgede 3 katman ve 4 pişirme adımı yazılıdır.",
          "ar": "تعريف أرشيفي لـسوپر برلیان: يذكر النص 3 طبقات و4 مراحل معالجة.",
          "ru": "Архивное описание Super Berelian: в документе указаны 3 слоя и 4 этапа обработки."
        },
        "text": "پنل معرفی سوپر برلیان، تصویر بسته‌های قدامی و خلفی، شرح فارسی محصول و جعبهٔ مواد را نشان می‌دهد. تعداد لایه و پختِ چاپ‌شده: 3 layer + 4 cook. 13% coposite + 15 isosit + 72% PMMA، مطابق نوشتار جعبهٔ ترکیب در سند. متن ویژگی‌ها به ظاهر، پرداخت، رنگ و قالب اشاره می‌کند. ارقام و ادعاهای این سند آرشیوی با برچسب منبع نگهداری می‌شوند و جایگزین برگهٔ فنیِ نسخهٔ جاری، گزارش آزمون، IFU، موجودی یا جدول واریانت قابل سفارش نیستند.",
        "pageStart": 22,
        "pageEnd": 22,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-22.jpg",
        "sourcePage": 1,
        "sourcePanel": 21,
        "productIds": [
          "super-berelian"
        ]
      },
      {
        "id": "berelian",
        "title": {
          "fa": "معرفی برلیان در کاتالوگ",
          "en": "Berelian catalogue profile",
          "tr": "Berelian katalog tanıtımı",
          "ar": "تعريف برلیان في الكتالوج",
          "ru": "Berelian в каталоге"
        },
        "summary": {
          "fa": "معرفی آرشیوی برلیان: 2 لایه و 3 پخت در متن سند.",
          "en": "Archival Berelian profile: 2 layers and 3 curing steps are printed.",
          "tr": "Arşivdeki Berelian tanıtımı: belgede 2 katman ve 3 pişirme adımı yazılıdır.",
          "ar": "تعريف أرشيفي لـبرلیان: يذكر النص 2 طبقات و3 مراحل معالجة.",
          "ru": "Архивное описание Berelian: в документе указаны 2 слоя и 3 этапа обработки."
        },
        "text": "پنل معرفی برلیان، تصویر بسته‌های قدامی و خلفی، شرح فارسی محصول و جعبهٔ مواد را نشان می‌دهد. تعداد لایه و پختِ چاپ‌شده: 2 layer + 3 cook. 10% coposite + 15 isosit + 75% PMMA، مطابق نوشتار جعبهٔ ترکیب در سند. متن ویژگی‌ها به ظاهر، پرداخت، رنگ و قالب اشاره می‌کند. ارقام و ادعاهای این سند آرشیوی با برچسب منبع نگهداری می‌شوند و جایگزین برگهٔ فنیِ نسخهٔ جاری، گزارش آزمون، IFU، موجودی یا جدول واریانت قابل سفارش نیستند.",
        "pageStart": 23,
        "pageEnd": 23,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-23.jpg",
        "sourcePage": 1,
        "sourcePanel": 22,
        "productIds": [
          "berelian"
        ]
      },
      {
        "id": "marjan-new",
        "title": {
          "fa": "معرفی مرجان / مرجان نیو در کاتالوگ",
          "en": "Marjan / Marjan New catalogue profile",
          "tr": "Marjan / Marjan New katalog tanıtımı",
          "ar": "تعريف مرجان / مرجان نیو في الكتالوج",
          "ru": "Marjan / Marjan New в каталоге"
        },
        "summary": {
          "fa": "معرفی آرشیوی مرجان / مرجان نیو: 2 لایه و 3 پخت در متن سند.",
          "en": "Archival Marjan / Marjan New profile: 2 layers and 3 curing steps are printed.",
          "tr": "Arşivdeki Marjan / Marjan New tanıtımı: belgede 2 katman ve 3 pişirme adımı yazılıdır.",
          "ar": "تعريف أرشيفي لـمرجان / مرجان نیو: يذكر النص 2 طبقات و3 مراحل معالجة.",
          "ru": "Архивное описание Marjan / Marjan New: в документе указаны 2 слоя и 3 этапа обработки."
        },
        "text": "پنل معرفی مرجان / مرجان نیو، تصویر بسته‌های قدامی و خلفی، شرح فارسی محصول و جعبهٔ مواد را نشان می‌دهد. تعداد لایه و پختِ چاپ‌شده: 2 layer + 3 cook. 13% cross linker + 10% Isosit + 77% PMMA. عنوان صفحه MARJAN است و بسته‌ها MARJAN New را نشان می‌دهند. متن ویژگی‌ها به ظاهر، پرداخت، رنگ و قالب اشاره می‌کند. ارقام و ادعاهای این سند آرشیوی با برچسب منبع نگهداری می‌شوند و جایگزین برگهٔ فنیِ نسخهٔ جاری، گزارش آزمون، IFU، موجودی یا جدول واریانت قابل سفارش نیستند.",
        "pageStart": 24,
        "pageEnd": 24,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-24.jpg",
        "sourcePage": 1,
        "sourcePanel": 23,
        "productIds": [
          "marjan-new"
        ]
      },
      {
        "id": "super-newclar",
        "title": {
          "fa": "معرفی سوپر نیوکلار در کاتالوگ",
          "en": "Super Newclar catalogue profile",
          "tr": "Super Newclar katalog tanıtımı",
          "ar": "تعريف سوپر نیوکلار في الكتالوج",
          "ru": "Super Newclar в каталоге"
        },
        "summary": {
          "fa": "معرفی آرشیوی سوپر نیوکلار: 2 لایه و 3 پخت در متن سند.",
          "en": "Archival Super Newclar profile: 2 layers and 3 curing steps are printed.",
          "tr": "Arşivdeki Super Newclar tanıtımı: belgede 2 katman ve 3 pişirme adımı yazılıdır.",
          "ar": "تعريف أرشيفي لـسوپر نیوکلار: يذكر النص 2 طبقات و3 مراحل معالجة.",
          "ru": "Архивное описание Super Newclar: в документе указаны 2 слоя и 3 этапа обработки."
        },
        "text": "پنل معرفی سوپر نیوکلار، تصویر بسته‌های قدامی و خلفی، شرح فارسی محصول و جعبهٔ مواد را نشان می‌دهد. تعداد لایه و پختِ چاپ‌شده: 2 layer + 3 cook. 7% cross linker + 93% PMMA، مطابق نوشتار جعبهٔ ترکیب در سند. متن ویژگی‌ها به ظاهر، پرداخت، رنگ و قالب اشاره می‌کند. ارقام و ادعاهای این سند آرشیوی با برچسب منبع نگهداری می‌شوند و جایگزین برگهٔ فنیِ نسخهٔ جاری، گزارش آزمون، IFU، موجودی یا جدول واریانت قابل سفارش نیستند.",
        "pageStart": 25,
        "pageEnd": 25,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-25.jpg",
        "sourcePage": 1,
        "sourcePanel": 24,
        "productIds": [
          "super-newclar"
        ]
      },
      {
        "id": "newclar",
        "title": {
          "fa": "معرفی نیوکلار در کاتالوگ",
          "en": "Newclar catalogue profile",
          "tr": "Newclar katalog tanıtımı",
          "ar": "تعريف نیوکلار في الكتالوج",
          "ru": "Newclar в каталоге"
        },
        "summary": {
          "fa": "معرفی آرشیوی نیوکلار: 1 لایه و 2 پخت در متن سند.",
          "en": "Archival Newclar profile: 1 layers and 2 curing steps are printed.",
          "tr": "Arşivdeki Newclar tanıtımı: belgede 1 katman ve 2 pişirme adımı yazılıdır.",
          "ar": "تعريف أرشيفي لـنیوکلار: يذكر النص 1 طبقات و2 مراحل معالجة.",
          "ru": "Архивное описание Newclar: в документе указаны 1 слоя и 2 этапа обработки."
        },
        "text": "پنل معرفی نیوکلار، تصویر بسته‌های قدامی و خلفی، شرح فارسی محصول و جعبهٔ مواد را نشان می‌دهد. تعداد لایه و پختِ چاپ‌شده: 1 layer + 2 cook. 7% cross linker + 93% PMMA، مطابق نوشتار جعبهٔ ترکیب در سند. متن ویژگی‌ها به ظاهر، پرداخت، رنگ و قالب اشاره می‌کند. ارقام و ادعاهای این سند آرشیوی با برچسب منبع نگهداری می‌شوند و جایگزین برگهٔ فنیِ نسخهٔ جاری، گزارش آزمون، IFU، موجودی یا جدول واریانت قابل سفارش نیستند.",
        "pageStart": 26,
        "pageEnd": 26,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-26.jpg",
        "sourcePage": 1,
        "sourcePanel": 25,
        "productIds": [
          "newclar"
        ]
      }
    ],
    "pages": [
      {
        "page": 1,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-01.jpg",
        "width": 1210,
        "height": 1776,
        "sourcePanel": 0,
        "sourcePage": 1,
        "title": {
          "fa": "جلد و هویت سند",
          "en": "Cover and document identity",
          "tr": "Kapak ve belge kimliği",
          "ar": "الغلاف وهوية الوثيقة",
          "ru": "Обложка и происхождение"
        }
      },
      {
        "page": 2,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-02.jpg",
        "width": 1220,
        "height": 1776,
        "sourcePanel": 1,
        "sourcePage": 1,
        "title": {
          "fa": "ساختار و جلوهٔ دندان",
          "en": "Tooth structure and appearance",
          "tr": "Diş yapısı ve görünümü",
          "ar": "بنية السن ومظهره",
          "ru": "Структура и внешний вид зубов"
        }
      },
      {
        "page": 3,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-03.jpg",
        "width": 1219,
        "height": 1776,
        "sourcePanel": 2,
        "sourcePage": 1,
        "title": {
          "fa": "فرم‌های مربعی، مثلثی و بیضی",
          "en": "Square, triangular and oval forms",
          "tr": "Kare, üçgen ve oval formlar",
          "ar": "الأشكال المربعة والمثلثة والبيضاوية",
          "ru": "Квадратные, треугольные и овальные формы"
        }
      },
      {
        "page": 4,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-04.jpg",
        "width": 1221,
        "height": 1776,
        "sourcePanel": 3,
        "sourcePage": 1,
        "title": {
          "fa": "قالب‌های مربعی قدامی بالا",
          "en": "Square upper anterior moulds",
          "tr": "Kare üst ön diş kalıpları",
          "ar": "قوالب أمامية علوية مربعة",
          "ru": "Квадратные формы верхних передних зубов"
        }
      },
      {
        "page": 5,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-05.jpg",
        "width": 1220,
        "height": 1776,
        "sourcePanel": 4,
        "sourcePage": 1,
        "title": {
          "fa": "قالب‌های مثلثی قدامی بالا",
          "en": "Triangular upper anterior moulds",
          "tr": "Üçgen üst ön diş kalıpları",
          "ar": "قوالب أمامية علوية مثلثة",
          "ru": "Треугольные формы верхних передних зубов"
        }
      },
      {
        "page": 6,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-06.jpg",
        "width": 1222,
        "height": 1776,
        "sourcePanel": 5,
        "sourcePage": 1,
        "title": {
          "fa": "قالب‌های بیضی قدامی بالا",
          "en": "Oval upper anterior moulds",
          "tr": "Oval üst ön diş kalıpları",
          "ar": "قوالب أمامية علوية بيضاوية",
          "ru": "Овальные формы верхних передних зубов"
        }
      },
      {
        "page": 7,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-07.jpg",
        "width": 1257,
        "height": 1776,
        "sourcePanel": 6,
        "sourcePage": 1,
        "title": {
          "fa": "قالب‌های دندان قدامی پایین",
          "en": "Lower anterior moulds",
          "tr": "Alt ön diş kalıpları",
          "ar": "قوالب الأسنان الأمامية السفلية",
          "ru": "Формы нижних передних зубов"
        }
      },
      {
        "page": 8,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-08.jpg",
        "width": 1210,
        "height": 1775,
        "sourcePanel": 7,
        "sourcePage": 1,
        "title": {
          "fa": "گروه‌های خلفی N و T",
          "en": "N and T posterior groups",
          "tr": "N ve T arka diş grupları",
          "ar": "مجموعات الأسنان الخلفية N وT",
          "ru": "Группы боковых зубов N и T"
        }
      },
      {
        "page": 9,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-09.jpg",
        "width": 1225,
        "height": 1775,
        "sourcePanel": 8,
        "sourcePage": 1,
        "title": {
          "fa": "جدول تطبیق مربعی؛ خانه‌های خالی",
          "en": "Square matching table · empty cells",
          "tr": "Kare eşleştirme tablosu · boş hücreler",
          "ar": "جدول التوافق المربع · خانات فارغة",
          "ru": "Таблица квадратных форм · пустые ячейки"
        }
      },
      {
        "page": 10,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-10.jpg",
        "width": 1223,
        "height": 1775,
        "sourcePanel": 9,
        "sourcePage": 1,
        "title": {
          "fa": "جدول تطبیق مثلثی؛ خانه‌های خالی",
          "en": "Triangular matching table · empty cells",
          "tr": "Üçgen eşleştirme tablosu · boş hücreler",
          "ar": "جدول التوافق المثلث · خانات فارغة",
          "ru": "Таблица треугольных форм · пустые ячейки"
        }
      },
      {
        "page": 11,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-11.jpg",
        "width": 1222,
        "height": 1775,
        "sourcePanel": 10,
        "sourcePage": 1,
        "title": {
          "fa": "جدول تطبیق بیضی؛ خانه‌های خالی",
          "en": "Oval matching table · empty cells",
          "tr": "Oval eşleştirme tablosu · boş hücreler",
          "ar": "جدول التوافق البيضاوي · خانات فارغة",
          "ru": "Таблица овальных форм · пустые ячейки"
        }
      },
      {
        "page": 12,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-12.jpg",
        "width": 1226,
        "height": 1775,
        "sourcePanel": 11,
        "sourcePage": 1,
        "title": {
          "fa": "ابعاد قدامی کوچک و متوسط",
          "en": "Small and medium anterior dimensions",
          "tr": "Küçük ve orta ön diş ölçüleri",
          "ar": "أبعاد الأسنان الأمامية الصغيرة والمتوسطة",
          "ru": "Размеры малых и средних передних зубов"
        }
      },
      {
        "page": 13,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-13.jpg",
        "width": 1227,
        "height": 1775,
        "sourcePanel": 12,
        "sourcePage": 1,
        "title": {
          "fa": "ابعاد قدامی بزرگ و فک پایین",
          "en": "Large and lower anterior dimensions",
          "tr": "Büyük ve alt ön diş ölçüleri",
          "ar": "أبعاد الأسنان الأمامية الكبيرة والسفلية",
          "ru": "Размеры крупных и нижних передних зубов"
        }
      },
      {
        "page": 14,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-14.jpg",
        "width": 1236,
        "height": 1775,
        "sourcePanel": 13,
        "sourcePage": 1,
        "title": {
          "fa": "ابعاد تصویری دندان‌های خلفی",
          "en": "Illustrated posterior dimensions",
          "tr": "Görselli arka diş ölçüleri",
          "ar": "الأبعاد المصورة للأسنان الخلفية",
          "ru": "Иллюстрированные размеры боковых зубов"
        }
      },
      {
        "page": 15,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-15.jpg",
        "width": 1210,
        "height": 1775,
        "sourcePanel": 14,
        "sourcePage": 1,
        "title": {
          "fa": "معرفی پرزیدنت در کاتالوگ",
          "en": "President catalogue profile",
          "tr": "President katalog tanıtımı",
          "ar": "تعريف پرزیدنت في الكتالوج",
          "ru": "President в каталоге"
        }
      },
      {
        "page": 16,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-16.jpg",
        "width": 1225,
        "height": 1775,
        "sourcePanel": 15,
        "sourcePage": 1,
        "title": {
          "fa": "معرفی بی‌استار نانوکامپوزیت در کاتالوگ",
          "en": "B.STAR nanocomposite catalogue profile",
          "tr": "B.STAR nanocomposite katalog tanıtımı",
          "ar": "تعريف بی‌استار نانوکامپوزیت في الكتالوج",
          "ru": "B.STAR nanocomposite в каталоге"
        }
      },
      {
        "page": 17,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-17.jpg",
        "width": 1224,
        "height": 1775,
        "sourcePanel": 16,
        "sourcePage": 1,
        "title": {
          "fa": "معرفی بی‌استار نانو پلن / نانو گلس (عنوان سند) در کاتالوگ",
          "en": "B.STAR nano plan / nano glas catalogue profile",
          "tr": "B.STAR nano plan / nano glas katalog tanıtımı",
          "ar": "تعريف بی‌استار نانو پلن / نانو گلس (عنوان سند) في الكتالوج",
          "ru": "B.STAR nano plan / nano glas в каталоге"
        }
      },
      {
        "page": 18,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-18.jpg",
        "width": 1226,
        "height": 1775,
        "sourcePanel": 17,
        "sourcePage": 1,
        "title": {
          "fa": "معرفی بی‌استار نانو بیس در کاتالوگ",
          "en": "B.STAR nano base catalogue profile",
          "tr": "B.STAR nano base katalog tanıtımı",
          "ar": "تعريف بی‌استار نانو بیس في الكتالوج",
          "ru": "B.STAR nano base в каталоге"
        }
      },
      {
        "page": 19,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-19.jpg",
        "width": 1230,
        "height": 1775,
        "sourcePanel": 18,
        "sourcePage": 1,
        "title": {
          "fa": "معرفی اپل در کاتالوگ",
          "en": "Apple catalogue profile",
          "tr": "Apple katalog tanıtımı",
          "ar": "تعريف اپل في الكتالوج",
          "ru": "Apple в каталоге"
        }
      },
      {
        "page": 20,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-20.jpg",
        "width": 1239,
        "height": 1775,
        "sourcePanel": 19,
        "sourcePage": 1,
        "title": {
          "fa": "معرفی گلامور در کاتالوگ",
          "en": "Glamour catalogue profile",
          "tr": "Glamour katalog tanıtımı",
          "ar": "تعريف گلامور في الكتالوج",
          "ru": "Glamour в каталоге"
        }
      },
      {
        "page": 21,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-21.jpg",
        "width": 1215,
        "height": 1775,
        "sourcePanel": 20,
        "sourcePage": 1,
        "title": {
          "fa": "معرفی یاقوت در کاتالوگ",
          "en": "Yaghoot catalogue profile",
          "tr": "Yaghoot katalog tanıtımı",
          "ar": "تعريف یاقوت في الكتالوج",
          "ru": "Yaghoot в каталоге"
        }
      },
      {
        "page": 22,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-22.jpg",
        "width": 1205,
        "height": 1776,
        "sourcePanel": 21,
        "sourcePage": 1,
        "title": {
          "fa": "معرفی سوپر برلیان در کاتالوگ",
          "en": "Super Berelian catalogue profile",
          "tr": "Super Berelian katalog tanıtımı",
          "ar": "تعريف سوپر برلیان في الكتالوج",
          "ru": "Super Berelian в каталоге"
        }
      },
      {
        "page": 23,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-23.jpg",
        "width": 1225,
        "height": 1776,
        "sourcePanel": 22,
        "sourcePage": 1,
        "title": {
          "fa": "معرفی برلیان در کاتالوگ",
          "en": "Berelian catalogue profile",
          "tr": "Berelian katalog tanıtımı",
          "ar": "تعريف برلیان في الكتالوج",
          "ru": "Berelian в каталоге"
        }
      },
      {
        "page": 24,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-24.jpg",
        "width": 1223,
        "height": 1776,
        "sourcePanel": 23,
        "sourcePage": 1,
        "title": {
          "fa": "معرفی مرجان / مرجان نیو در کاتالوگ",
          "en": "Marjan / Marjan New catalogue profile",
          "tr": "Marjan / Marjan New katalog tanıtımı",
          "ar": "تعريف مرجان / مرجان نیو في الكتالوج",
          "ru": "Marjan / Marjan New в каталоге"
        }
      },
      {
        "page": 25,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-25.jpg",
        "width": 1215,
        "height": 1776,
        "sourcePanel": 24,
        "sourcePage": 1,
        "title": {
          "fa": "معرفی سوپر نیوکلار در کاتالوگ",
          "en": "Super Newclar catalogue profile",
          "tr": "Super Newclar katalog tanıtımı",
          "ar": "تعريف سوپر نیوکلار في الكتالوج",
          "ru": "Super Newclar в каталоге"
        }
      },
      {
        "page": 26,
        "image": "/media/documents/previews/ideal-makoo-complete-catalogue-page-26.jpg",
        "width": 1217,
        "height": 1776,
        "sourcePanel": 25,
        "sourcePage": 1,
        "title": {
          "fa": "معرفی نیوکلار در کاتالوگ",
          "en": "Newclar catalogue profile",
          "tr": "Newclar katalog tanıtımı",
          "ar": "تعريف نیوکلار في الكتالوج",
          "ru": "Newclar в каталоге"
        }
      }
    ]
  },
  {
    "id": "ideal-makoo-mould-guide",
    "originalFileName": "enigmalife-mould-chart-pdf-Recovered2222-Recovered.pdf",
    "sourcePageCount": 14,
    "sourceBytes": 55859721,
    "sourceSha256": "a17af8e145c595ec8760f346210efe0a8d66698b3a0df05bb5cd9afa1cc03f1d",
    "pageCount": 14,
    "webBytes": 4904373,
    "webSha256": "135d8e652d00a877a183b449728d591658d8f45ae8a72897c1e58dc2289227eb",
    "url": "/media/documents/ideal-makoo-mould-guide-web.pdf",
    "localDownloadUrl": "/media/documents/ideal-makoo-mould-guide-web.pdf",
    "slug": "ideal-makoo-mould-guide",
    "title": {
      "fa": "راهنمای تصویری قالب‌های ایده‌آل ماکو",
      "en": "Ideal Makoo illustrated mould guide",
      "tr": "Ideal Makoo görselli kalıp rehberi",
      "ar": "دليل إيده‌آل ماكو المصوّر للقوالب",
      "ru": "Иллюстрированное руководство по формам Ideal Makoo"
    },
    "summary": {
      "fa": "۱۴ صفحه از ساختار و فرم دندان، نمودارهای اندازه و جدول‌های قالب؛ همراه توضیح خانه‌های ناقص منبع.",
      "en": "14 pages of tooth form, measurement diagrams and mould tables, with the source’s incomplete cells identified.",
      "tr": "Diş formu, ölçü şemaları ve kalıp tablolarından 14 sayfa; kaynaktaki eksik hücreler belirtilmiştir.",
      "ar": "14 صفحة عن أشكال الأسنان ومخططات الأبعاد وجداول القوالب، مع توضيح الخانات الناقصة في المصدر.",
      "ru": "14 страниц о формах зубов, схемах размеров и таблицах с указанием неполных ячеек источника."
    },
    "kind": "mould-chart",
    "sourceBrand": "Ideal Makoo",
    "relationship": "company",
    "sourceType": "user-upload",
    "publishedAt": null,
    "bytes": 4904373,
    "extractionNote": {
      "fa": "نام فایل بازیابی‌شده شامل Enigmalife است، اما جلد و محتوای قابل‌مشاهده نشان ایده‌آل ماکو دارند. بعضی جدول‌ها و تصاویر در همین فایل اصلی ناقص‌اند؛ دادهٔ پنهان یا حدسی برای تکمیل آن‌ها استفاده نشده است.",
      "en": "The recovered filename contains Enigmalife, but the visible cover and content bear Ideal Makoo branding. Some tables and photographs are incomplete in the supplied original; hidden text or guesses were not used to fill them.",
      "tr": "Kurtarılmış dosya adında Enigmalife geçer; görünen kapak ve içerik Ideal Makoo markalıdır. Asıldaki eksik tablolar ve fotoğraflar gizli metin veya tahminle tamamlanmamıştır.",
      "ar": "يتضمن اسم الملف المستعاد Enigmalife، لكن الغلاف والمحتوى المرئي يحملان علامة إيده‌آل ماكو. بعض الجداول والصور ناقصة في الأصل؛ لم تُستكمل بنص مخفي أو تخمين.",
      "ru": "Имя восстановленного файла содержит Enigmalife, однако обложка и видимый материал имеют бренд Ideal Makoo. Пробелы в таблицах и фотографиях не заполнялись скрытым текстом или догадками."
    },
    "derivativeNote": {
      "fa": "نسخهٔ وبِ مشتق‌شده با همان ۱۴ صفحه و ترتیب اصلی؛ تصاویر بهینه شده‌اند. فایل بارگذاری‌شدهٔ اصلی تغییر نکرده است.",
      "en": "A derived web edition with the same 14 pages and source order; images are optimized. The uploaded original is unchanged.",
      "tr": "Özgün 14 sayfa ve sıra korunan türetilmiş web sürümü; görseller optimize edildi. Yüklenen asıl dosya değişmedi.",
      "ar": "نسخة ويب مشتقة تحافظ على الصفحات الأربع عشرة وترتيبها؛ حُسنت الصور. الملف المرفوع لم يتغير.",
      "ru": "Веб-версия сохраняет 14 страниц и их порядок; изображения оптимизированы. Загруженный оригинал не изменён."
    },
    "sections": [
      {
        "id": "cover",
        "title": {
          "fa": "جلد و هویت سند",
          "en": "Cover and document identity",
          "tr": "Kapak ve belge kimliği",
          "ar": "الغلاف وهوية الوثيقة",
          "ru": "Обложка и происхождение"
        },
        "summary": {
          "fa": "فایل ارسالی با برند ایده‌آل ماکو؛ تاریخ انتشار تأیید نشده است.",
          "en": "An Ideal Makoo branded upload; publication date is unverified.",
          "tr": "Ideal Makoo markalı yükleme; yayın tarihi doğrulanmamıştır.",
          "ar": "ملف مرفوع بعلامة إيده‌آل ماكو؛ تاريخ النشر غير مؤكّد.",
          "ru": "Загруженный документ с брендом Ideal Makoo; дата публикации не подтверждена."
        },
        "text": "جلد با نشان IDEAL MAKOO DENTAL GROUP و عنوان Mould Chart ارائه شده است. این یک فایل ارسالی بدون تاریخ انتشار تأییدشده است. نشان‌های چاپ‌شده در آثار آرشیوی به معنی تأیید اعتبار فعلی گواهی یا موجودی محصول نیستند.",
        "pageStart": 1,
        "pageEnd": 1,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-01.jpg",
        "sourcePage": 1
      },
      {
        "id": "appearance",
        "title": {
          "fa": "ساختار و جلوهٔ دندان",
          "en": "Tooth structure and appearance",
          "tr": "Diş yapısı ve görünümü",
          "ar": "بنية السن ومظهره",
          "ru": "Структура и внешний вид зубов"
        },
        "summary": {
          "fa": "تصویر توضیحیِ لایه‌های ظاهری، گردن تیره‌تر و شفافیت لبهٔ دندان.",
          "en": "An annotated illustration of darker necks, surface character and incisal translucency.",
          "tr": "Koyu boyun bölgesi, yüzey karakteri ve kesici kenar saydamlığının açıklamalı görseli.",
          "ar": "رسم توضيحي لعنق أغمق وملامح السطح وشفافية الحافة القاطعة.",
          "ru": "Иллюстрация тёмной шейки, фактуры поверхности и прозрачности режущего края."
        },
        "text": "صفحهٔ معرفی دندان‌های ایده‌آل ماکو، الگوگیری از شکل دندان طبیعی و تقارن دندان‌های چپ و راست را توضیح می‌دهد. تصویر به ناحیهٔ گردنی تیره‌تر، ساختارهای داخلی، جلوهٔ آبی/سفید، بازتاب سطح و شفافیت بیشتر لبهٔ اینسایزال اشاره می‌کند. متن، پیوند دندان با آکریل و ویژگی‌های ظاهری، پرداخت و ثبات رنگ را توصیف می‌کند؛ این توصیف‌های کاتالوگی جایگزین گزارش آزمون یا راهنمای کاربرد محصول نیستند.",
        "pageStart": 2,
        "pageEnd": 2,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-02.jpg",
        "sourcePage": 2
      },
      {
        "id": "mould-families",
        "title": {
          "fa": "فرم‌های مربعی، مثلثی و بیضی",
          "en": "Square, triangular and oval forms",
          "tr": "Kare, üçgen ve oval formlar",
          "ar": "الأشكال المربعة والمثلثة والبيضاوية",
          "ru": "Квадратные, треугольные и овальные формы"
        },
        "summary": {
          "fa": "سه خانوادهٔ شکلیِ قالب در تصویر اصلی؛ انتخاب نهایی به بررسی متخصص نیاز دارد.",
          "en": "The three illustrated mould families; final selection requires professional assessment.",
          "tr": "Kaynakta gösterilen üç kalıp ailesi; son seçim uzman değerlendirmesi gerektirir.",
          "ar": "عائلات القوالب الثلاث في الرسم الأصلي؛ الاختيار النهائي يحتاج تقييم المختص.",
          "ru": "Три группы форм на исходной иллюстрации; выбор требует оценки специалиста."
        },
        "text": "سند، فرم دندان‌های قدامی بالا را با سه گروه square tooth، triangular tooth و oval tooth شرح می‌دهد. تصویر راهنما، صورت‌های مربعی، قلبی/مثلثی و بیضی را کنار نماد قالب نشان می‌دهد. فرم مربعی زوایای مشخص‌تر، فرم مثلثی ظاهر کشیده‌تر و فرم بیضی قوس ملایم‌تر دارد. این دسته‌بندی تصویری به‌خودی‌خود دستور انتخاب بالینی یا جدول سازگاری قالب با برند نیست.",
        "pageStart": 3,
        "pageEnd": 3,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-03.jpg",
        "sourcePage": 3
      },
      {
        "id": "square-upper",
        "title": {
          "fa": "قالب‌های مربعی قدامی بالا",
          "en": "Square upper anterior moulds",
          "tr": "Kare üst ön diş kalıpları",
          "ar": "قوالب أمامية علوية مربعة",
          "ru": "Квадратные формы верхних передних зубов"
        },
        "summary": {
          "fa": "کدهای چاپ‌شدهٔ قالب‌های مربعی؛ بعضی خانه‌ها در فایل اصلی خالی‌اند.",
          "en": "Printed square mould codes; some cells are empty in the supplied original.",
          "tr": "Basılı kare kalıp kodları; sağlanan asıldaki bazı hücreler boştur.",
          "ar": "رموز القوالب المربعة المطبوعة؛ بعض الخانات فارغة في الملف الأصلي.",
          "ru": "Напечатанные коды квадратных форм; часть ячеек в оригинале пуста."
        },
        "text": "صفحهٔ Upper Anteriors / square tooth کدهای I10، I11، I12، I13، I14، I15، I16، I56، I64، I66 و I68 را نشان می‌دهد. برخی خانه‌ها یا تصاویر ردیف‌ها در نسخهٔ ارسالی خالی هستند. فقط وجود این کدها در سند ثبت می‌شود؛ تصویر یا عدد خالی بازسازی نشده و از این صفحه برای تولید فهرست واریانت قابل سفارش استفاده نشده است.",
        "pageStart": 4,
        "pageEnd": 4,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-04.jpg",
        "sourcePage": 4
      },
      {
        "id": "triangular-upper",
        "title": {
          "fa": "قالب‌های مثلثی قدامی بالا",
          "en": "Triangular upper anterior moulds",
          "tr": "Üçgen üst ön diş kalıpları",
          "ar": "قوالب أمامية علوية مثلثة",
          "ru": "Треугольные формы верхних передних зубов"
        },
        "summary": {
          "fa": "ردیف‌های مثلثی در نسخهٔ ارسالی؛ ابعاد ناقص یا نامطمئن تکمیل نشده‌اند.",
          "en": "Triangular rows from the upload; incomplete or uncertain dimensions remain unfilled.",
          "tr": "Yüklemedeki üçgen satırlar; eksik veya belirsiz ölçüler doldurulmamıştır.",
          "ar": "صفوف القوالب المثلثة؛ لم تُستكمل الأبعاد الناقصة أو غير المؤكدة.",
          "ru": "Ряды треугольных форм; неполные или неясные размеры не дополнялись."
        },
        "text": "صفحهٔ Upper Anteriors / triangular tooth ردیف‌هایی با کدهای I21، I22، I24، I26، I27، I41، I4، I42 و I43 دارد. ردیف‌ها، تصاویر و بعضی مقادیر در نسخهٔ بازیابی‌شده کامل نیستند. متن پنهان یا تکراریِ استخراج‌شده از PDF برای پر کردن ابعاد استفاده نشده است؛ ملاک مشاهدهٔ صفحهٔ واقعی است.",
        "pageStart": 5,
        "pageEnd": 5,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-05.jpg",
        "sourcePage": 5
      },
      {
        "id": "oval-upper",
        "title": {
          "fa": "قالب‌های بیضی قدامی بالا",
          "en": "Oval upper anterior moulds",
          "tr": "Oval üst ön diş kalıpları",
          "ar": "قوالب أمامية علوية بيضاوية",
          "ru": "Овальные формы верхних передних зубов"
        },
        "summary": {
          "fa": "گروه بیضی و کدهای قابل‌خواندنِ منبع، همراه خانه‌های خالی اصلی.",
          "en": "The oval group and legible source codes, retaining the original empty cells.",
          "tr": "Oval grup ve okunabilir kaynak kodları; özgün boş hücreler korunmuştur.",
          "ar": "المجموعة البيضاوية والرموز المقروءة مع الخانات الأصلية الفارغة.",
          "ru": "Овальная группа и читаемые коды с сохранёнными пустыми ячейками."
        },
        "text": "صفحهٔ Upper Anteriors / oval tooth شامل کدهای I31، I32، I34، I36، I52 و I54 است. نماد بیضی کنار گروه و نمودارهای اندازه دیده می‌شود. تصاویر یا خانه‌های خالیِ نسخهٔ ارسالی حفظ شده‌اند. کدهای این صفحه به معنای موجودی فعلی یا سازگاری با تمام سری‌های محصول نیستند.",
        "pageStart": 6,
        "pageEnd": 6,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-06.jpg",
        "sourcePage": 6
      },
      {
        "id": "lower-anterior",
        "title": {
          "fa": "قالب‌های دندان قدامی پایین",
          "en": "Lower anterior moulds",
          "tr": "Alt ön diş kalıpları",
          "ar": "قوالب الأسنان الأمامية السفلية",
          "ru": "Формы нижних передних зубов"
        },
        "summary": {
          "fa": "نمای ردیف‌های قدامی پایین؛ وضعیت ناقص بعضی خانه‌ها حفظ شده است.",
          "en": "Lower anterior rows with the source’s incomplete cells retained.",
          "tr": "Kaynağın eksik hücreleri korunarak alt ön diş satırları.",
          "ar": "صفوف الأسنان الأمامية السفلية مع الحفاظ على الخانات الناقصة.",
          "ru": "Ряды нижних передних зубов с сохранением неполных ячеек."
        },
        "text": "صفحهٔ lower Anteriors tooth گروه دندان‌های قدامی پایین را با کدهای I1، I2، I3، I5، I6، I7، I8 و I10 نمایش می‌دهد. بعضی ردیف‌ها فاقد تصویر یا ابعاد خوانا هستند. دادهٔ تکمیلی برای ردیف‌های خالی ساخته نشده است.",
        "pageStart": 7,
        "pageEnd": 7,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-07.jpg",
        "sourcePage": 7
      },
      {
        "id": "posterior-n-t",
        "title": {
          "fa": "گروه‌های خلفی N و T",
          "en": "N and T posterior groups",
          "tr": "N ve T arka diş grupları",
          "ar": "مجموعات الأسنان الخلفية N وT",
          "ru": "Группы боковых зубов N и T"
        },
        "summary": {
          "fa": "نمای کلی خانواده‌های N و T؛ این صفحه جدول تطبیق قطعی ارائه نمی‌کند.",
          "en": "An overview of N and T families; this page does not establish a compatibility matrix.",
          "tr": "N ve T ailelerine genel bakış; bu sayfa uyumluluk matrisi oluşturmaz.",
          "ar": "نظرة عامة على عائلتي N وT؛ الصفحة لا تثبت جدول توافق.",
          "ru": "Обзор групп N и T; страница не подтверждает таблицу совместимости."
        },
        "text": "صفحهٔ posterier tooth گروه N را با N3، N4 و N5 و گروه T را با T4 نشان می‌دهد. این صفحهٔ نمای کلی با جدول اندازه‌های تصویریِ پایانی متفاوت است. محل‌های خالیِ تصویر و جدول، اطلاعات تأییدشدهٔ تطبیق قدامی و خلفی فراهم نمی‌کنند.",
        "pageStart": 8,
        "pageEnd": 8,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-08.jpg",
        "sourcePage": 8
      },
      {
        "id": "matching-square",
        "title": {
          "fa": "جدول تطبیق مربعی؛ خانه‌های خالی",
          "en": "Square matching table · empty cells",
          "tr": "Kare eşleştirme tablosu · boş hücreler",
          "ar": "جدول التوافق المربع · خانات فارغة",
          "ru": "Таблица квадратных форм · пустые ячейки"
        },
        "summary": {
          "fa": "قالب جدول در سند وجود دارد؛ بدنهٔ آن فاقد دادهٔ قابل‌استفاده است.",
          "en": "The table layout is present, but its body contains no usable matching data.",
          "tr": "Tablo düzeni vardır; gövdesinde kullanılabilir eşleştirme verisi yoktur.",
          "ar": "هيكل الجدول موجود؛ جسمه لا يحتوي بيانات توافق قابلة للاستخدام.",
          "ru": "Разметка таблицы есть, но данных для сопоставления в ней нет."
        },
        "text": "جدول square tooth ستون‌های anterior tooth، upper، lower و posterior teeth را دارد، اما خانه‌های بدنه در نسخهٔ ارسالی خالی هستند. هیچ جفت قالب قدامی/خلفی از این جدول استخراج نشده است.",
        "pageStart": 9,
        "pageEnd": 9,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-09.jpg",
        "sourcePage": 9
      },
      {
        "id": "matching-triangular",
        "title": {
          "fa": "جدول تطبیق مثلثی؛ خانه‌های خالی",
          "en": "Triangular matching table · empty cells",
          "tr": "Üçgen eşleştirme tablosu · boş hücreler",
          "ar": "جدول التوافق المثلث · خانات فارغة",
          "ru": "Таблица треугольных форм · пустые ячейки"
        },
        "summary": {
          "fa": "خانه‌های جدول منبع خالی هستند و به‌عنوان دادهٔ محصول استفاده نشده‌اند.",
          "en": "The source cells are empty and have not been used as product data.",
          "tr": "Kaynak hücreleri boştur ve ürün verisi olarak kullanılmamıştır.",
          "ar": "خانات المصدر فارغة ولم تُستخدم كبيانات للمنتج.",
          "ru": "Ячейки источника пусты и не используются как данные о продукте."
        },
        "text": "جدول triangular tooth عنوان‌ها و خطوط شبکه را نشان می‌دهد، اما خانه‌های تطبیق دندان قدامی بالا، پایین و خلفی در فایل اصلی خالی‌اند. نبود داده به‌صورت صریح حفظ شده و با دادهٔ سری دیگری جایگزین نشده است.",
        "pageStart": 10,
        "pageEnd": 10,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-10.jpg",
        "sourcePage": 10
      },
      {
        "id": "matching-oval",
        "title": {
          "fa": "جدول تطبیق بیضی؛ خانه‌های خالی",
          "en": "Oval matching table · empty cells",
          "tr": "Oval eşleştirme tablosu · boş hücreler",
          "ar": "جدول التوافق البيضاوي · خانات فارغة",
          "ru": "Таблица овальных форм · пустые ячейки"
        },
        "summary": {
          "fa": "نسخهٔ اصلی فقط ساختار جدول را نشان می‌دهد؛ کد تطبیق درج نشده است.",
          "en": "The original shows only the table structure; no matching codes are supplied.",
          "tr": "Asıl belge yalnızca tablo yapısını gösterir; eşleştirme kodu verilmemiştir.",
          "ar": "يعرض الأصل بنية الجدول فقط؛ لا توجد رموز توافق.",
          "ru": "В оригинале показана только структура таблицы без кодов соответствия."
        },
        "text": "جدول oval tooth شامل سربرگ تطبیق دندان‌های قدامی و خلفی است. ردیف‌های بدنه فاقد کد و مقدارند. از این صفحه نمی‌توان سازگاری قالب یا ترکیب سفارش نتیجه گرفت.",
        "pageStart": 11,
        "pageEnd": 11,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-11.jpg",
        "sourcePage": 11
      },
      {
        "id": "small-medium-anterior",
        "title": {
          "fa": "ابعاد قدامی کوچک و متوسط",
          "en": "Small and medium anterior dimensions",
          "tr": "Küçük ve orta ön diş ölçüleri",
          "ar": "أبعاد الأسنان الأمامية الصغيرة والمتوسطة",
          "ru": "Размеры малых и средних передних зубов"
        },
        "summary": {
          "fa": "تصاویر و اندازه‌های Small/Medium در ستون‌های Soft و Bold؛ بخشی از ردیف‌ها ناقص است.",
          "en": "Small/Medium illustrations and measurements in Soft and Bold columns; some rows are incomplete.",
          "tr": "Soft ve Bold sütunlarında Small/Medium görselleri ve ölçüler; bazı satırlar eksiktir.",
          "ar": "صور وأبعاد Small/Medium ضمن عمودي Soft وBold؛ بعض الصفوف ناقصة.",
          "ru": "Иллюстрации и размеры Small/Medium в столбцах Soft и Bold; часть строк неполна."
        },
        "text": "جدول Anterior Teeth دو گروه SMALL و MEDIUM و دو ستون SOFT و Bold را نمایش می‌دهد. فلش short تا long ترتیب نسبی ارتفاع را نشان می‌دهد. برخی ردیف‌ها عکس دارند و برخی عکس یا عدد کامل ندارند. ابعادِ قابل‌خواندن در کنار تصویر گروه و طرح یک دندان درج شده‌اند؛ واحد اندازه در این صفحه صریحاً نوشته نشده است. مقدار نامطمئن یا کد ناقص بازنویسی نشده است.",
        "pageStart": 12,
        "pageEnd": 12,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-12.jpg",
        "sourcePage": 12,
        "tables": [
          {
            "id": "small-medium-printed-measurements",
            "title": {
              "fa": "مقادیر خوانای جدول Small / Medium",
              "en": "Legible Small / Medium table values",
              "tr": "Okunabilir Small / Medium tablo değerleri",
              "ar": "القيم المقروءة في جدول Small / Medium",
              "ru": "Читаемые значения Small / Medium"
            },
            "columns": [
              {
                "key": "group",
                "label": {
                  "fa": "گروه چاپ‌شده",
                  "en": "Printed group",
                  "tr": "Basılı grup",
                  "ar": "المجموعة المطبوعة",
                  "ru": "Группа в оригинале"
                }
              },
              {
                "key": "style",
                "label": {
                  "fa": "ستون چاپ‌شده",
                  "en": "Printed column",
                  "tr": "Basılı sütun",
                  "ar": "العمود المطبوع",
                  "ru": "Столбец в оригинале"
                }
              },
              {
                "key": "row",
                "label": {
                  "fa": "ردیف از بالا",
                  "en": "Row from top",
                  "tr": "Yukarıdan satır",
                  "ar": "الصف من الأعلى",
                  "ru": "Ряд сверху"
                }
              },
              {
                "key": "code",
                "label": {
                  "fa": "کد خوانا",
                  "en": "Legible code",
                  "tr": "Okunabilir kod",
                  "ar": "الرمز المقروء",
                  "ru": "Читаемый код"
                }
              },
              {
                "key": "span",
                "label": {
                  "fa": "عدد طول گروه",
                  "en": "Group span value",
                  "tr": "Grup uzunluk değeri",
                  "ar": "قيمة امتداد المجموعة",
                  "ru": "Протяжённость группы"
                }
              },
              {
                "key": "width",
                "label": {
                  "fa": "عدد عرض طرح",
                  "en": "Outline width value",
                  "tr": "Kontur genişlik değeri",
                  "ar": "قيمة عرض المخطط",
                  "ru": "Ширина контура"
                }
              },
              {
                "key": "height",
                "label": {
                  "fa": "عدد ارتفاع طرح",
                  "en": "Outline height value",
                  "tr": "Kontur yükseklik değeri",
                  "ar": "قيمة ارتفاع المخطط",
                  "ru": "Высота контура"
                }
              }
            ],
            "rows": [
              {
                "group": "SMALL",
                "style": "SOFT",
                "row": "1",
                "code": "I22",
                "span": "42.8",
                "width": "7.8",
                "height": "9"
              },
              {
                "group": "SMALL",
                "style": "SOFT",
                "row": "2",
                "code": "I13",
                "span": "43.5",
                "width": "8.4",
                "height": "9.8"
              },
              {
                "group": "SMALL",
                "style": "SOFT",
                "row": "3",
                "code": "",
                "span": "41.9",
                "width": "8.08",
                "height": ""
              },
              {
                "group": "SMALL",
                "style": "SOFT",
                "row": "4",
                "code": "I24",
                "span": "42.4",
                "width": "8.4",
                "height": "10.6"
              },
              {
                "group": "SMALL",
                "style": "Bold",
                "row": "1",
                "code": "I11",
                "span": "41",
                "width": "8",
                "height": "8.1"
              },
              {
                "group": "SMALL",
                "style": "Bold",
                "row": "2",
                "code": "I44",
                "span": "42",
                "width": "7.5",
                "height": "9.9"
              },
              {
                "group": "SMALL",
                "style": "Bold",
                "row": "3",
                "code": "I42",
                "span": "44",
                "width": "7.8",
                "height": "9.9"
              },
              {
                "group": "SMALL",
                "style": "Bold",
                "row": "4",
                "code": "I24",
                "span": "42.4",
                "width": "8.4",
                "height": "10.6"
              },
              {
                "group": "MEDIUM",
                "style": "SOFT",
                "row": "1",
                "code": "I32",
                "span": "44.5",
                "width": "8",
                "height": ""
              },
              {
                "group": "MEDIUM",
                "style": "SOFT",
                "row": "2",
                "code": "I36",
                "span": "46.4",
                "width": "8.6",
                "height": ""
              },
              {
                "group": "MEDIUM",
                "style": "SOFT",
                "row": "3",
                "code": "I14",
                "span": "46.3",
                "width": "8.8",
                "height": ""
              },
              {
                "group": "MEDIUM",
                "style": "SOFT",
                "row": "4",
                "code": "I26",
                "span": "47",
                "width": "8.5",
                "height": "12"
              },
              {
                "group": "MEDIUM",
                "style": "Bold",
                "row": "1",
                "code": "I12",
                "span": "45",
                "width": "8.5",
                "height": "8.8"
              },
              {
                "group": "MEDIUM",
                "style": "Bold",
                "row": "2",
                "code": "I54",
                "span": "46",
                "width": "8.6",
                "height": "9.6"
              },
              {
                "group": "MEDIUM",
                "style": "Bold",
                "row": "3",
                "code": "I66",
                "span": "46",
                "width": "8.8",
                "height": "10.2"
              },
              {
                "group": "MEDIUM",
                "style": "Bold",
                "row": "4",
                "code": "A25",
                "span": "47.1",
                "width": "8.72",
                "height": "10.7"
              }
            ],
            "note": {
              "fa": "مقادیر با مشاهدهٔ خود صفحه خوانده شده‌اند؛ خانهٔ خالی یعنی مقدار یا کد در تصویر ناقص یا ناخواناست. دادهٔ پنهان PDF برای پرکردن آن استفاده نشده است. واحد در صفحه تصریح نشده؛ ردیف‌ها فقط موقعیت چاپ‌شده را مشخص می‌کنند و واریانت یا سازگاری محصول نیستند.",
              "en": "Values were read from the visible page. An empty cell means the code or number is missing or unclear in the image; hidden PDF text was not used to complete it. Units are not stated. Rows identify printed positions, not product variants or compatibility.",
              "tr": "Değerler görünen sayfadan okunmuştur. Boş hücre, görselde eksik veya belirsiz kod/sayı demektir; gizli PDF metniyle doldurulmamıştır. Birim belirtilmez. Satırlar basılı konumları belirtir; ürün varyantı veya uyumluluk değildir.",
              "ar": "قُرئت القيم من الصفحة المرئية. تعني الخانة الفارغة أن الرمز أو الرقم مفقود أو غير واضح؛ لم يُستخدم نص PDF مخفي لإكماله. الوحدة غير مذكورة. الصفوف تحدد مواضع الطباعة وليست متغيرات منتج أو توافقًا.",
              "ru": "Значения прочитаны на видимой странице. Пустая ячейка означает отсутствующий или неясный код/число; скрытый текст PDF не использовался. Единицы не указаны. Ряды отражают положение в документе, а не варианты или совместимость продукта."
            }
          }
        ]
      },
      {
        "id": "large-lower-anterior",
        "title": {
          "fa": "ابعاد قدامی بزرگ و فک پایین",
          "en": "Large and lower anterior dimensions",
          "tr": "Büyük ve alt ön diş ölçüleri",
          "ar": "أبعاد الأسنان الأمامية الكبيرة والسفلية",
          "ru": "Размеры крупных и нижних передних зубов"
        },
        "summary": {
          "fa": "دندان‌های قدامی بزرگ و پایین با نماهای گروهی و تکی؛ کدهای ناخوانا حدس زده نشده‌اند.",
          "en": "Large and lower anterior group and individual views; unreadable codes were not guessed.",
          "tr": "Büyük ve alt ön dişlerin grup ve tekli görünümleri; okunamayan kodlar tahmin edilmedi.",
          "ar": "مناظر جماعية وفردية للأسنان الأمامية الكبيرة والسفلية؛ لم تُخمَّن الرموز غير المقروءة.",
          "ru": "Групповые и одиночные виды крупных и нижних передних зубов; нечитаемые коды не угадывались."
        },
        "text": "بخش بالایی LARGE Anterior Teeth و بخش پایینی Anterior lower Teeth را در ستون‌های SOFT و Bold نشان می‌دهد. کدهای خوانای نمونه شامل I68، A56، I27، A17 در بخش بالا و I6، I7 و I8 در بخش پایین است. بعضی کدها در فایل ارسالی دیده نمی‌شوند؛ از روی عکس یا طول گروه حدس زده نشده‌اند. اعداد کنار طرح دندان باید همراه همان تصویر و بدون فرض واحد یا سازگاری با یک برند خوانده شوند.",
        "pageStart": 13,
        "pageEnd": 13,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-13.jpg",
        "sourcePage": 13,
        "tables": [
          {
            "id": "large-lower-printed-measurements",
            "title": {
              "fa": "مقادیر خوانای جدول Large / Lower",
              "en": "Legible Large / Lower table values",
              "tr": "Okunabilir Large / Lower tablo değerleri",
              "ar": "القيم المقروءة في جدول Large / Lower",
              "ru": "Читаемые значения Large / Lower"
            },
            "columns": [
              {
                "key": "group",
                "label": {
                  "fa": "گروه چاپ‌شده",
                  "en": "Printed group",
                  "tr": "Basılı grup",
                  "ar": "المجموعة المطبوعة",
                  "ru": "Группа в оригинале"
                }
              },
              {
                "key": "style",
                "label": {
                  "fa": "ستون چاپ‌شده",
                  "en": "Printed column",
                  "tr": "Basılı sütun",
                  "ar": "العمود المطبوع",
                  "ru": "Столбец в оригинале"
                }
              },
              {
                "key": "row",
                "label": {
                  "fa": "ردیف از بالا",
                  "en": "Row from top",
                  "tr": "Yukarıdan satır",
                  "ar": "الصف من الأعلى",
                  "ru": "Ряд сверху"
                }
              },
              {
                "key": "code",
                "label": {
                  "fa": "کد خوانا",
                  "en": "Legible code",
                  "tr": "Okunabilir kod",
                  "ar": "الرمز المقروء",
                  "ru": "Читаемый код"
                }
              },
              {
                "key": "span",
                "label": {
                  "fa": "عدد طول گروه",
                  "en": "Group span value",
                  "tr": "Grup uzunluk değeri",
                  "ar": "قيمة امتداد المجموعة",
                  "ru": "Протяжённость группы"
                }
              },
              {
                "key": "width",
                "label": {
                  "fa": "عدد عرض طرح",
                  "en": "Outline width value",
                  "tr": "Kontur genişlik değeri",
                  "ar": "قيمة عرض المخطط",
                  "ru": "Ширина контура"
                }
              },
              {
                "key": "height",
                "label": {
                  "fa": "عدد ارتفاع طرح",
                  "en": "Outline height value",
                  "tr": "Kontur yükseklik değeri",
                  "ar": "قيمة ارتفاع المخطط",
                  "ru": "Высота контура"
                }
              }
            ],
            "rows": [
              {
                "group": "LARGE",
                "style": "SOFT",
                "row": "1",
                "code": "",
                "span": "49",
                "width": "9",
                "height": "10.8"
              },
              {
                "group": "LARGE",
                "style": "SOFT",
                "row": "2",
                "code": "",
                "span": "49.6",
                "width": "",
                "height": "11.5"
              },
              {
                "group": "LARGE",
                "style": "SOFT",
                "row": "3",
                "code": "",
                "span": "48.1",
                "width": "9.02",
                "height": "11.7"
              },
              {
                "group": "LARGE",
                "style": "SOFT",
                "row": "4",
                "code": "",
                "span": "50.7",
                "width": "9.4",
                "height": "12.6"
              },
              {
                "group": "LARGE",
                "style": "Bold",
                "row": "1",
                "code": "I68",
                "span": "49.4",
                "width": "9.2",
                "height": "9.7"
              },
              {
                "group": "LARGE",
                "style": "Bold",
                "row": "2",
                "code": "A56",
                "span": "47.5",
                "width": "8.84",
                "height": "10.3"
              },
              {
                "group": "LARGE",
                "style": "Bold",
                "row": "3",
                "code": "I27",
                "span": "48.5",
                "width": "8.9",
                "height": "10.8"
              },
              {
                "group": "LARGE",
                "style": "Bold",
                "row": "4",
                "code": "A17",
                "span": "51.9",
                "width": "9.84",
                "height": "13.0"
              },
              {
                "group": "LOWER",
                "style": "SOFT",
                "row": "1",
                "code": "",
                "span": "31.5",
                "width": "4.5",
                "height": "8"
              },
              {
                "group": "LOWER",
                "style": "SOFT",
                "row": "2",
                "code": "",
                "span": "32.9",
                "width": "4.8",
                "height": "8.5"
              },
              {
                "group": "LOWER",
                "style": "SOFT",
                "row": "3",
                "code": "",
                "span": "33",
                "width": "5",
                "height": "8.9"
              },
              {
                "group": "LOWER",
                "style": "SOFT",
                "row": "4",
                "code": "",
                "span": "33.5",
                "width": "5.5",
                "height": "9"
              },
              {
                "group": "LOWER",
                "style": "Bold",
                "row": "1",
                "code": "I6",
                "span": "34.6",
                "width": "5",
                "height": "9.4"
              },
              {
                "group": "LOWER",
                "style": "Bold",
                "row": "2",
                "code": "I7",
                "span": "35.9",
                "width": "5.7",
                "height": "9.4"
              },
              {
                "group": "LOWER",
                "style": "Bold",
                "row": "3",
                "code": "I8",
                "span": "38.1",
                "width": "5.7",
                "height": "9.6"
              },
              {
                "group": "LOWER",
                "style": "Bold",
                "row": "4",
                "code": "",
                "span": "37",
                "width": "5.7",
                "height": "10"
              }
            ],
            "note": {
              "fa": "مقادیر با مشاهدهٔ خود صفحه خوانده شده‌اند؛ خانهٔ خالی یعنی مقدار یا کد در تصویر ناقص یا ناخواناست. دادهٔ پنهان PDF برای پرکردن آن استفاده نشده است. واحد در صفحه تصریح نشده؛ ردیف‌ها فقط موقعیت چاپ‌شده را مشخص می‌کنند و واریانت یا سازگاری محصول نیستند.",
              "en": "Values were read from the visible page. An empty cell means the code or number is missing or unclear in the image; hidden PDF text was not used to complete it. Units are not stated. Rows identify printed positions, not product variants or compatibility.",
              "tr": "Değerler görünen sayfadan okunmuştur. Boş hücre, görselde eksik veya belirsiz kod/sayı demektir; gizli PDF metniyle doldurulmamıştır. Birim belirtilmez. Satırlar basılı konumları belirtir; ürün varyantı veya uyumluluk değildir.",
              "ar": "قُرئت القيم من الصفحة المرئية. تعني الخانة الفارغة أن الرمز أو الرقم مفقود أو غير واضح؛ لم يُستخدم نص PDF مخفي لإكماله. الوحدة غير مذكورة. الصفوف تحدد مواضع الطباعة وليست متغيرات منتج أو توافقًا.",
              "ru": "Значения прочитаны на видимой странице. Пустая ячейка означает отсутствующий или неясный код/число; скрытый текст PDF не использовался. Единицы не указаны. Ряды отражают положение в документе, а не варианты или совместимость продукта."
            }
          }
        ]
      },
      {
        "id": "posterior-dimensions",
        "title": {
          "fa": "ابعاد تصویری دندان‌های خلفی",
          "en": "Illustrated posterior dimensions",
          "tr": "Görselli arka diş ölçüleri",
          "ar": "الأبعاد المصورة للأسنان الخلفية",
          "ru": "Иллюстрированные размеры боковых зубов"
        },
        "summary": {
          "fa": "پنج ردیف T4 و N3 تا N6 با اعداد قابل‌خواندن؛ عکس N4 در منبع خالی است.",
          "en": "Five legible rows, T4 and N3–N6; the N4 tooth photograph is absent in the source.",
          "tr": "T4 ve N3–N6 olmak üzere beş okunabilir satır; kaynakta N4 diş fotoğrafı yoktur.",
          "ar": "خمسة صفوف مقروءة T4 وN3–N6؛ صورة أسنان N4 غير موجودة في المصدر.",
          "ru": "Пять читаемых рядов T4 и N3–N6; фотография зубов N4 отсутствует в источнике."
        },
        "text": "جدول Posterior Teeth ردیف‌های T4، N3، N4، N5 و N6 را نشان می‌دهد. طول گروه بالا و پایین به‌ترتیب چنین چاپ شده است: T4 برابر 30.3 و 32.5؛ N3 برابر 29 و 31.5؛ N4 برابر 31.8 و 34.3؛ N5 برابر 31.1 و 33.6؛ N6 برابر 34.1 و 36.4. ردیف N4 در فایل ارسالی فاقد عکس دندان است، اما اعداد و طرح کناری آن وجود دارد. واحد در این صفحه تصریح نشده است. این جدول تنها بازنویسی مقادیر چاپ‌شدهٔ سند است و ارتباط آن با تمام سری‌ها، موجودی یا نسخهٔ فعلی محصول تأیید نشده است.",
        "pageStart": 14,
        "pageEnd": 14,
        "language": "fa",
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-14.jpg",
        "sourcePage": 14,
        "tables": [
          {
            "id": "posterior-printed-measurements",
            "title": {
              "fa": "مقادیر چاپ‌شده در نمودار خلفی",
              "en": "Values printed in the posterior diagram",
              "tr": "Arka diş şemasında basılı değerler",
              "ar": "القيم المطبوعة في مخطط الأسنان الخلفية",
              "ru": "Значения из схемы боковых зубов"
            },
            "columns": [
              {
                "key": "code",
                "label": {
                  "fa": "کد",
                  "en": "Code",
                  "tr": "Kod",
                  "ar": "الرمز",
                  "ru": "Код"
                }
              },
              {
                "key": "upperSpan",
                "label": {
                  "fa": "طول گروه بالا",
                  "en": "Upper group span",
                  "tr": "Üst grup genişliği",
                  "ar": "امتداد المجموعة العلوية",
                  "ru": "Протяжённость верхней группы"
                }
              },
              {
                "key": "lowerSpan",
                "label": {
                  "fa": "طول گروه پایین",
                  "en": "Lower group span",
                  "tr": "Alt grup genişliği",
                  "ar": "امتداد المجموعة السفلية",
                  "ru": "Протяжённость нижней группы"
                }
              },
              {
                "key": "upperWidth",
                "label": {
                  "fa": "عدد عرض طرح بالا",
                  "en": "Upper outline width",
                  "tr": "Üst kontur genişliği",
                  "ar": "عرض المخطط العلوي",
                  "ru": "Ширина верхнего контура"
                }
              },
              {
                "key": "lowerWidth",
                "label": {
                  "fa": "عدد عرض طرح پایین",
                  "en": "Lower outline width",
                  "tr": "Alt kontur genişliği",
                  "ar": "عرض المخطط السفلي",
                  "ru": "Ширина нижнего контура"
                }
              }
            ],
            "rows": [
              {
                "code": "T4",
                "upperSpan": "30.3",
                "lowerSpan": "32.5",
                "upperWidth": "8.5",
                "lowerWidth": "8"
              },
              {
                "code": "N3",
                "upperSpan": "29",
                "lowerSpan": "31.5",
                "upperWidth": "8.5",
                "lowerWidth": "8"
              },
              {
                "code": "N4",
                "upperSpan": "31.8",
                "lowerSpan": "34.3",
                "upperWidth": "9.1",
                "lowerWidth": "8.7"
              },
              {
                "code": "N5",
                "upperSpan": "31.1",
                "lowerSpan": "33.6",
                "upperWidth": "8.4",
                "lowerWidth": "8"
              },
              {
                "code": "N6",
                "upperSpan": "34.1",
                "lowerSpan": "36.4",
                "upperWidth": "9.74",
                "lowerWidth": "9.18"
              }
            ],
            "note": {
              "fa": "واحد در این صفحه نوشته نشده است. عنوان ستون‌ها شرح جای اعداد در تصویر است. عکس N4 در اصل خالی است. این جدول برای تأیید موجودی، واریانت یا سازگاری با یک محصول کافی نیست.",
              "en": "Units are not stated on this page. Column labels describe the positions in the diagram. The N4 photograph is missing in the original. This table does not establish availability, variants or compatibility with a product.",
              "tr": "Bu sayfada birim belirtilmemiştir. Sütun adları şemadaki konumları açıklar. Asılda N4 fotoğrafı yoktur. Tablo stok, varyant veya ürün uyumluluğunu doğrulamaz.",
              "ar": "الوحدة غير مذكورة في الصفحة. تصف عناوين الأعمدة مواضع الأرقام في الرسم. صورة N4 مفقودة في الأصل. لا يثبت الجدول التوفر أو المتغيرات أو التوافق مع منتج.",
              "ru": "Единицы на странице не указаны. Заголовки поясняют расположение чисел на схеме. Фото N4 в оригинале отсутствует. Таблица не подтверждает наличие, варианты или совместимость с продуктом."
            }
          }
        ]
      }
    ],
    "pages": [
      {
        "page": 1,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-01.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 1,
        "title": {
          "fa": "جلد و هویت سند",
          "en": "Cover and document identity",
          "tr": "Kapak ve belge kimliği",
          "ar": "الغلاف وهوية الوثيقة",
          "ru": "Обложка и происхождение"
        }
      },
      {
        "page": 2,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-02.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 2,
        "title": {
          "fa": "ساختار و جلوهٔ دندان",
          "en": "Tooth structure and appearance",
          "tr": "Diş yapısı ve görünümü",
          "ar": "بنية السن ومظهره",
          "ru": "Структура и внешний вид зубов"
        }
      },
      {
        "page": 3,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-03.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 3,
        "title": {
          "fa": "فرم‌های مربعی، مثلثی و بیضی",
          "en": "Square, triangular and oval forms",
          "tr": "Kare, üçgen ve oval formlar",
          "ar": "الأشكال المربعة والمثلثة والبيضاوية",
          "ru": "Квадратные, треугольные и овальные формы"
        }
      },
      {
        "page": 4,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-04.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 4,
        "title": {
          "fa": "قالب‌های مربعی قدامی بالا",
          "en": "Square upper anterior moulds",
          "tr": "Kare üst ön diş kalıpları",
          "ar": "قوالب أمامية علوية مربعة",
          "ru": "Квадратные формы верхних передних зубов"
        }
      },
      {
        "page": 5,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-05.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 5,
        "title": {
          "fa": "قالب‌های مثلثی قدامی بالا",
          "en": "Triangular upper anterior moulds",
          "tr": "Üçgen üst ön diş kalıpları",
          "ar": "قوالب أمامية علوية مثلثة",
          "ru": "Треугольные формы верхних передних зубов"
        }
      },
      {
        "page": 6,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-06.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 6,
        "title": {
          "fa": "قالب‌های بیضی قدامی بالا",
          "en": "Oval upper anterior moulds",
          "tr": "Oval üst ön diş kalıpları",
          "ar": "قوالب أمامية علوية بيضاوية",
          "ru": "Овальные формы верхних передних зубов"
        }
      },
      {
        "page": 7,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-07.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 7,
        "title": {
          "fa": "قالب‌های دندان قدامی پایین",
          "en": "Lower anterior moulds",
          "tr": "Alt ön diş kalıpları",
          "ar": "قوالب الأسنان الأمامية السفلية",
          "ru": "Формы нижних передних зубов"
        }
      },
      {
        "page": 8,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-08.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 8,
        "title": {
          "fa": "گروه‌های خلفی N و T",
          "en": "N and T posterior groups",
          "tr": "N ve T arka diş grupları",
          "ar": "مجموعات الأسنان الخلفية N وT",
          "ru": "Группы боковых зубов N и T"
        }
      },
      {
        "page": 9,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-09.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 9,
        "title": {
          "fa": "جدول تطبیق مربعی؛ خانه‌های خالی",
          "en": "Square matching table · empty cells",
          "tr": "Kare eşleştirme tablosu · boş hücreler",
          "ar": "جدول التوافق المربع · خانات فارغة",
          "ru": "Таблица квадратных форм · пустые ячейки"
        }
      },
      {
        "page": 10,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-10.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 10,
        "title": {
          "fa": "جدول تطبیق مثلثی؛ خانه‌های خالی",
          "en": "Triangular matching table · empty cells",
          "tr": "Üçgen eşleştirme tablosu · boş hücreler",
          "ar": "جدول التوافق المثلث · خانات فارغة",
          "ru": "Таблица треугольных форм · пустые ячейки"
        }
      },
      {
        "page": 11,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-11.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 11,
        "title": {
          "fa": "جدول تطبیق بیضی؛ خانه‌های خالی",
          "en": "Oval matching table · empty cells",
          "tr": "Oval eşleştirme tablosu · boş hücreler",
          "ar": "جدول التوافق البيضاوي · خانات فارغة",
          "ru": "Таблица овальных форм · пустые ячейки"
        }
      },
      {
        "page": 12,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-12.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 12,
        "title": {
          "fa": "ابعاد قدامی کوچک و متوسط",
          "en": "Small and medium anterior dimensions",
          "tr": "Küçük ve orta ön diş ölçüleri",
          "ar": "أبعاد الأسنان الأمامية الصغيرة والمتوسطة",
          "ru": "Размеры малых и средних передних зубов"
        }
      },
      {
        "page": 13,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-13.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 13,
        "title": {
          "fa": "ابعاد قدامی بزرگ و فک پایین",
          "en": "Large and lower anterior dimensions",
          "tr": "Büyük ve alt ön diş ölçüleri",
          "ar": "أبعاد الأسنان الأمامية الكبيرة والسفلية",
          "ru": "Размеры крупных и нижних передних зубов"
        }
      },
      {
        "page": 14,
        "image": "/media/documents/previews/ideal-makoo-mould-guide-page-14.jpg",
        "width": 1600,
        "height": 2263,
        "sourcePage": 14,
        "title": {
          "fa": "ابعاد تصویری دندان‌های خلفی",
          "en": "Illustrated posterior dimensions",
          "tr": "Görselli arka diş ölçüleri",
          "ar": "الأبعاد المصورة للأسنان الخلفية",
          "ru": "Иллюстрированные размеры боковых зубов"
        }
      }
    ]
  }
];

export function findReferenceDocument(slug:string):ReferenceDocument|undefined {return referenceDocuments.find(document=>document.slug===slug||document.id===slug);}
export function referenceLinksForProduct(productId:string):{document:ReferenceDocument;section:ReferenceSection}[] {return referenceDocuments.flatMap(document=>document.sections.filter(section=>section.productIds?.includes(productId)).map(section=>({document,section})));}
export function referencePageUrl(document:Pick<ReferenceDocument,'url'|'pageCount'>,page:number):string {const safePage=Number.isInteger(page)&&page>=1&&page<=document.pageCount?page:1;return `${document.url}#page=${safePage}`;}
