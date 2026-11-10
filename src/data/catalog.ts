/** Official Ideal Makoo content, retrieved 2026-10-17.
 * Public text is translated/paraphrased from the linked sources.
 * Historical claims are not current certifications; no prices, serials, shade matrix or dates have been fabricated.
 */
export type ContentLocale = 'fa' | 'en' | 'tr' | 'ar' | 'ru';
export type Localized = Record<ContentLocale, string>;
export interface Product {
  id: string; slug: string; name: Localized; description: Localized;
  family: 'teeth' | 'materials'; image: string; gallery: string[]; sourceUrl: string;
  brand: string; material: Localized; features: Localized[];
  specs: {label: Localized; value: Localized}[];
  downloads: {label: Localized; url: string; sourceUrl: string}[];
}
export interface Article {
  id: string; slug: string; title: Localized; excerpt: Localized; body: string[];
  language: 'fa'; topic: 'wear' | 'bond' | 'materials'; sourceUrl: string;
  image?: string; publishedAt: null;
}
export interface CompanyPage {
  id: string; slug: string; title: Localized; excerpt: Localized; body: Localized[]; sourceUrl: string;
}
export interface Resource {
  id: string; slug: string; title: Localized; url: string; sourceUrl: string;
  type: 'catalog' | 'brochure' | 'research'; format: 'JPG' | 'PDF'; language: 'fa' | 'en'; productId?: string;
}

export const products: Product[] = [
  {
    "id": "apple",
    "slug": "apple",
    "name": {
      "fa": "دندان مصنوعی اپل",
      "en": "Apple denture teeth",
      "tr": "Apple protez dişler",
      "ar": "أسنان آبل الصناعية",
      "ru": "Искусственные зубы Apple"
    },
    "description": {
      "fa": "سری چهارلایه اپل، با ترکیب کامپوزیت و تنوع قالب برای ساخت پروتزهای متحرک.",
      "en": "Four-layer Apple teeth combine composite material with a choice of moulds for removable prostheses.",
      "tr": "Dört katmanlı Apple dişler, hareketli protezler için kompozit yapı ve kalıp seçenekleri sunar.",
      "ar": "سلسلة آبل بأربع طبقات ومادة كومبوزيت مع قوالب متنوعة للتعويضات المتحركة.",
      "ru": "Четырёхслойная серия Apple сочетает композит и выбор форм для съёмных протезов."
    },
    "family": "teeth",
    "image": "/media/official/1686377879.jpg",
    "gallery": [
      "/media/official/1686377879.jpg",
      "/media/official/1686388135.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/6/apple",
    "brand": "APPLE",
    "material": {
      "fa": "PAMMA و کامپوزیت؛ مطابق متن مرجع",
      "en": "PAMMA and composite; source wording",
      "tr": "PAMMA ve kompozit; kaynak ifadesi",
      "ar": "PAMMA وكومبوزيت؛ وفق المصدر",
      "ru": "PAMMA и композит; терминология источника"
    },
    "features": [
      {
        "fa": "لایه‌گذاری رنگ با جلوه طبیعی",
        "en": "Layered shades for a natural appearance",
        "tr": "Doğal görünüm için katmanlı renkler",
        "ar": "تدرجات لونية لمظهر طبيعي",
        "ru": "Послойные оттенки для естественного вида"
      },
      {
        "fa": "تنوع قالب و رنگ، مطابق معرفی کارخانه",
        "en": "Mould and shade variety, as described by the factory",
        "tr": "Fabrikanın tanıtımına göre kalıp ve renk çeşitliliği",
        "ar": "تنوع القوالب والألوان وفق تعريف المصنع",
        "ru": "Разнообразие форм и оттенков по описанию фабрики"
      },
      {
        "fa": "معرفی برای دست کامل و جزئی در منبع",
        "en": "Listed for complete and partial dentures",
        "tr": "Kaynakta tam ve bölümlü protezler için listelenmiş",
        "ar": "مذكور للأطقم الكاملة والجزئية",
        "ru": "В источнике указаны полные и частичные протезы"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "PAMMA و کامپوزیت؛ مطابق متن مرجع",
          "en": "PAMMA and composite; source wording",
          "tr": "PAMMA ve kompozit; kaynak ifadesi",
          "ar": "PAMMA وكومبوزيت؛ وفق المصدر",
          "ru": "PAMMA и композит; терминология источника"
        }
      },
      {
        "label": {
          "fa": "ساختار / چرخه پخت",
          "en": "Structure / curing cycles",
          "tr": "Yapı / polimerizasyon döngüleri",
          "ar": "البنية / دورات المعالجة",
          "ru": "Структура / циклы полимеризации"
        },
        "value": {
          "fa": "4 لایه · 5 پخت",
          "en": "4 layers · 5 curing cycles",
          "tr": "4 katman · 5 polimerizasyon",
          "ar": "4 طبقات · 5 دورات معالجة",
          "ru": "4 слоёв · 5 циклов"
        }
      },
      {
        "label": {
          "fa": "قالب‌های قدامی",
          "en": "Anterior moulds",
          "tr": "Anterior kalıplar",
          "ar": "القوالب الأمامية",
          "ru": "Формы передних зубов"
        },
        "value": {
          "fa": "۱۹ قالب بالا · ۸ قالب پایین",
          "en": "19 upper · 8 lower moulds",
          "tr": "19 üst · 8 alt kalıp",
          "ar": "19 علويًا · 8 سفليًا",
          "ru": "19 верхних · 8 нижних форм"
        }
      },
      {
        "label": {
          "fa": "کدهای خلفی درج‌شده در مرجع",
          "en": "Posterior codes listed in the source",
          "tr": "Kaynakta listelenen posterior kodlar",
          "ar": "رموز الأسنان الخلفية في المصدر",
          "ru": "Коды боковых зубов из источника"
        },
        "value": {
          "fa": "N6 · N2 · N5 · N3",
          "en": "N6 · N2 · N5 · N3",
          "tr": "N6 · N2 · N5 · N3",
          "ar": "N6 · N2 · N5 · N3",
          "ru": "N6 · N2 · N5 · N3"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1686388135.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/6/apple"
      }
    ]
  },
  {
    "id": "bstar-nano-composite",
    "slug": "bstar-nano-composite",
    "name": {
      "fa": "بی‌استار نانو کامپوزیت",
      "en": "B.Star nano composite teeth",
      "tr": "B.Star nano kompozit dişler",
      "ar": "أسنان بي ستار نانو كومبوزيت",
      "ru": "Зубы B.Star Nano Composite"
    },
    "description": {
      "fa": "ساختار چهارلایه با نانوکامپوزیت و رنگ‌پردازی چندمرحله‌ای؛ مشخصات از صفحه رسمی محصول.",
      "en": "A four-layer nano composite range with layered shading, as described on the official product page.",
      "tr": "Resmî ürün sayfasında açıklanan, katmanlı renklendirmeye sahip dört katmanlı nano kompozit seri.",
      "ar": "سلسلة نانو كومبوزيت بأربع طبقات وتدرجات لونية كما تصفها الصفحة الرسمية.",
      "ru": "Четырёхслойная нанокомпозитная серия с послойной окраской по данным официальной страницы."
    },
    "family": "teeth",
    "image": "/media/official/1686378278.jpg",
    "gallery": [
      "/media/official/1686378278.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/7/bstar-nano-composite",
    "brand": "B.STAR",
    "material": {
      "fa": "PAMMA و نانو کامپوزیت؛ مطابق مرجع",
      "en": "PAMMA and nano composite; source wording",
      "tr": "PAMMA ve nano kompozit; kaynak ifadesi",
      "ar": "PAMMA ونانو كومبوزيت؛ وفق المصدر",
      "ru": "PAMMA и нанокомпозит; терминология источника"
    },
    "features": [
      {
        "fa": "رنگ طبیعی در شرح محصولِ مرجع",
        "en": "Natural colour in the source description",
        "tr": "Kaynak açıklamasında doğal renk",
        "ar": "لون طبيعي في وصف المصدر",
        "ru": "Естественный цвет в описании источника"
      },
      {
        "fa": "رنگ و سایه‌پردازی در ساختار چندلایه",
        "en": "Shading within a multilayer structure",
        "tr": "Çok katmanlı yapıda renklendirme",
        "ar": "تدرجات لونية في بنية متعددة الطبقات",
        "ru": "Оттенки в многослойной структуре"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "PAMMA و نانو کامپوزیت؛ مطابق مرجع",
          "en": "PAMMA and nano composite; source wording",
          "tr": "PAMMA ve nano kompozit; kaynak ifadesi",
          "ar": "PAMMA ونانو كومبوزيت؛ وفق المصدر",
          "ru": "PAMMA и нанокомпозит; терминология источника"
        }
      },
      {
        "label": {
          "fa": "ساختار / چرخه پخت",
          "en": "Structure / curing cycles",
          "tr": "Yapı / polimerizasyon döngüleri",
          "ar": "البنية / دورات المعالجة",
          "ru": "Структура / циклы полимеризации"
        },
        "value": {
          "fa": "4 لایه · 5 پخت",
          "en": "4 layers · 5 curing cycles",
          "tr": "4 katman · 5 polimerizasyon",
          "ar": "4 طبقات · 5 دورات معالجة",
          "ru": "4 слоёв · 5 циклов"
        }
      },
      {
        "label": {
          "fa": "قالب‌های قدامی",
          "en": "Anterior moulds",
          "tr": "Anterior kalıplar",
          "ar": "القوالب الأمامية",
          "ru": "Формы передних зубов"
        },
        "value": {
          "fa": "۱۹ قالب بالا · ۸ قالب پایین",
          "en": "19 upper · 8 lower moulds",
          "tr": "19 üst · 8 alt kalıp",
          "ar": "19 علويًا · 8 سفليًا",
          "ru": "19 верхних · 8 нижних форм"
        }
      },
      {
        "label": {
          "fa": "کدهای خلفی درج‌شده در مرجع",
          "en": "Posterior codes listed in the source",
          "tr": "Kaynakta listelenen posterior kodlar",
          "ar": "رموز الأسنان الخلفية في المصدر",
          "ru": "Коды боковых зубов из источника"
        },
        "value": {
          "fa": "N6 · N2 · N5 · N3",
          "en": "N6 · N2 · N5 · N3",
          "tr": "N6 · N2 · N5 · N3",
          "ar": "N6 · N2 · N5 · N3",
          "ru": "N6 · N2 · N5 · N3"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1686378278.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/7/bstar-nano-composite"
      }
    ]
  },
  {
    "id": "super-berelian",
    "slug": "super-berelian",
    "name": {
      "fa": "دندان مصنوعی سوپر برلیان",
      "en": "Super Berelian denture teeth",
      "tr": "Super Berelian protez dişler",
      "ar": "أسنان سوبر بريليان الصناعية",
      "ru": "Искусственные зубы Super Berelian"
    },
    "description": {
      "fa": "سوپر برلیان با سه لایه و چهار مرحله پخت در مجموعه دندان‌های مصنوعی کارخانه ارائه می‌شود.",
      "en": "Super Berelian is a three-layer, four-cycle denture tooth range from the factory.",
      "tr": "Super Berelian, fabrikanın üç katmanlı ve dört polimerizasyon döngülü protez diş serisidir.",
      "ar": "سوبر بريليان سلسلة أسنان صناعية بثلاث طبقات وأربع دورات معالجة.",
      "ru": "Super Berelian — трёхслойные искусственные зубы с четырьмя циклами полимеризации."
    },
    "family": "teeth",
    "image": "/media/official/1686378359.jpg",
    "gallery": [
      "/media/official/1686378359.jpg",
      "/media/official/1686388117.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/8/super-berelian",
    "brand": "SUPER BERELIAN",
    "material": {
      "fa": "مواد اولیه آلمانی؛ طبق معرفی محصول",
      "en": "German raw materials; product-page statement",
      "tr": "Alman ham maddeleri; ürün sayfasına göre",
      "ar": "مواد أولية ألمانية؛ وفق صفحة المنتج",
      "ru": "Немецкое сырьё; по странице продукта"
    },
    "features": [
      {
        "fa": "تنوع قالب و رنگ، مطابق معرفی کارخانه",
        "en": "Mould and shade variety, as described by the factory",
        "tr": "Fabrikanın tanıtımına göre kalıp ve renk çeşitliliği",
        "ar": "تنوع القوالب والألوان وفق تعريف المصنع",
        "ru": "Разнообразие форм и оттенков по описанию фабрики"
      },
      {
        "fa": "رنگ طبیعی در شرح محصولِ مرجع",
        "en": "Natural colour in the source description",
        "tr": "Kaynak açıklamasında doğal renk",
        "ar": "لون طبيعي في وصف المصدر",
        "ru": "Естественный цвет в описании источника"
      },
      {
        "fa": "معرفی برای دست کامل و جزئی در منبع",
        "en": "Listed for complete and partial dentures",
        "tr": "Kaynakta tam ve bölümlü protezler için listelenmiş",
        "ar": "مذكور للأطقم الكاملة والجزئية",
        "ru": "В источнике указаны полные и частичные протезы"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "مواد اولیه آلمانی؛ طبق معرفی محصول",
          "en": "German raw materials; product-page statement",
          "tr": "Alman ham maddeleri; ürün sayfasına göre",
          "ar": "مواد أولية ألمانية؛ وفق صفحة المنتج",
          "ru": "Немецкое сырьё; по странице продукта"
        }
      },
      {
        "label": {
          "fa": "ساختار / چرخه پخت",
          "en": "Structure / curing cycles",
          "tr": "Yapı / polimerizasyon döngüleri",
          "ar": "البنية / دورات المعالجة",
          "ru": "Структура / циклы полимеризации"
        },
        "value": {
          "fa": "3 لایه · 4 پخت",
          "en": "3 layers · 4 curing cycles",
          "tr": "3 katman · 4 polimerizasyon",
          "ar": "3 طبقات · 4 دورات معالجة",
          "ru": "3 слоёв · 4 циклов"
        }
      },
      {
        "label": {
          "fa": "قالب‌های قدامی",
          "en": "Anterior moulds",
          "tr": "Anterior kalıplar",
          "ar": "القوالب الأمامية",
          "ru": "Формы передних зубов"
        },
        "value": {
          "fa": "۱۹ قالب بالا · ۸ قالب پایین",
          "en": "19 upper · 8 lower moulds",
          "tr": "19 üst · 8 alt kalıp",
          "ar": "19 علويًا · 8 سفليًا",
          "ru": "19 верхних · 8 нижних форм"
        }
      },
      {
        "label": {
          "fa": "کدهای خلفی درج‌شده در مرجع",
          "en": "Posterior codes listed in the source",
          "tr": "Kaynakta listelenen posterior kodlar",
          "ar": "رموز الأسنان الخلفية في المصدر",
          "ru": "Коды боковых зубов из источника"
        },
        "value": {
          "fa": "N6 · N2 · N5 · N3",
          "en": "N6 · N2 · N5 · N3",
          "tr": "N6 · N2 · N5 · N3",
          "ar": "N6 · N2 · N5 · N3",
          "ru": "N6 · N2 · N5 · N3"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1686388117.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/8/super-berelian"
      }
    ]
  },
  {
    "id": "glamour",
    "slug": "glamour",
    "name": {
      "fa": "دندان مصنوعی گلامور",
      "en": "Glamour denture teeth",
      "tr": "Glamour protez dişler",
      "ar": "أسنان غلامور الصناعية",
      "ru": "Искусственные зубы Glamour"
    },
    "description": {
      "fa": "گلامور با ساختار چهارلایه و ترکیب کامپوزیت، در قالب‌ها و رنگ‌های گوناگون معرفی شده است.",
      "en": "Glamour combines a four-layer structure and composite material in a range of moulds and shades.",
      "tr": "Glamour, dört katmanlı kompozit yapıyı çeşitli kalıp ve renklerle birleştirir.",
      "ar": "يجمع غلامور بين بنية بأربع طبقات والكومبوزيت ضمن قوالب وألوان متعددة.",
      "ru": "Glamour сочетает четырёхслойную композитную структуру с выбором форм и оттенков."
    },
    "family": "teeth",
    "image": "/media/official/1686378413.jpg",
    "gallery": [
      "/media/official/1686378413.jpg",
      "/media/official/1686388105.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/9/glamour",
    "brand": "GLAMOUR",
    "material": {
      "fa": "PAMMA و کامپوزیت؛ مطابق متن مرجع",
      "en": "PAMMA and composite; source wording",
      "tr": "PAMMA ve kompozit; kaynak ifadesi",
      "ar": "PAMMA وكومبوزيت؛ وفق المصدر",
      "ru": "PAMMA и композит; терминология источника"
    },
    "features": [
      {
        "fa": "تنوع قالب و رنگ، مطابق معرفی کارخانه",
        "en": "Mould and shade variety, as described by the factory",
        "tr": "Fabrikanın tanıtımına göre kalıp ve renk çeşitliliği",
        "ar": "تنوع القوالب والألوان وفق تعريف المصنع",
        "ru": "Разнообразие форм и оттенков по описанию фабрики"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "PAMMA و کامپوزیت؛ مطابق متن مرجع",
          "en": "PAMMA and composite; source wording",
          "tr": "PAMMA ve kompozit; kaynak ifadesi",
          "ar": "PAMMA وكومبوزيت؛ وفق المصدر",
          "ru": "PAMMA и композит; терминология источника"
        }
      },
      {
        "label": {
          "fa": "ساختار / چرخه پخت",
          "en": "Structure / curing cycles",
          "tr": "Yapı / polimerizasyon döngüleri",
          "ar": "البنية / دورات المعالجة",
          "ru": "Структура / циклы полимеризации"
        },
        "value": {
          "fa": "4 لایه · 5 پخت",
          "en": "4 layers · 5 curing cycles",
          "tr": "4 katman · 5 polimerizasyon",
          "ar": "4 طبقات · 5 دورات معالجة",
          "ru": "4 слоёв · 5 циклов"
        }
      },
      {
        "label": {
          "fa": "قالب‌های قدامی",
          "en": "Anterior moulds",
          "tr": "Anterior kalıplar",
          "ar": "القوالب الأمامية",
          "ru": "Формы передних зубов"
        },
        "value": {
          "fa": "۱۹ قالب بالا · ۸ قالب پایین",
          "en": "19 upper · 8 lower moulds",
          "tr": "19 üst · 8 alt kalıp",
          "ar": "19 علويًا · 8 سفليًا",
          "ru": "19 верхних · 8 нижних форм"
        }
      },
      {
        "label": {
          "fa": "کدهای خلفی درج‌شده در مرجع",
          "en": "Posterior codes listed in the source",
          "tr": "Kaynakta listelenen posterior kodlar",
          "ar": "رموز الأسنان الخلفية في المصدر",
          "ru": "Коды боковых зубов из источника"
        },
        "value": {
          "fa": "N6 · N2 · N5 · N3",
          "en": "N6 · N2 · N5 · N3",
          "tr": "N6 · N2 · N5 · N3",
          "ar": "N6 · N2 · N5 · N3",
          "ru": "N6 · N2 · N5 · N3"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1686388105.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/9/glamour"
      }
    ]
  },
  {
    "id": "super-newclar",
    "slug": "super-newclar",
    "name": {
      "fa": "دندان مصنوعی سوپر نیوکلار",
      "en": "Super Newclar denture teeth",
      "tr": "Super Newclar protez dişler",
      "ar": "أسنان سوبر نيوكلار الصناعية",
      "ru": "Искусственные зубы Super Newclar"
    },
    "description": {
      "fa": "سری دولایه سوپر نیوکلار از ترکیب ذکرشده با اتصال عرضی، برای پروتز کامل و جزئی.",
      "en": "The two-layer Super Newclar range uses the source-described cross-linked formulation for full and partial dentures.",
      "tr": "İki katmanlı Super Newclar, tam ve bölümlü protezler için kaynakta belirtilen çapraz bağlı formülü kullanır.",
      "ar": "سوبر نيوكلار بطبقتين وتركيبة مترابطة عرضيًا للتعويضات الكاملة والجزئية وفق المصدر.",
      "ru": "Двухслойная серия Super Newclar со сшитой структурой для полных и частичных протезов."
    },
    "family": "teeth",
    "image": "/media/official/1686378486.jpg",
    "gallery": [
      "/media/official/1686378486.jpg",
      "/media/official/1686388092.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/10/super-newclar",
    "brand": "SUPER NEWCLAR",
    "material": {
      "fa": "PAMMA و Cross-Linked؛ مطابق متن مرجع",
      "en": "PAMMA and Cross-Linked; source wording",
      "tr": "PAMMA ve Cross-Linked; kaynak ifadesi",
      "ar": "PAMMA وCross-Linked؛ وفق المصدر",
      "ru": "PAMMA и Cross-Linked; терминология источника"
    },
    "features": [
      {
        "fa": "معرفی برای دست کامل و جزئی در منبع",
        "en": "Listed for complete and partial dentures",
        "tr": "Kaynakta tam ve bölümlü protezler için listelenmiş",
        "ar": "مذكور للأطقم الكاملة والجزئية",
        "ru": "В источнике указаны полные и частичные протезы"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "PAMMA و Cross-Linked؛ مطابق متن مرجع",
          "en": "PAMMA and Cross-Linked; source wording",
          "tr": "PAMMA ve Cross-Linked; kaynak ifadesi",
          "ar": "PAMMA وCross-Linked؛ وفق المصدر",
          "ru": "PAMMA и Cross-Linked; терминология источника"
        }
      },
      {
        "label": {
          "fa": "ساختار / چرخه پخت",
          "en": "Structure / curing cycles",
          "tr": "Yapı / polimerizasyon döngüleri",
          "ar": "البنية / دورات المعالجة",
          "ru": "Структура / циклы полимеризации"
        },
        "value": {
          "fa": "2 لایه · 3 پخت",
          "en": "2 layers · 3 curing cycles",
          "tr": "2 katman · 3 polimerizasyon",
          "ar": "2 طبقات · 3 دورات معالجة",
          "ru": "2 слоёв · 3 циклов"
        }
      },
      {
        "label": {
          "fa": "قالب‌های قدامی",
          "en": "Anterior moulds",
          "tr": "Anterior kalıplar",
          "ar": "القوالب الأمامية",
          "ru": "Формы передних зубов"
        },
        "value": {
          "fa": "۱۹ قالب بالا · ۸ قالب پایین",
          "en": "19 upper · 8 lower moulds",
          "tr": "19 üst · 8 alt kalıp",
          "ar": "19 علويًا · 8 سفليًا",
          "ru": "19 верхних · 8 нижних форм"
        }
      },
      {
        "label": {
          "fa": "کدهای خلفی درج‌شده در مرجع",
          "en": "Posterior codes listed in the source",
          "tr": "Kaynakta listelenen posterior kodlar",
          "ar": "رموز الأسنان الخلفية في المصدر",
          "ru": "Коды боковых зубов из источника"
        },
        "value": {
          "fa": "N6 · N2 · N5 · N3",
          "en": "N6 · N2 · N5 · N3",
          "tr": "N6 · N2 · N5 · N3",
          "ar": "N6 · N2 · N5 · N3",
          "ru": "N6 · N2 · N5 · N3"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1686388092.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/10/super-newclar"
      }
    ]
  },
  {
    "id": "marjan-new",
    "slug": "marjan-new",
    "name": {
      "fa": "دندان مصنوعی مرجان نیو",
      "en": "Marjan New denture teeth",
      "tr": "Marjan New protez dişler",
      "ar": "أسنان مرجان نيو الصناعية",
      "ru": "Искусственные зубы Marjan New"
    },
    "description": {
      "fa": "مرجان نیو، سری دولایه دندان مصنوعی با گزینه‌های قالب قدامی و خلفی و تنوع رنگ.",
      "en": "Marjan New is a two-layer denture tooth range with anterior and posterior mould options and multiple shades.",
      "tr": "Marjan New, anterior ve posterior kalıplar ve farklı renkler sunan iki katmanlı protez diş serisidir.",
      "ar": "مرجان نيو سلسلة بطبقتين مع قوالب أمامية وخلفية وخيارات ألوان.",
      "ru": "Marjan New — двухслойные зубы с передними и боковыми формами и выбором оттенков."
    },
    "family": "teeth",
    "image": "/media/official/1686378532.jpg",
    "gallery": [
      "/media/official/1686378532.jpg",
      "/media/official/1686388063.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/11/marjan-new",
    "brand": "MARJAN NEW",
    "material": {
      "fa": "مواد اولیه آلمانی؛ طبق معرفی محصول",
      "en": "German raw materials; product-page statement",
      "tr": "Alman ham maddeleri; ürün sayfasına göre",
      "ar": "مواد أولية ألمانية؛ وفق صفحة المنتج",
      "ru": "Немецкое сырьё; по странице продукта"
    },
    "features": [
      {
        "fa": "تنوع قالب و رنگ، مطابق معرفی کارخانه",
        "en": "Mould and shade variety, as described by the factory",
        "tr": "Fabrikanın tanıtımına göre kalıp ve renk çeşitliliği",
        "ar": "تنوع القوالب والألوان وفق تعريف المصنع",
        "ru": "Разнообразие форм и оттенков по описанию фабрики"
      },
      {
        "fa": "معرفی برای دست کامل و جزئی در منبع",
        "en": "Listed for complete and partial dentures",
        "tr": "Kaynakta tam ve bölümlü protezler için listelenmiş",
        "ar": "مذكور للأطقم الكاملة والجزئية",
        "ru": "В источнике указаны полные и частичные протезы"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "مواد اولیه آلمانی؛ طبق معرفی محصول",
          "en": "German raw materials; product-page statement",
          "tr": "Alman ham maddeleri; ürün sayfasına göre",
          "ar": "مواد أولية ألمانية؛ وفق صفحة المنتج",
          "ru": "Немецкое сырьё; по странице продукта"
        }
      },
      {
        "label": {
          "fa": "ساختار / چرخه پخت",
          "en": "Structure / curing cycles",
          "tr": "Yapı / polimerizasyon döngüleri",
          "ar": "البنية / دورات المعالجة",
          "ru": "Структура / циклы полимеризации"
        },
        "value": {
          "fa": "2 لایه · 3 پخت",
          "en": "2 layers · 3 curing cycles",
          "tr": "2 katman · 3 polimerizasyon",
          "ar": "2 طبقات · 3 دورات معالجة",
          "ru": "2 слоёв · 3 циклов"
        }
      },
      {
        "label": {
          "fa": "قالب‌های قدامی",
          "en": "Anterior moulds",
          "tr": "Anterior kalıplar",
          "ar": "القوالب الأمامية",
          "ru": "Формы передних зубов"
        },
        "value": {
          "fa": "۱۹ قالب بالا · ۸ قالب پایین",
          "en": "19 upper · 8 lower moulds",
          "tr": "19 üst · 8 alt kalıp",
          "ar": "19 علويًا · 8 سفليًا",
          "ru": "19 верхних · 8 нижних форм"
        }
      },
      {
        "label": {
          "fa": "کدهای خلفی درج‌شده در مرجع",
          "en": "Posterior codes listed in the source",
          "tr": "Kaynakta listelenen posterior kodlar",
          "ar": "رموز الأسنان الخلفية في المصدر",
          "ru": "Коды боковых зубов из источника"
        },
        "value": {
          "fa": "N6 · N2 · N5 · N3",
          "en": "N6 · N2 · N5 · N3",
          "tr": "N6 · N2 · N5 · N3",
          "ar": "N6 · N2 · N5 · N3",
          "ru": "N6 · N2 · N5 · N3"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1686388063.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/11/marjan-new"
      }
    ]
  },
  {
    "id": "yaghoot",
    "slug": "yaghoot",
    "name": {
      "fa": "دندان مصنوعی یاقوت",
      "en": "Yaghoot denture teeth",
      "tr": "Yaghoot protez dişler",
      "ar": "أسنان ياقوت الصناعية",
      "ru": "Искусственные зубы Yaghoot"
    },
    "description": {
      "fa": "سری یاقوت با سه لایه و چهار مرحله پخت؛ ترکیب کامپوزیت و گزینه‌های متنوع قالب.",
      "en": "Yaghoot offers a three-layer, four-cycle structure with composite material and a range of moulds.",
      "tr": "Yaghoot, kompozit malzeme ve kalıp seçenekleriyle üç katmanlı, dört döngülü bir yapı sunar.",
      "ar": "ياقوت بثلاث طبقات وأربع دورات معالجة مع مادة كومبوزيت وقوالب متعددة.",
      "ru": "Yaghoot предлагает три слоя и четыре цикла полимеризации, композитный материал и выбор форм."
    },
    "family": "teeth",
    "image": "/media/official/1686378565.jpg",
    "gallery": [
      "/media/official/1686378565.jpg",
      "/media/official/1686388050.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/12/yaghoot",
    "brand": "YAGHOOT",
    "material": {
      "fa": "PAMMA و کامپوزیت؛ مطابق متن مرجع",
      "en": "PAMMA and composite; source wording",
      "tr": "PAMMA ve kompozit; kaynak ifadesi",
      "ar": "PAMMA وكومبوزيت؛ وفق المصدر",
      "ru": "PAMMA и композит; терминология источника"
    },
    "features": [
      {
        "fa": "تنوع قالب و رنگ، مطابق معرفی کارخانه",
        "en": "Mould and shade variety, as described by the factory",
        "tr": "Fabrikanın tanıtımına göre kalıp ve renk çeşitliliği",
        "ar": "تنوع القوالب والألوان وفق تعريف المصنع",
        "ru": "Разнообразие форм и оттенков по описанию фабрики"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "PAMMA و کامپوزیت؛ مطابق متن مرجع",
          "en": "PAMMA and composite; source wording",
          "tr": "PAMMA ve kompozit; kaynak ifadesi",
          "ar": "PAMMA وكومبوزيت؛ وفق المصدر",
          "ru": "PAMMA и композит; терминология источника"
        }
      },
      {
        "label": {
          "fa": "ساختار / چرخه پخت",
          "en": "Structure / curing cycles",
          "tr": "Yapı / polimerizasyon döngüleri",
          "ar": "البنية / دورات المعالجة",
          "ru": "Структура / циклы полимеризации"
        },
        "value": {
          "fa": "3 لایه · 4 پخت",
          "en": "3 layers · 4 curing cycles",
          "tr": "3 katman · 4 polimerizasyon",
          "ar": "3 طبقات · 4 دورات معالجة",
          "ru": "3 слоёв · 4 циклов"
        }
      },
      {
        "label": {
          "fa": "قالب‌های قدامی",
          "en": "Anterior moulds",
          "tr": "Anterior kalıplar",
          "ar": "القوالب الأمامية",
          "ru": "Формы передних зубов"
        },
        "value": {
          "fa": "۱۹ قالب بالا · ۸ قالب پایین",
          "en": "19 upper · 8 lower moulds",
          "tr": "19 üst · 8 alt kalıp",
          "ar": "19 علويًا · 8 سفليًا",
          "ru": "19 верхних · 8 нижних форм"
        }
      },
      {
        "label": {
          "fa": "کدهای خلفی درج‌شده در مرجع",
          "en": "Posterior codes listed in the source",
          "tr": "Kaynakta listelenen posterior kodlar",
          "ar": "رموز الأسنان الخلفية في المصدر",
          "ru": "Коды боковых зубов из источника"
        },
        "value": {
          "fa": "N6 · N2 · N5 · N3",
          "en": "N6 · N2 · N5 · N3",
          "tr": "N6 · N2 · N5 · N3",
          "ar": "N6 · N2 · N5 · N3",
          "ru": "N6 · N2 · N5 · N3"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1686388050.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/12/yaghoot"
      }
    ]
  },
  {
    "id": "newclar",
    "slug": "newclar",
    "name": {
      "fa": "دندان مصنوعی نیوکلار",
      "en": "Newclar denture teeth",
      "tr": "Newclar protez dişler",
      "ar": "أسنان نيوكلار الصناعية",
      "ru": "Искусственные зубы Newclar"
    },
    "description": {
      "fa": "نیوکلار، نخستین نام محصول در تاریخ کارخانه؛ مدل تک‌لایه با دو مرحله پخت.",
      "en": "Newclar, the first product name in the factory history, has a single-layer structure with two curing cycles.",
      "tr": "Fabrikanın tarihindeki ilk ürün adı olan Newclar, tek katman ve iki polimerizasyon döngüsü sunar.",
      "ar": "نيوكلار أول اسم منتج في تاريخ المصنع، ببنية أحادية الطبقة ودورتي معالجة.",
      "ru": "Newclar — первый продукт в истории фабрики: один слой и два цикла полимеризации."
    },
    "family": "teeth",
    "image": "/media/official/1686378608.jpg",
    "gallery": [
      "/media/official/1686378608.jpg",
      "/media/official/1686388036.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/13/newclar",
    "brand": "NEWCLAR",
    "material": {
      "fa": "PAMMA و Cross-Linked؛ مطابق متن مرجع",
      "en": "PAMMA and Cross-Linked; source wording",
      "tr": "PAMMA ve Cross-Linked; kaynak ifadesi",
      "ar": "PAMMA وCross-Linked؛ وفق المصدر",
      "ru": "PAMMA и Cross-Linked; терминология источника"
    },
    "features": [
      {
        "fa": "معرفی برای دست کامل و جزئی در منبع",
        "en": "Listed for complete and partial dentures",
        "tr": "Kaynakta tam ve bölümlü protezler için listelenmiş",
        "ar": "مذكور للأطقم الكاملة والجزئية",
        "ru": "В источнике указаны полные и частичные протезы"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "PAMMA و Cross-Linked؛ مطابق متن مرجع",
          "en": "PAMMA and Cross-Linked; source wording",
          "tr": "PAMMA ve Cross-Linked; kaynak ifadesi",
          "ar": "PAMMA وCross-Linked؛ وفق المصدر",
          "ru": "PAMMA и Cross-Linked; терминология источника"
        }
      },
      {
        "label": {
          "fa": "ساختار / چرخه پخت",
          "en": "Structure / curing cycles",
          "tr": "Yapı / polimerizasyon döngüleri",
          "ar": "البنية / دورات المعالجة",
          "ru": "Структура / циклы полимеризации"
        },
        "value": {
          "fa": "1 لایه · 2 پخت",
          "en": "1 layers · 2 curing cycles",
          "tr": "1 katman · 2 polimerizasyon",
          "ar": "1 طبقات · 2 دورات معالجة",
          "ru": "1 слоёв · 2 циклов"
        }
      },
      {
        "label": {
          "fa": "قالب‌های قدامی",
          "en": "Anterior moulds",
          "tr": "Anterior kalıplar",
          "ar": "القوالب الأمامية",
          "ru": "Формы передних зубов"
        },
        "value": {
          "fa": "۱۹ قالب بالا · ۸ قالب پایین",
          "en": "19 upper · 8 lower moulds",
          "tr": "19 üst · 8 alt kalıp",
          "ar": "19 علويًا · 8 سفليًا",
          "ru": "19 верхних · 8 нижних форм"
        }
      },
      {
        "label": {
          "fa": "کدهای خلفی درج‌شده در مرجع",
          "en": "Posterior codes listed in the source",
          "tr": "Kaynakta listelenen posterior kodlar",
          "ar": "رموز الأسنان الخلفية في المصدر",
          "ru": "Коды боковых зубов из источника"
        },
        "value": {
          "fa": "N6 · N2 · N5 · N3",
          "en": "N6 · N2 · N5 · N3",
          "tr": "N6 · N2 · N5 · N3",
          "ar": "N6 · N2 · N5 · N3",
          "ru": "N6 · N2 · N5 · N3"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1686388036.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/13/newclar"
      }
    ]
  },
  {
    "id": "bstar-nano-base",
    "slug": "bstar-nano-base",
    "name": {
      "fa": "بی‌استار نانو بیس",
      "en": "B.Star Nano Base teeth",
      "tr": "B.Star Nano Base dişler",
      "ar": "أسنان بي ستار نانو بيس",
      "ru": "Зубы B.Star Nano Base"
    },
    "description": {
      "fa": "یکی از مدل‌های دندان مصنوعی در فهرست رسمی ایده‌آل ماکو؛ صفحه مرجع تصویر محصول را ارائه می‌کند.",
      "en": "A denture tooth model listed by Ideal Makoo; the source page provides the product image.",
      "tr": "Ideal Makoo listesinde yer alan bir protez diş modeli; kaynak sayfada ürün görseli bulunur.",
      "ar": "طراز أسنان صناعية ضمن قائمة إيدآل ماكو؛ تتضمن صفحة المصدر صورة المنتج.",
      "ru": "Модель искусственных зубов из каталога Ideal Makoo; на исходной странице опубликовано фото."
    },
    "family": "teeth",
    "image": "/media/official/1686378678.jpg",
    "gallery": [
      "/media/official/1686378678.jpg",
      "/media/official/1686388024.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/14/b-star-nano-base",
    "brand": "B.STAR NANO BASE",
    "material": {
      "fa": "در صفحه مرجع ذکر نشده",
      "en": "Not specified on the source page",
      "tr": "Kaynak sayfada belirtilmemiş",
      "ar": "غير محدد في الصفحة المصدر",
      "ru": "Не указано на исходной странице"
    },
    "features": [],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "در صفحه مرجع ذکر نشده",
          "en": "Not specified on the source page",
          "tr": "Kaynak sayfada belirtilmemiş",
          "ar": "غير محدد في الصفحة المصدر",
          "ru": "Не указано на исходной странице"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1686388024.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/14/b-star-nano-base"
      }
    ]
  },
  {
    "id": "berelian",
    "slug": "berelian",
    "name": {
      "fa": "دندان مصنوعی برلیان",
      "en": "Berelian denture teeth",
      "tr": "Berelian protez dişler",
      "ar": "أسنان بريليان الصناعية",
      "ru": "Искусственные зубы Berelian"
    },
    "description": {
      "fa": "سری برلیان با ساختار اکریلیکی دولایه و سه مرحله پخت، برای پروتزهای کامل و جزئی.",
      "en": "The Berelian range uses a two-layer acrylic structure and three curing cycles for full and partial dentures.",
      "tr": "Berelian, tam ve bölümlü protezler için iki katmanlı akrilik yapı ve üç polimerizasyon döngüsü kullanır.",
      "ar": "بريليان ببنية أكريليكية من طبقتين وثلاث دورات معالجة للتعويضات الكاملة والجزئية.",
      "ru": "Berelian — двухслойная акриловая структура и три цикла полимеризации для полных и частичных протезов."
    },
    "family": "teeth",
    "image": "/media/official/1686482280.jpg",
    "gallery": [
      "/media/official/1686482280.jpg",
      "/media/official/1686482307.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/15/دندان-مصنوعی-برلیان",
    "brand": "BERELIAN",
    "material": {
      "fa": "PAMMA؛ املای درج‌شده در مرجع",
      "en": "PAMMA; spelling used by source",
      "tr": "PAMMA; kaynaktaki yazım",
      "ar": "PAMMA؛ كما ورد في المصدر",
      "ru": "PAMMA; написание в источнике"
    },
    "features": [
      {
        "fa": "معرفی برای دست کامل و جزئی در منبع",
        "en": "Listed for complete and partial dentures",
        "tr": "Kaynakta tam ve bölümlü protezler için listelenmiş",
        "ar": "مذكور للأطقم الكاملة والجزئية",
        "ru": "В источнике указаны полные и частичные протезы"
      },
      {
        "fa": "توجه به فرم لبه‌های قدامی و آرایش خلفی در معرفی منبع",
        "en": "The source highlights anterior edge form and posterior arrangement",
        "tr": "Kaynak, ön kenar formunu ve arka diş dizilimini vurgular",
        "ar": "يركز المصدر على شكل الحافة الأمامية وترتيب الأسنان الخلفية",
        "ru": "Источник отмечает форму переднего края и расположение боковых зубов"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "PAMMA؛ املای درج‌شده در مرجع",
          "en": "PAMMA; spelling used by source",
          "tr": "PAMMA; kaynaktaki yazım",
          "ar": "PAMMA؛ كما ورد في المصدر",
          "ru": "PAMMA; написание в источнике"
        }
      },
      {
        "label": {
          "fa": "ساختار / چرخه پخت",
          "en": "Structure / curing cycles",
          "tr": "Yapı / polimerizasyon döngüleri",
          "ar": "البنية / دورات المعالجة",
          "ru": "Структура / циклы полимеризации"
        },
        "value": {
          "fa": "2 لایه · 3 پخت",
          "en": "2 layers · 3 curing cycles",
          "tr": "2 katman · 3 polimerizasyon",
          "ar": "2 طبقات · 3 دورات معالجة",
          "ru": "2 слоёв · 3 циклов"
        }
      },
      {
        "label": {
          "fa": "قالب‌های قدامی",
          "en": "Anterior moulds",
          "tr": "Anterior kalıplar",
          "ar": "القوالب الأمامية",
          "ru": "Формы передних зубов"
        },
        "value": {
          "fa": "۱۹ قالب بالا · ۸ قالب پایین",
          "en": "19 upper · 8 lower moulds",
          "tr": "19 üst · 8 alt kalıp",
          "ar": "19 علويًا · 8 سفليًا",
          "ru": "19 верхних · 8 нижних форм"
        }
      },
      {
        "label": {
          "fa": "کدهای خلفی درج‌شده در مرجع",
          "en": "Posterior codes listed in the source",
          "tr": "Kaynakta listelenen posterior kodlar",
          "ar": "رموز الأسنان الخلفية في المصدر",
          "ru": "Коды боковых зубов из источника"
        },
        "value": {
          "fa": "N6 · N2 · N5 · N3",
          "en": "N6 · N2 · N5 · N3",
          "tr": "N6 · N2 · N5 · N3",
          "ar": "N6 · N2 · N5 · N3",
          "ru": "N6 · N2 · N5 · N3"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1686482307.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/15/دندان-مصنوعی-برلیان"
      }
    ]
  },
  {
    "id": "president",
    "slug": "president",
    "name": {
      "fa": "دندان مصنوعی پرزیدنت",
      "en": "President denture teeth",
      "tr": "President protez dişler",
      "ar": "أسنان بريزيدنت الصناعية",
      "ru": "Искусственные зубы President"
    },
    "description": {
      "fa": "پرزیدنت با نانوکامپوزیت، پنج لایه و شش مرحله پخت؛ سری دندان‌های قدامی و خلفی ایده‌آل ماکو.",
      "en": "President combines nano composite, five layers and six curing cycles in an anterior and posterior tooth range.",
      "tr": "President, nano kompozit malzemeyi beş katman ve altı polimerizasyon döngüsüyle birleştiren anterior ve posterior diş serisidir.",
      "ar": "بريزيدنت بنانو كومبوزيت وخمس طبقات وست دورات معالجة للأسنان الأمامية والخلفية.",
      "ru": "President сочетает нанокомпозит, пять слоёв и шесть циклов полимеризации в серии передних и боковых зубов."
    },
    "family": "teeth",
    "image": "/media/official/1686482269.jpg",
    "gallery": [
      "/media/official/1686482269.jpg",
      "/media/official/1686482293.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/16/دندان-مصنوعی-پرزیدنت",
    "brand": "PRESIDENT",
    "material": {
      "fa": "نانو کامپوزیت",
      "en": "Nano composite",
      "tr": "Nano kompozit",
      "ar": "نانو كومبوزيت",
      "ru": "Нанокомпозит"
    },
    "features": [
      {
        "fa": "گزینه‌های متعدد قالب برای پروتز",
        "en": "Multiple prosthetic mould options",
        "tr": "Çeşitli protez kalıbı seçenekleri",
        "ar": "خيارات متعددة لقوالب التعويضات",
        "ru": "Различные формы для протезирования"
      },
      {
        "fa": "سطح پرداخت‌شده و درخشان؛ مطابق مرجع",
        "en": "Polished, glossy surface; source description",
        "tr": "Parlak ve cilalı yüzey; kaynak açıklaması",
        "ar": "سطح مصقول ولامع؛ وفق وصف المصدر",
        "ru": "Полированная блестящая поверхность; по описанию источника"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "نانو کامپوزیت",
          "en": "Nano composite",
          "tr": "Nano kompozit",
          "ar": "نانو كومبوزيت",
          "ru": "Нанокомпозит"
        }
      },
      {
        "label": {
          "fa": "ساختار / چرخه پخت",
          "en": "Structure / curing cycles",
          "tr": "Yapı / polimerizasyon döngüleri",
          "ar": "البنية / دورات المعالجة",
          "ru": "Структура / циклы полимеризации"
        },
        "value": {
          "fa": "5 لایه · 6 پخت",
          "en": "5 layers · 6 curing cycles",
          "tr": "5 katman · 6 polimerizasyon",
          "ar": "5 طبقات · 6 دورات معالجة",
          "ru": "5 слоёв · 6 циклов"
        }
      },
      {
        "label": {
          "fa": "قالب‌های قدامی",
          "en": "Anterior moulds",
          "tr": "Anterior kalıplar",
          "ar": "القوالب الأمامية",
          "ru": "Формы передних зубов"
        },
        "value": {
          "fa": "۱۹ قالب بالا · ۸ قالب پایین",
          "en": "19 upper · 8 lower moulds",
          "tr": "19 üst · 8 alt kalıp",
          "ar": "19 علويًا · 8 سفليًا",
          "ru": "19 верхних · 8 нижних форм"
        }
      },
      {
        "label": {
          "fa": "کدهای خلفی درج‌شده در مرجع",
          "en": "Posterior codes listed in the source",
          "tr": "Kaynakta listelenen posterior kodlar",
          "ar": "رموز الأسنان الخلفية في المصدر",
          "ru": "Коды боковых зубов из источника"
        },
        "value": {
          "fa": "N6 · N2 · N5 · N3",
          "en": "N6 · N2 · N5 · N3",
          "tr": "N6 · N2 · N5 · N3",
          "ar": "N6 · N2 · N5 · N3",
          "ru": "N6 · N2 · N5 · N3"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1686482293.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/16/دندان-مصنوعی-پرزیدنت"
      }
    ]
  },
  {
    "id": "dentex-etch-37",
    "slug": "dentex-etch-37",
    "name": {
      "fa": "اسید اچ ۳۷٪ دنتکس",
      "en": "Dentex 37% etching gel",
      "tr": "Dentex %37 asitleme jeli",
      "ar": "جل تخريش دنتكس 37%",
      "ru": "Травильный гель Dentex 37%"
    },
    "description": {
      "fa": "ژل اچ آبی برای کاربردهای ترمیمی و ارتودنسی معرفی‌شده در صفحه رسمی؛ با قابلیت شست‌وشو.",
      "en": "A blue etching gel listed for restorative and orthodontic use, with a rinseable formulation.",
      "tr": "Restoratif ve ortodontik kullanım için tanıtılan, durulanabilir mavi asitleme jeli.",
      "ar": "جل تخريش أزرق قابل للشطف، معرّف للاستخدامات الترميمية والتقويمية.",
      "ru": "Синий смываемый травильный гель, заявленный для реставраций и ортодонтии."
    },
    "family": "materials",
    "image": "/media/official/1726477204.jpg",
    "gallery": [
      "/media/official/1726477204.jpg",
      "/media/official/1726478812.jpg",
      "/media/official/1726478890.jpg",
      "/media/official/1719648276.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/30/اسید-اچ-37%-دنتکس",
    "brand": "DENTEX",
    "material": {
      "fa": "ژل اچ",
      "en": "Etching gel",
      "tr": "Asitleme jeli",
      "ar": "جل تخريش",
      "ru": "Травильный гель"
    },
    "features": [
      {
        "fa": "ژل آبی برای مشاهده بهتر، مطابق معرفی منبع",
        "en": "The source describes a blue gel for visibility",
        "tr": "Kaynakta görünürlük için mavi jel olarak tanımlanır",
        "ar": "يصف المصدر جلًا أزرق لسهولة الرؤية",
        "ru": "В источнике описан синий гель для видимости"
      },
      {
        "fa": "شست‌وشوی آسان در توضیحات محصول",
        "en": "Easy rinsing is listed in the product description",
        "tr": "Ürün açıklamasında kolay durulama belirtilir",
        "ar": "سهولة الشطف مذكورة في وصف المنتج",
        "ru": "В описании указано лёгкое смывание"
      },
      {
        "fa": "کاربردهای معرفی‌شده: ترمیم کامپوزیتی و ارتودنسی",
        "en": "Listed applications include composite restoration and orthodontics",
        "tr": "Belirtilen uygulamalar kompozit restorasyon ve ortodontiyi içerir",
        "ar": "تشمل التطبيقات المذكورة ترميم الكومبوزيت وتقويم الأسنان",
        "ru": "Указаны композитные реставрации и ортодонтия"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "ژل اچ",
          "en": "Etching gel",
          "tr": "Asitleme jeli",
          "ar": "جل تخريش",
          "ru": "Травильный гель"
        }
      },
      {
        "label": {
          "fa": "غلظت درج‌شده",
          "en": "Listed concentration",
          "tr": "Belirtilen konsantrasyon",
          "ar": "التركيز المذكور",
          "ru": "Указанная концентрация"
        },
        "value": {
          "fa": "۳۷٪",
          "en": "37%",
          "tr": "%37",
          "ar": "37%",
          "ru": "37%"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1726478812.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/30/اسید-اچ-37%-دنتکس"
      }
    ]
  },
  {
    "id": "generation-8-bonding",
    "slug": "generation-8-bonding",
    "name": {
      "fa": "باندینگ رزین نسل ۸",
      "en": "Generation 8 resin bonding",
      "tr": "8. nesil rezin bonding",
      "ar": "بوندنغ راتنجي من الجيل الثامن",
      "ru": "Адгезивная смола 8-го поколения"
    },
    "description": {
      "fa": "باندینگ یونیورسال معرفی‌شده برای روش‌های مختلف اچینگ و کار با کامپوزیت و آمالگام.",
      "en": "A universal bonding product described for several etching approaches and use with composite and amalgam.",
      "tr": "Farklı asitleme yaklaşımları ile kompozit ve amalgam için tanıtılan üniversal bonding ürünü.",
      "ar": "مادة ربط شاملة موصوفة لأساليب تخريش متعددة وللاستخدام مع الكومبوزيت والأملغم.",
      "ru": "Универсальный адгезив для разных методов травления, композита и амальгамы по данным производителя."
    },
    "family": "materials",
    "image": "/media/official/1725864310.jpg",
    "gallery": [
      "/media/official/1725864310.jpg",
      "/media/official/1725864338.jpg",
      "/media/official/1726468756.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/31/باندینگ-رزین-نسل-8",
    "brand": "IDEAL MAKOO",
    "material": {
      "fa": "رزین باندینگ یونیورسال",
      "en": "Universal bonding resin",
      "tr": "Üniversal bonding rezini",
      "ar": "راتنج ربط شامل",
      "ru": "Универсальная адгезивная смола"
    },
    "features": [
      {
        "fa": "یونیورسال؛ معرفی‌شده برای روش‌های مختلف اچینگ",
        "en": "Universal; described for multiple etching approaches",
        "tr": "Üniversal; farklı asitleme yaklaşımları için tanımlanmış",
        "ar": "عام الاستخدام؛ موصوف لطرق تخريش متعددة",
        "ru": "Универсальный; описан для разных методов протравливания"
      },
      {
        "fa": "کامپوزیت و آمالگام در کاربردهای منبع ذکر شده‌اند",
        "en": "Composite and amalgam are included in the source applications",
        "tr": "Kaynak uygulamalarında kompozit ve amalgam yer alır",
        "ar": "يُذكر الكومبوزيت والأملغم ضمن تطبيقات المصدر",
        "ru": "В источнике среди применений указаны композит и амальгама"
      },
      {
        "fa": "اتصال به مینا، عاج و فلز در معرفی محصول",
        "en": "Enamel, dentine and metal bonding appear in the product description",
        "tr": "Ürün tanımında mine, dentin ve metal bağlanması yer alır",
        "ar": "يرد الالتصاق بالمينا والعاج والمعدن في وصف المنتج",
        "ru": "В описании приведено соединение с эмалью, дентином и металлом"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "رزین باندینگ یونیورسال",
          "en": "Universal bonding resin",
          "tr": "Üniversal bonding rezini",
          "ar": "راتنج ربط شامل",
          "ru": "Универсальная адгезивная смола"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1725864338.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/31/باندینگ-رزین-نسل-8"
      }
    ]
  },
  {
    "id": "light-cure-composite",
    "slug": "light-cure-composite",
    "name": {
      "fa": "کامپوزیت لایت‌کیور",
      "en": "Light-cure composite",
      "tr": "Işıkla sertleşen kompozit",
      "ar": "كومبوزيت ضوئي التصلب",
      "ru": "Светоотверждаемый композит"
    },
    "description": {
      "fa": "کامپوزیت ترمیمی لایت‌کیور در سرنگ چهارگرمی؛ با رنگ‌های اپک و گزینه‌های متداول معرفی‌شده توسط کارخانه.",
      "en": "A light-cure restorative composite in a 4 g syringe, with opaque and commonly used shades listed by the factory.",
      "tr": "Fabrikanın belirttiği opak ve yaygın renk seçeneklerine sahip, 4 g şırıngada ışıkla sertleşen restoratif kompozit.",
      "ar": "كومبوزيت ترميمي ضوئي في حقنة 4 غرام مع درجات معتمة وألوان شائعة وفق المصنع.",
      "ru": "Светоотверждаемый реставрационный композит в шприце 4 г с опаковыми и популярными оттенками."
    },
    "family": "materials",
    "image": "/media/official/1726468061.jpg",
    "gallery": [
      "/media/official/1726468061.jpg",
      "/media/official/1725860714.jpg",
      "/media/official/1726468993.jpg",
      "/media/official/1725860015.jpg",
      "/media/official/1689233519.jpg",
      "/media/official/1689233517.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/32/کامپوزیت-لایت-کیور",
    "brand": "B.STAR",
    "material": {
      "fa": "کامپوزیت",
      "en": "Composite",
      "tr": "Kompozit",
      "ar": "كومبوزيت",
      "ru": "Композит"
    },
    "features": [
      {
        "fa": "معرفی‌شده برای ترمیم‌های کلاس ۱ تا ۵ قدامی و خلفی",
        "en": "Listed for class I–V anterior and posterior restorations",
        "tr": "Ön ve arka dişlerde sınıf I–V restorasyonlar için listelenmiş",
        "ar": "مذكور لترميمات الفئات I–V الأمامية والخلفية",
        "ru": "Указаны передние и боковые реставрации классов I–V"
      },
      {
        "fa": "ونیر مستقیم و ترمیم پرسلن و کامپوزیت در فهرست کاربردهای مرجع",
        "en": "Direct veneers and porcelain/composite repair are listed by the source",
        "tr": "Kaynakta direkt veneer ve porselen/kompozit onarımı listelenir",
        "ar": "يسرد المصدر القشور المباشرة وإصلاح الخزف والكومبوزيت",
        "ru": "Источник перечисляет прямые виниры и ремонт фарфора/композита"
      },
      {
        "fa": "فرم‌دهی و عدم چسبندگی به ابزار در توضیحات کارخانه",
        "en": "The factory describes shaping and non-sticking instrument handling",
        "tr": "Fabrika şekillendirme ve alete yapışmayan kullanım tanımlar",
        "ar": "يصف المصنع سهولة التشكيل وعدم الالتصاق بالأداة",
        "ru": "Фабрика описывает формование и отсутствие прилипания к инструменту"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "کامپوزیت",
          "en": "Composite",
          "tr": "Kompozit",
          "ar": "كومبوزيت",
          "ru": "Композит"
        }
      },
      {
        "label": {
          "fa": "بسته‌بندی",
          "en": "Packaging",
          "tr": "Ambalaj",
          "ar": "التعبئة",
          "ru": "Упаковка"
        },
        "value": {
          "fa": "سرنگ ۴ گرم",
          "en": "4 g syringe",
          "tr": "4 g şırınga",
          "ar": "حقنة 4 غرام",
          "ru": "Шприц 4 г"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1725860714.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/32/کامپوزیت-لایت-کیور"
      }
    ]
  },
  {
    "id": "ideal-line",
    "slug": "ideal-line",
    "name": {
      "fa": "دندان ایده‌آل لاین",
      "en": "Ideal Line denture teeth",
      "tr": "Ideal Line protez dişler",
      "ar": "أسنان إيدآل لاين الصناعية",
      "ru": "Искусственные зубы Ideal Line"
    },
    "description": {
      "fa": "ایده‌آل لاین، دندان نانوکامپوزیتی با ساختار پنج‌لایه و شش مرحله پخت طبق معرفی رسمی.",
      "en": "Ideal Line is a nano composite denture tooth with five layers and six curing cycles, according to its official description.",
      "tr": "Ideal Line, resmî açıklamaya göre beş katmanlı ve altı polimerizasyon döngülü nano kompozit protez diştir.",
      "ar": "إيدآل لاين أسنان نانو كومبوزيت بخمس طبقات وست دورات معالجة وفق التعريف الرسمي.",
      "ru": "Ideal Line — нанокомпозитные зубы с пятью слоями и шестью циклами полимеризации по официальному описанию."
    },
    "family": "teeth",
    "image": "/media/official/1726476868.jpg",
    "gallery": [
      "/media/official/1726476868.jpg",
      "/media/official/1726476922.jpg",
      "/media/official/1726469770.jpg",
      "/media/official/1689233731.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/33/دندان-ایده-آل-لاین",
    "brand": "IDEAL LINE",
    "material": {
      "fa": "نانو کامپوزیت",
      "en": "Nano composite",
      "tr": "Nano kompozit",
      "ar": "نانو كومبوزيت",
      "ru": "Нанокомпозит"
    },
    "features": [],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "نانو کامپوزیت",
          "en": "Nano composite",
          "tr": "Nano kompozit",
          "ar": "نانو كومبوزيت",
          "ru": "Нанокомпозит"
        }
      },
      {
        "label": {
          "fa": "ساختار / چرخه پخت",
          "en": "Structure / curing cycles",
          "tr": "Yapı / polimerizasyon döngüleri",
          "ar": "البنية / دورات المعالجة",
          "ru": "Структура / циклы полимеризации"
        },
        "value": {
          "fa": "5 لایه · 6 پخت",
          "en": "5 layers · 6 curing cycles",
          "tr": "5 katman · 6 polimerizasyon",
          "ar": "5 طبقات · 6 دورات معالجة",
          "ru": "5 слоёв · 6 циклов"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1726476922.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/33/دندان-ایده-آل-لاین"
      }
    ]
  },
  {
    "id": "antic",
    "slug": "antic",
    "name": {
      "fa": "دندان آنتیک",
      "en": "Antic denture teeth",
      "tr": "Antic protez dişler",
      "ar": "أسنان أنتيك الصناعية",
      "ru": "Искусственные зубы Antic"
    },
    "description": {
      "fa": "سری نانوکامپوزیتی آنتیک با پنج لایه و شش پخت؛ مواد اولیه آلمانی در متن رسمی ذکر شده است.",
      "en": "Antic is a five-layer, six-cycle nano composite range; the official page states German raw materials.",
      "tr": "Antic, beş katmanlı ve altı döngülü nano kompozit seridir; resmî sayfada Alman ham maddeleri belirtilir.",
      "ar": "أنتيك سلسلة نانو كومبوزيت بخمس طبقات وست دورات؛ وتذكر الصفحة الرسمية مواد أولية ألمانية.",
      "ru": "Antic — нанокомпозитная серия с пятью слоями и шестью циклами; на странице указано немецкое сырьё."
    },
    "family": "teeth",
    "image": "/media/official/1726467544.jpg",
    "gallery": [
      "/media/official/1726467544.jpg",
      "/media/official/1725860871.jpg",
      "/media/official/1719663893.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/51/دندان-آنتیک",
    "brand": "ANTIC",
    "material": {
      "fa": "نانو کامپوزیت",
      "en": "Nano composite",
      "tr": "Nano kompozit",
      "ar": "نانو كومبوزيت",
      "ru": "Нанокомпозит"
    },
    "features": [
      {
        "fa": "مواد اولیه آلمانی، مطابق ادعای صفحهٔ مرجع",
        "en": "German raw materials, as stated by the source page",
        "tr": "Kaynak sayfanın ifadesine göre Alman hammaddeleri",
        "ar": "مواد أولية ألمانية وفق تصريح الصفحة المصدر",
        "ru": "Немецкое сырьё согласно заявлению на исходной странице"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "نانو کامپوزیت",
          "en": "Nano composite",
          "tr": "Nano kompozit",
          "ar": "نانو كومبوزيت",
          "ru": "Нанокомпозит"
        }
      },
      {
        "label": {
          "fa": "ساختار / چرخه پخت",
          "en": "Structure / curing cycles",
          "tr": "Yapı / polimerizasyon döngüleri",
          "ar": "البنية / دورات المعالجة",
          "ru": "Структура / циклы полимеризации"
        },
        "value": {
          "fa": "5 لایه · 6 پخت",
          "en": "5 layers · 6 curing cycles",
          "tr": "5 katman · 6 polimerizasyon",
          "ar": "5 طبقات · 6 دورات معالجة",
          "ru": "5 слоёв · 6 циклов"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1725860871.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/51/دندان-آنتیک"
      }
    ]
  },
  {
    "id": "laboratory-putty",
    "slug": "laboratory-putty",
    "name": {
      "fa": "پوتی لابراتواری",
      "en": "Laboratory putty",
      "tr": "Laboratuvar putty materyali",
      "ar": "معجون مخبري",
      "ru": "Лабораторная масса Putty"
    },
    "description": {
      "fa": "پوتی برای فرایند مفل‌گذاری لابراتوار؛ در معرفی کارخانه برای حفاظت از مدلاژ و ساده‌تر شدن پاک‌سازی توضیح داده شده است.",
      "en": "A putty for laboratory flasking, described by the factory for protecting the wax-up and simplifying cleaning.",
      "tr": "Fabrika tarafından modelajı korumak ve temizliği kolaylaştırmak için tanıtılan laboratuvar muflalama putty materyali.",
      "ar": "معجون لعمليات المَفل المخبرية، يصفه المصنع لحماية التشميع وتسهيل التنظيف.",
      "ru": "Масса для лабораторной кюветизации, описанная для защиты воскового моделирования и упрощения очистки."
    },
    "family": "materials",
    "image": "/media/official/1722930683.jpg",
    "gallery": [
      "/media/official/1722930683.jpg",
      "/media/official/1725860946.jpg",
      "/media/official/1722930737.jpg"
    ],
    "sourceUrl": "https://idealmakoo.com/pages/56/پوتی-لابراتواری",
    "brand": "IDEAL MAKOO",
    "material": {
      "fa": "پوتی لابراتواری؛ ترکیب شیمیایی در مرجع درج نشده",
      "en": "Laboratory putty; composition not listed",
      "tr": "Laboratuvar putty; bileşim belirtilmemiş",
      "ar": "معجون مخبري؛ التركيب غير مذكور",
      "ru": "Лабораторная масса; состав не указан"
    },
    "features": [
      {
        "fa": "کاربرد لابراتواری در مرحلهٔ مفل‌گذاری",
        "en": "Laboratory use during flasking",
        "tr": "Muflalama aşamasında laboratuvar kullanımı",
        "ar": "استخدام مخبري أثناء الإحاطة في البوتقة",
        "ru": "Лабораторное применение при формовке в кювете"
      },
      {
        "fa": "حفاظت از فرم مدل مومی و دندان، مطابق شرح منبع",
        "en": "The source describes protecting the wax model and tooth form",
        "tr": "Kaynak, mum modelin ve diş formunun korunmasını açıklar",
        "ar": "يصف المصدر حماية النموذج الشمعي وشكل السن",
        "ru": "Источник описывает защиту восковой модели и формы зуба"
      },
      {
        "fa": "کمک به فرایند تمیزکاری پس از مفل‌گذاری در معرفی محصول",
        "en": "The product description discusses post-flasking cleanup",
        "tr": "Ürün açıklaması muflalama sonrası temizliği ele alır",
        "ar": "يناقش وصف المنتج التنظيف بعد الإحاطة",
        "ru": "В описании обсуждается очистка после формовки"
      }
    ],
    "specs": [
      {
        "label": {
          "fa": "مواد",
          "en": "Material",
          "tr": "Malzeme",
          "ar": "المادة",
          "ru": "Материал"
        },
        "value": {
          "fa": "پوتی لابراتواری؛ ترکیب شیمیایی در مرجع درج نشده",
          "en": "Laboratory putty; composition not listed",
          "tr": "Laboratuvar putty; bileşim belirtilmemiş",
          "ar": "معجون مخبري؛ التركيب غير مذكور",
          "ru": "Лабораторная масса; состав не указан"
        }
      }
    ],
    "downloads": [
      {
        "label": {
          "fa": "تصویر معرفی رسمی محصول (JPG)",
          "en": "Official product sheet (JPG)",
          "tr": "Resmî ürün tanıtım görseli (JPG)",
          "ar": "صورة التعريف الرسمية للمنتج (JPG)",
          "ru": "Официальный лист продукта (JPG)"
        },
        "url": "/media/official/1725860946.jpg",
        "sourceUrl": "https://idealmakoo.com/pages/56/پوتی-لابراتواری"
      }
    ]
  }
];

export const articles: Article[] = [
  {
    "id": "research-34",
    "slug": "resin-base-bond-four-teeth",
    "title": {
      "fa": "استحکام اتصال بیس رزینی به گلامور، یاقوت، اپل و ایوکلار",
      "en": "Resin-base bonding to Glamour, Yaghoot, Apple and Ivoclar",
      "tr": "Glamour, Yaghoot, Apple ve Ivoclar dişlerde rezin kaide bağlantısı",
      "ar": "ارتباط القاعدة الراتنجية بغلامور وياقوت وآبل وإيفوكلار",
      "ru": "Соединение базисной смолы с Glamour, Yaghoot, Apple и Ivoclar"
    },
    "excerpt": {
      "fa": "بررسی اتصال چهار مدل دندان مصنوعی به رزین و مرور اثر آماده‌سازی سطح اتصال.",
      "en": "A study of four denture tooth models and the influence of bonding-surface preparation.",
      "tr": "Dört protez diş modeli ve bağlantı yüzeyi hazırlığının etkisi üzerine çalışma.",
      "ar": "دراسة أربعة طرازات أسنان صناعية وتأثير تحضير سطح الارتباط.",
      "ru": "Исследование четырёх моделей зубов и влияния подготовки поверхности соединения."
    },
    "body": [
      "این مطلب در آرشیو شرکت به مطالعه اتصال چهار مدل دندان به پایه رزینی اختصاص دارد. محور مرور، تأثیر تغییرات مکانیکی و شیمیایی در سطح اتصال دندان است.",
      "صفحه رسمی نتایج متفاوت پژوهش‌های پیشین درباره استفاده از مونومر و تغییر سطح ریج‌لپ را مرور می‌کند؛ از این بخش نمی‌توان یک دستورالعمل یکسان برای تمام مواد استخراج کرد."
    ],
    "language": "fa",
    "topic": "bond",
    "sourceUrl": "https://idealmakoo.com/pages/34/میزان-استحکام-باند-بیس-رزینی",
    "image": "/media/official/1689234925.jpg",
    "publishedAt": null
  },
  {
    "id": "research-35",
    "slug": "acrylic-composite-resin-bond",
    "title": {
      "fa": "مقایسه اتصال دندان‌های اکریلیکی و کامپوزیتی به رزین پایه",
      "en": "Acrylic and composite tooth bonding to denture-base resin",
      "tr": "Akrilik ve kompozit dişlerin kaide rezinine bağlantısı",
      "ar": "ارتباط الأسنان الأكريليكية والكومبوزيت براتنج القاعدة",
      "ru": "Соединение акриловых и композитных зубов с базисной смолой"
    },
    "excerpt": {
      "fa": "پژوهش آزمایشگاهی درباره اتصال سوپر برلیان، یاقوت و ماژور به رزین پایه پروتز.",
      "en": "A laboratory comparison of Super Berelian, Yaghoot and Major bonding to denture-base resin.",
      "tr": "Super Berelian, Yaghoot ve Major dişlerinin kaide rezinine bağlantısının laboratuvar karşılaştırması.",
      "ar": "مقارنة مخبرية لارتباط سوبر بريليان وياقوت وماجور براتنج قاعدة التعويض.",
      "ru": "Лабораторное сравнение соединения Super Berelian, Yaghoot и Major с базисной смолой."
    },
    "body": [
      "در گزارش این مطالعه، دندان‌های کانین فک بالا از سه گروه انتخاب و پس از آماده‌سازی به پایه رزینی متصل شده‌اند. آزمون فشاری و برشی برای اندازه‌گیری نیروی شکست به کار رفته است.",
      "در خلاصه منتشرشده، تفاوت میانگین اتصال گروه‌ها از نظر آماری معنادار گزارش نشده است. این نتیجه مربوط به شرایط آزمایش توصیف‌شده است."
    ],
    "language": "fa",
    "topic": "bond",
    "sourceUrl": "https://idealmakoo.com/pages/35/بررسی-مقایسه-ای-استحکام-اتصال-دندانهای-مصنوعی-آکریلی-و-کامپوزیتی-،ایرانی-به-خارجی-به-رزین-پایه-پروتز",
    "image": "/media/official/1689235166.jpg",
    "publishedAt": null
  },
  {
    "id": "research-36",
    "slug": "three-teeth-denture-base-bond",
    "title": {
      "fa": "اتصال اپل، گلامور و بی‌استار به اکریل بیس دنچر",
      "en": "Apple, Glamour and B.Star bonding to acrylic denture bases",
      "tr": "Apple, Glamour ve B.Star dişlerinin akrilik kaideye bağlantısı",
      "ar": "ارتباط آبل وغلامور وبي ستار بالقاعدة الأكريليكية",
      "ru": "Соединение Apple, Glamour и B.Star с акриловым базисом"
    },
    "excerpt": {
      "fa": "مقایسه آزمایشگاهی سه گروه دندان و ثبت نیروی شکست اتصال به اکریل گرماپخت.",
      "en": "A laboratory comparison of three tooth groups measuring bond failure force to heat-cured acrylic.",
      "tr": "Üç diş grubunda sıcak polimerize akriliğe bağlantı kırılma kuvvetinin laboratuvar karşılaştırması.",
      "ar": "مقارنة مخبرية لثلاث مجموعات وقياس قوة فشل الارتباط بالأكريل المعالج حراريًا.",
      "ru": "Лабораторное сравнение трёх групп с измерением силы разрушения соединения с термоотверждаемым акрилом."
    },
    "body": [
      "آرشیو کارخانه پژوهشی از دانشگاه علوم پزشکی جندی‌شاپور اهواز درباره سه گروه اپل، گلامور و بی‌استار معرفی می‌کند. برای هر گروه ده نمونه انتخاب شده و نیروی برشی برای بررسی اتصال اعمال شده است.",
      "اعداد درج‌شده در منبع، نتایج همان آزمون هستند. این صفحه خلاصه مطالعه را ارائه می‌کند و جایگزین گزارش کامل پژوهشی نیست."
    ],
    "language": "fa",
    "topic": "bond",
    "sourceUrl": "https://idealmakoo.com/pages/36/میزان-استحکام-اتصال-سه-نوع-دندان-مصنوعی",
    "image": "/media/official/1689235260.jpg",
    "publishedAt": null
  },
  {
    "id": "research-37",
    "slug": "president-ivoclar-3d-wear",
    "title": {
      "fa": "مقایسه سایش پرزیدنت و ایوکلار با اسکن سه‌بعدی",
      "en": "President and Ivoclar wear assessed with 3D scanning",
      "tr": "Üç boyutlu taramayla President ve Ivoclar aşınması",
      "ar": "مقارنة تآكل بريزيدنت وإيفوكلار بالمسح ثلاثي الأبعاد",
      "ru": "Сравнение износа President и Ivoclar с помощью 3D-сканирования"
    },
    "excerpt": {
      "fa": "معرفی مطالعه سایش در برابر دندان طبیعی و استفاده از اسکنر سه‌بعدی برای ارزیابی.",
      "en": "An introduction to a study of wear against natural teeth using 3D scanning.",
      "tr": "Doğal dişe karşı aşınmanın 3B taramayla değerlendirildiği bir çalışmanın tanıtımı.",
      "ar": "تعريف بدراسة التآكل مقابل الأسنان الطبيعية باستخدام المسح ثلاثي الأبعاد.",
      "ru": "Описание исследования износа относительно естественных зубов с применением 3D-сканирования."
    },
    "body": [
      "صفحه مرجع به مطالعه‌ای در واحد دندانپزشکی تهران دانشگاه آزاد در سال ۱۳۹۴ اشاره می‌کند. هدف آن مقایسه مقاومت سایشی پرزیدنت و ایوکلار در تماس با دندان طبیعی، با استفاده از اسکن سه‌بعدی است.",
      "متن قابل دسترس بیشتر به ضرورت و هدف پژوهش می‌پردازد و نتیجه کمی نهایی را منتشر نمی‌کند؛ بنابراین برتری یا برابری قطعی از این صفحه نتیجه‌گیری نشده است."
    ],
    "language": "fa",
    "topic": "wear",
    "sourceUrl": "https://idealmakoo.com/pages/37/بررسی-مقاومت-سایشی-دندان-پرزیدنت-و-آیوکلار",
    "image": "/media/official/1689235423.jpg",
    "publishedAt": null
  },
  {
    "id": "research-38",
    "slug": "three-teeth-heat-cured-resin",
    "title": {
      "fa": "اتصال برلیان، سوپر برلیان و ایوکلار به رزین گرماپخت",
      "en": "Berelian, Super Berelian and Ivoclar bonding to heat-cured resin",
      "tr": "Berelian, Super Berelian ve Ivoclar dişlerinin sıcak polimerize rezine bağlantısı",
      "ar": "ارتباط بريليان وسوبر بريليان وإيفوكلار بالراتنج الحراري",
      "ru": "Соединение Berelian, Super Berelian и Ivoclar с термоотверждаемой смолой"
    },
    "excerpt": {
      "fa": "مقایسه اتصال سه گروه و بررسی محل شکست در دندان یا پایه اکریلیکی.",
      "en": "A comparison of three groups, including failure locations within the tooth or acrylic base.",
      "tr": "Üç grubun ve diş ya da akrilik kaide içindeki kırılma konumlarının karşılaştırması.",
      "ar": "مقارنة ثلاث مجموعات مع فحص موضع الكسر في السن أو القاعدة الأكريليكية.",
      "ru": "Сравнение трёх групп с анализом расположения разрушения в зубе или акриловом базисе."
    },
    "body": [
      "این پژوهش اتصال دو مدل ایرانی و یک مدل خارجی به اکریل گرماپخت را بررسی کرده است. در شرح روش، برای هر گروه ۲۱ نمونه معرفی شده و نیروی شکست و محل شکست ثبت شده‌اند.",
      "خلاصه منتشرشده، اختلاف معناداری میان میانگین اتصال سه گروه گزارش نمی‌کند. یافته‌ها به نمونه‌ها و شیوه آزمون همان پژوهش محدود هستند."
    ],
    "language": "fa",
    "topic": "bond",
    "sourceUrl": "https://idealmakoo.com/pages/38/استحکام-اتصال-سه-نوع-دندان-مصنوعی",
    "image": "/media/official/1689235611.jpg",
    "publishedAt": null
  },
  {
    "id": "research-39",
    "slug": "acrylic-teeth-wear-comparison",
    "title": {
      "fa": "مقایسه سایش شش سری دندان اکریلیکی",
      "en": "Wear comparison of six acrylic tooth ranges",
      "tr": "Altı akrilik diş serisinin aşınma karşılaştırması",
      "ar": "مقارنة تآكل ست سلاسل من الأسنان الأكريليكية",
      "ru": "Сравнение износа шести серий акриловых зубов"
    },
    "excerpt": {
      "fa": "گزارش مقایسه سوپر برلیان با ماژور پلاس، سوپر لوکس، پلی‌دنت پریمو، ویتاپان و ایوکلار.",
      "en": "A comparison of Super Berelian with Major Plus, Super Lux, Polident Primo, Vitapan and Ivoclar.",
      "tr": "Super Berelian ile Major Plus, Super Lux, Polident Primo, Vitapan ve Ivoclar karşılaştırması.",
      "ar": "مقارنة سوبر بريليان مع ماجور بلس وسوبر لوكس وبوليدنت بريمو وفيتابان وإيفوكلار.",
      "ru": "Сравнение Super Berelian с Major Plus, Super Lux, Polident Primo, Vitapan и Ivoclar."
    },
    "body": [
      "این گزارش به نرخ سایش در مرحله پایدار آزمون می‌پردازد و گروه‌های مختلف دندان اکریلیکی را با تحلیل آماری مقایسه می‌کند.",
      "در منبع، برخی نتایج به‌صورت اعداد با شیوه نگارش قدیمی درج شده‌اند. برای استفاده تخصصی از مقادیر، مشاهده نسخه اصلی و بررسی روش کامل مطالعه لازم است."
    ],
    "language": "fa",
    "topic": "wear",
    "sourceUrl": "https://idealmakoo.com/pages/39/مقایسه-میزان-سایش-در-دندان-ها",
    "image": "/media/official/1689235813.jpg",
    "publishedAt": null
  },
  {
    "id": "research-40",
    "slug": "iranian-swiss-dentin-bond",
    "title": {
      "fa": "استحکام اتصال کامپوزیت ایده‌آل ماکو و سینرژی به عاج",
      "en": "Dentin bonding of Ideal Makoo and Synergy composites",
      "tr": "Ideal Makoo ve Synergy kompozitlerinin dentine bağlantısı",
      "ar": "ارتباط كومبوزيت إيدآل ماكو وسينرجي بالعاج",
      "ru": "Соединение композитов Ideal Makoo и Synergy с дентином"
    },
    "excerpt": {
      "fa": "مقایسه استحکام برشی اتصال دو کامپوزیت لایت‌کیور در یک بررسی آزمایشگاهی.",
      "en": "A laboratory comparison of shear bond strength for two light-cure composites.",
      "tr": "İki ışıkla sertleşen kompozitin makaslama bağlantı dayanımının laboratuvar karşılaştırması.",
      "ar": "مقارنة مخبرية لمقاومة الارتباط القصية لكومبوزيتين ضوئيي التصلب.",
      "ru": "Лабораторное сравнение прочности соединения на сдвиг двух светоотверждаемых композитов."
    },
    "body": [
      "مطلب آرشیو دو کامپوزیت لایت‌کیور را در آزمون اتصال برشی به عاج مقایسه می‌کند. برای بررسی تفاوت نتایج، آزمون‌های آماری پارامتری و ناپارامتری ذکر شده‌اند.",
      "در خلاصه منبع اختلاف آماری معناداری گزارش نشده است. این گزارش تاریخی، تأیید عملکرد تمام فرمولاسیون‌ها یا نسل‌های فعلی این محصولات نیست."
    ],
    "language": "fa",
    "topic": "bond",
    "sourceUrl": "https://idealmakoo.com/pages/40/بررسی-آزمایشگاهی-استحکام-برشی-باندینگ-کامپوزیت",
    "image": "/media/official/1689235972.jpg",
    "publishedAt": null
  },
  {
    "id": "research-41",
    "slug": "six-acrylic-ranges-steady-wear",
    "title": {
      "fa": "نرخ سایش پایدار شش گروه دندان مصنوعی",
      "en": "Steady-state wear in six denture tooth groups",
      "tr": "Altı protez diş grubunda kararlı durum aşınması",
      "ar": "التآكل المستقر في ست مجموعات أسنان صناعية",
      "ru": "Стационарный износ шести групп искусственных зубов"
    },
    "excerpt": {
      "fa": "اندازه‌گیری کاهش وزن در مراحل سایش و مقایسه برلیان، ایوکلار و چهار گروه دیگر.",
      "en": "Weight-loss measurements across wear stages comparing Berelian, Ivoclar and four other groups.",
      "tr": "Aşınma aşamalarında ağırlık kaybıyla Berelian, Ivoclar ve dört grubun karşılaştırılması.",
      "ar": "قياس فقدان الوزن عبر مراحل التآكل ومقارنة بريليان وإيفوكلار وأربع مجموعات أخرى.",
      "ru": "Измерение потери массы на этапах износа для Berelian, Ivoclar и ещё четырёх групп."
    },
    "body": [
      "این مطلب تمرکز خود را بر مرحله‌ای از سایش قرار می‌دهد که نرخ آن به حالت پایدار می‌رسد. کاهش وزن نمونه‌ها در چند مرحله مبنای محاسبه نرخ سایش بوده است.",
      "فهرست مقایسه شامل گروه‌های ماژوردنت، مایرسون، برلیان و ایوکلار است. روابط آماری گزارش‌شده در صفحه اصلی مطالعه قابل مشاهده‌اند."
    ],
    "language": "fa",
    "topic": "wear",
    "sourceUrl": "https://idealmakoo.com/pages/41/مقایسه-میزان-سایش-در-دندان-ها",
    "image": "/media/official/1689236247.jpg",
    "publishedAt": null
  },
  {
    "id": "research-42",
    "slug": "iranian-teeth-ivoclar-wear",
    "title": {
      "fa": "بررسی سایش برلیان و سوپر برلیان در مقایسه با ایوکلار",
      "en": "Wear of Berelian and Super Berelian compared with Ivoclar",
      "tr": "Berelian ve Super Berelian aşınmasının Ivoclar ile karşılaştırılması",
      "ar": "تآكل بريليان وسوبر بريليان مقارنة بإيفوكلار",
      "ru": "Износ Berelian и Super Berelian по сравнению с Ivoclar"
    },
    "excerpt": {
      "fa": "آزمون سایش آزمایشگاهی و مقایسه تغییر وزن دو مدل ایرانی با دندان ایوکلار.",
      "en": "A laboratory wear test comparing weight changes in two Iranian models and Ivoclar teeth.",
      "tr": "İki İran modeli ve Ivoclar dişlerindeki ağırlık değişiminin laboratuvar aşınma testiyle karşılaştırılması.",
      "ar": "اختبار تآكل مخبري يقارن تغير الوزن في طرازين إيرانيين وأسنان إيفوكلار.",
      "ru": "Лабораторный тест износа с сопоставлением изменения массы двух иранских моделей и Ivoclar."
    },
    "body": [
      "این مطالعه از تغییر وزن پس از تماس سایشی برای مقایسه دو مدل ایرانی با ایوکلار استفاده می‌کند. چند مرحله اندازه‌گیری در متن آرشیوی گزارش شده است.",
      "در نسخه وب، برخی بخش‌های روش و نتیجه با نگارش تکراری و اعداد متفاوت آمده‌اند. خلاصه حاضر از بازنویسی آن اعداد به‌عنوان داده قطعی خودداری می‌کند."
    ],
    "language": "fa",
    "topic": "wear",
    "sourceUrl": "https://idealmakoo.com/pages/42/بررسی-مقایسه-ای-سایش-دو-نوع-دندان-مصنوعی-ایرانی",
    "image": "/media/official/1689236463.jpg",
    "publishedAt": null
  },
  {
    "id": "research-20",
    "slug": "six-teeth-wear-rate",
    "title": {
      "fa": "مقایسه نرخ سایش ۶ نوع دندان مصنوعی",
      "en": "Wear-rate comparison of six denture tooth types",
      "tr": "Altı protez diş türünün aşınma hızı karşılaştırması",
      "ar": "مقارنة معدل تآكل ستة أنواع أسنان صناعية",
      "ru": "Сравнение скорости износа шести типов искусственных зубов"
    },
    "excerpt": {
      "fa": "مقایسه شش گروه با دیسک آلومینایی، بزاق مصنوعی و اندازه‌گیری تغییر وزن.",
      "en": "Six groups compared using an alumina disc, artificial saliva and weight-change measurement.",
      "tr": "Alümina disk, yapay tükürük ve ağırlık değişimiyle altı grubun karşılaştırılması.",
      "ar": "مقارنة ست مجموعات باستخدام قرص ألومينا ولعاب اصطناعي وقياس تغير الوزن.",
      "ru": "Сравнение шести групп с диском из оксида алюминия, искусственной слюной и измерением массы."
    },
    "body": [
      "گزارش شامل شش نوع دندان و روشی آزمایشگاهی با دیسک ساینده در محیط بزاق مصنوعی است. برای تعیین نرخ سایش، وزن نمونه‌ها قبل و بعد از مراحل آزمون ثبت شده است.",
      "محور تحلیل، رفتار نمونه‌ها در مرحله پایدار سایش است. این مطالعه با مطلب دیگر آرشیو درباره همین شش گروه هم‌پوشانی دارد و به‌عنوان مدخل مستقلی از سایت اصلی حفظ شده است."
    ],
    "language": "fa",
    "topic": "wear",
    "sourceUrl": "https://idealmakoo.com/pages/20/مقایسه-نرخ-سایش",
    "image": "/media/official/1686664281.jpg",
    "publishedAt": null
  },
  {
    "id": "research-19",
    "slug": "apple-super-major-wear",
    "title": {
      "fa": "مقایسه سایش دندان اپل و سوپر ماژور",
      "en": "Wear comparison of Apple and Super Major teeth",
      "tr": "Apple ve Super Major dişlerin aşınma karşılaştırması",
      "ar": "مقارنة تآكل أسنان آبل وسوبر ماجور",
      "ru": "Сравнение износа зубов Apple и Super Major"
    },
    "excerpt": {
      "fa": "بررسی ۶۴ نمونه با شبیه‌ساز جویدن و مقایسه اسکن‌های سه‌بعدی قبل و بعد از آزمون.",
      "en": "A 64-sample study using a chewing simulator and before-and-after 3D scans.",
      "tr": "Çiğneme simülatörü ve öncesi-sonrası 3B taramalarla 64 örnekli çalışma.",
      "ar": "دراسة على 64 عينة بمحاكي مضغ ومقارنة مسح ثلاثي الأبعاد قبل الاختبار وبعده.",
      "ru": "Исследование 64 образцов с симулятором жевания и 3D-сканированием до и после испытаний."
    },
    "body": [
      "در این پژوهش، نمونه‌های اپل، سوپر ماژور و دندان طبیعی در گروه‌های آزمون قرار گرفته‌اند. تغییر حجم با مقایسه اسکن‌های پیش و پس از کار با شبیه‌ساز جویدن بررسی شده است.",
      "منبع تعداد کل نمونه‌ها را ۶۴ اعلام می‌کند. نتیجه و جزئیات آزمون باید همراه با شرایط آزمایش مطالعه شوند و کاربرد آن‌ها به ارزیابی تخصصی نیاز دارد."
    ],
    "language": "fa",
    "topic": "wear",
    "sourceUrl": "https://idealmakoo.com/pages/19/مقایسه-سایشی-دندان",
    "image": "/media/official/1686664184.jpg",
    "publishedAt": null
  },
  {
    "id": "research-18",
    "slug": "iranian-swiss-shear-bond",
    "title": {
      "fa": "اتصال برشی کامپوزیت ایرانی و سوئیسی",
      "en": "Shear bonding of Iranian and Swiss composites",
      "tr": "İran ve İsviçre kompozitlerinde makaslama bağlantısı",
      "ar": "الارتباط القصي لكومبوزيت إيراني وسويسري",
      "ru": "Соединение на сдвиг иранского и швейцарского композитов"
    },
    "excerpt": {
      "fa": "گزارش آزمایشگاهی دانشگاه علوم پزشکی یزد بر روی ۳۰ دندان پرمولر.",
      "en": "A laboratory report from Yazd University of Medical Sciences using 30 premolars.",
      "tr": "Yezd Tıp Bilimleri Üniversitesinde 30 premolarla gerçekleştirilen laboratuvar raporu.",
      "ar": "تقرير مخبري من جامعة يزد للعلوم الطبية باستخدام 30 سنًا ضاحكًا.",
      "ru": "Лабораторный отчёт Йездского университета медицинских наук по 30 премолярам."
    },
    "body": [
      "مطلب رسمی پژوهشی در سال تحصیلی ۱۳۸۰–۱۳۸۱ را معرفی می‌کند که دندان‌های پرمولر در دو گروه بررسی شده‌اند. هر گروه با کامپوزیت و سیستم اتصال مربوط به خود آماده شده است.",
      "پس از آماده‌سازی و چرخه حرارتی، آزمون اتصال برشی انجام شده است. طبق خلاصه وب، تفاوت آماری معناداری میان دو گروه گزارش نشده است."
    ],
    "language": "fa",
    "topic": "bond",
    "sourceUrl": "https://idealmakoo.com/pages/18/استحکام-باند-برشی",
    "image": "/media/official/1686664033.jpg",
    "publishedAt": null
  },
  {
    "id": "research-17",
    "slug": "four-teeth-wear-rate",
    "title": {
      "fa": "مقایسه نرخ سایش ۴ نوع دندان مصنوعی",
      "en": "Wear-rate comparison of four denture tooth types",
      "tr": "Dört protez diş türünün aşınma hızı karşılaştırması",
      "ar": "مقارنة معدل تآكل أربعة أنواع أسنان صناعية",
      "ru": "Сравнение скорости износа четырёх типов искусственных зубов"
    },
    "excerpt": {
      "fa": "مدخل آرشیوی درباره نرخ سایش و رفتار نمونه‌ها در مرحله پایدار آزمون.",
      "en": "An archive entry examining wear rate and specimen behaviour in the steady-state stage.",
      "tr": "Aşınma hızı ve numunelerin kararlı durum davranışını inceleyen arşiv kaydı.",
      "ar": "مدخل أرشيفي عن معدل التآكل وسلوك العينات في المرحلة المستقرة.",
      "ru": "Архивный материал о скорости износа и поведении образцов на стационарной стадии."
    },
    "body": [
      "روش توضیح‌داده‌شده بر اندازه‌گیری وزن نمونه‌ها در تماس با دیسک آلومینایی و بزاق مصنوعی استوار است. نرخ سایش از بخش پایدار رفتار نمونه محاسبه شده است.",
      "عنوان منبع از چهار نوع دندان نام می‌برد، درحالی‌که متن نتیجه‌گیری نام‌های بیشتری دارد. این ناسازگاری به‌جای اصلاح بدون سند، در گزارش منبع حفظ و مشخص شده است."
    ],
    "language": "fa",
    "topic": "wear",
    "sourceUrl": "https://idealmakoo.com/pages/17/مقایسه-نرخ-سایش",
    "image": "/media/official/1686663870.jpg",
    "publishedAt": null
  }
];

export const companyPages: CompanyPage[] = [
  {
    "id": "company-2",
    "slug": "about",
    "title": {
      "fa": "درباره ایده‌آل ماکو",
      "en": "About Ideal Makoo",
      "tr": "Ideal Makoo hakkında",
      "ar": "عن إيدآل ماكو",
      "ru": "О компании Ideal Makoo"
    },
    "excerpt": {
      "fa": "از سال ۱۳۶۰، در مسیر تولید دندان مصنوعی و توسعه مواد دندانی در منطقه آزاد ماکو.",
      "en": "Founded in 1360 SH, Ideal Makoo manufactures denture teeth and develops dental materials in the Maku Free Zone.",
      "tr": "1360 HŞ yılında kurulan Ideal Makoo, Maku Serbest Bölgesi’nde protez diş ve dental malzemeler üretir.",
      "ar": "تأسست إيدآل ماكو عام 1360 هجري شمسي لإنتاج الأسنان الصناعية وتطوير المواد السنية في منطقة ماكو الحرة.",
      "ru": "Ideal Makoo основана в 1360 году солнечной хиджры и производит искусственные зубы и стоматологические материалы в свободной зоне Маку."
    },
    "body": [
      {
        "fa": "شرکت ایده‌آل ماکو در سال ۱۳۶۰ هجری شمسی با شمارهٔ ثبت ۱۸۰ آغاز به کار کرد. محل کارخانه در منطقهٔ آزاد ماکو و در نزدیکی کوه آرارات معرفی شده و تاریخچهٔ شرکت، نیوکلار را نخستین محصول این مسیر می‌داند.",
        "en": "Ideal Makoo began in 1360 Solar Hijri under registration number 180. Its factory is described as being in the Maku Free Zone near Mount Ararat, and the company history identifies Newclar as its first product.",
        "tr": "Ideal Makoo, 1360 Hicri Şemsi yılında 180 sicil numarasıyla faaliyete başladı. Fabrika Ağrı Dağı yakınındaki Maku Serbest Bölgesi’nde tanımlanır; şirket tarihçesi ilk ürünü Newclar olarak belirtir.",
        "ar": "بدأت إيده‌آل ماكو عام 1360 هجري شمسي برقم تسجيل 180. يُذكر أن المصنع يقع بمنطقة ماكو الحرة قرب جبل أرارات، ويحدد تاريخ الشركة نيوكلار بوصفه أول منتج.",
        "ru": "Ideal Makoo начала работу в 1360 году солнечной хиджры под номером регистрации 180. Фабрика описана как расположенная в свободной зоне Маку у Арарата; первым продуктом в истории назван Newclar."
      },
      {
        "fa": "روایت رسمی، توسعهٔ سبد را از دندان‌های آکریلیکی به سری‌های ایزوسید، کامپوزیتی و نانوکامپوزیتی دنبال می‌کند. عرضهٔ اپل در نیمهٔ دوم ۱۳۸۷ و سپس خانوادهٔ بی‌استار و پرزیدنت در همین تاریخچه آمده است.",
        "en": "The official account follows the portfolio from acrylic teeth to Isosid, composite and nanocomposite series. It dates the Apple introduction to the second half of 1387 SH and subsequently discusses B.STAR and President.",
        "tr": "Resmî anlatı, portföyü akrilik dişlerden Isosid, kompozit ve nanokompozit serilere kadar izler. Apple’ın çıkışı 1387 HŞ’nin ikinci yarısına tarihlenir; ardından B.STAR ve President anlatılır.",
        "ar": "تتبع الرواية الرسمية المجموعة من الأسنان الأكريليكية إلى سلاسل إيزوسيد والكومبوزيت والنانوكومبوزيت. وتؤرخ طرح آبل بالنصف الثاني من 1387 ثم تتناول بي‌ستار وبريزيدنت.",
        "ru": "Официальная история прослеживает развитие от акриловых зубов к сериям Isosid, композитным и нанокомпозитным. Выпуск Apple отнесён ко второй половине 1387 года, далее описаны B.STAR и President."
      },
      {
        "fa": "در بخش صادرات، آغاز عرضه به بلژیک و آلمان در ۱۳۷۱ و آمریکا و کانادا در ۱۳۹۰ ذکر شده است. این موارد بخشی از تاریخچهٔ منتشرشده هستند؛ وضعیت فعلی عرضه و همکاری در هر کشور از مسیر ارتباط با شرکت قابل پیگیری است.",
        "en": "The export account lists Belgium and Germany from 1371 SH and the USA and Canada from 1390 SH. These are published historical statements; the company contact route is available for current country-specific supply and cooperation.",
        "tr": "İhracat anlatısında Belçika ve Almanya 1371 HŞ, ABD ve Kanada 1390 HŞ’den itibaren anılır. Bunlar yayımlanmış tarihsel bilgilerdir; güncel ülke bazlı tedarik ve iş birliği şirketten sorulabilir.",
        "ar": "تذكر رواية التصدير بلجيكا وألمانيا من 1371 والولايات المتحدة وكندا من 1390. هذه معلومات تاريخية منشورة؛ يمكن متابعة التوريد والتعاون الحالي حسب الدولة عبر الشركة.",
        "ru": "В истории экспорта Бельгия и Германия указаны с 1371 года, США и Канада — с 1390 года. Это опубликованные исторические сведения; текущее снабжение и сотрудничество уточняются у компании."
      }
    ],
    "sourceUrl": "https://idealmakoo.com/pages/2/about"
  },
  {
    "id": "company-21",
    "slug": "mission",
    "title": {
      "fa": "رسالت و بیانیه شرکت",
      "en": "Mission and principles",
      "tr": "Misyon ve ilkeler",
      "ar": "الرسالة والمبادئ",
      "ru": "Миссия и принципы"
    },
    "excerpt": {
      "fa": "تأکید بر صداقت، کیفیت، رضایت مصرف‌کننده و همکاری نزدیک با جامعه دندانپزشکی.",
      "en": "A focus on integrity, quality, customer satisfaction and cooperation with the dental community.",
      "tr": "Dürüstlük, kalite, müşteri memnuniyeti ve diş hekimliği topluluğuyla iş birliği.",
      "ar": "التركيز على النزاهة والجودة ورضا المستخدم والتعاون مع مجتمع طب الأسنان.",
      "ru": "Приоритет честности, качества, удовлетворённости клиентов и сотрудничества со стоматологическим сообществом."
    },
    "body": [
      {
        "fa": "بیانیهٔ شرکت بر صداقت در همکاری، کیفیت محصول و پشتیبانی از مشتری تأکید دارد. عاملان فروش و همکاران در این متن به‌عنوان شریک تجاری معرفی شده‌اند و رضایت مصرف‌کننده بخش اصلی این رابطه است.",
        "en": "The company statement emphasizes honest cooperation, product quality and customer support. Distributors and professional partners are described as business partners, with end-user satisfaction central to that relationship.",
        "tr": "Şirket bildirisi dürüst iş birliğini, ürün kalitesini ve müşteri desteğini vurgular. Bayiler ve mesleki ortaklar iş ortağı olarak tanımlanır; son kullanıcı memnuniyeti bu ilişkinin merkezindedir.",
        "ar": "يركز بيان الشركة على صدق التعاون وجودة المنتج ودعم العميل. ويصف الموزعين والمتعاونين كشركاء أعمال، مع وضع رضا المستخدم النهائي في صلب العلاقة.",
        "ru": "Заявление компании подчёркивает честное сотрудничество, качество и поддержку клиентов. Дистрибьюторы названы деловыми партнёрами, а удовлетворённость конечного пользователя — основой отношений."
      },
      {
        "fa": "در بخش پژوهش، همکاری با دانشکده‌های دندان‌پزشکی و توجه به ایده‌های تازه و تنوع محصول مطرح شده است. برنامه‌های تشویقیِ ذکرشده در متن اصلی، روایت همان صفحه هستند و به‌عنوان پیشنهاد تجاری جاری در این سایت اعلام نمی‌شوند.",
        "en": "The research section discusses dental-school collaboration, new ideas and product variety. Incentive programmes described in the original remain source statements and are not presented here as current commercial offers.",
        "tr": "Araştırma bölümü diş hekimliği fakülteleriyle iş birliğini, yeni fikirleri ve ürün çeşitliliğini ele alır. Asıldaki teşvik programları kaynak ifadeleri olarak korunur; güncel ticari teklif şeklinde sunulmaz.",
        "ar": "يتناول قسم البحث التعاون مع كليات طب الأسنان والأفكار الجديدة وتنوع المنتجات. تبقى البرامج التحفيزية الواردة في الأصل عبارات مصدر ولا تُعرض هنا كعروض تجارية حالية.",
        "ru": "Раздел исследований упоминает сотрудничество со стоматологическими факультетами, новые идеи и разнообразие продукции. Программы поощрения сохранены как заявления источника, а не текущие предложения."
      }
    ],
    "sourceUrl": "https://idealmakoo.com/pages/21/mission"
  },
  {
    "id": "company-22",
    "slug": "goals",
    "title": {
      "fa": "اهداف و آرمان‌ها",
      "en": "Goals and vision",
      "tr": "Hedefler ve vizyon",
      "ar": "الأهداف والرؤية",
      "ru": "Цели и видение"
    },
    "excerpt": {
      "fa": "گسترش تنوع تولید، دسترسی گروه‌های مختلف مشتریان و توسعه حضور در بازارهای بین‌المللی.",
      "en": "Expanding product variety, serving diverse customer groups and developing international market presence.",
      "tr": "Ürün çeşitliliğini artırmak, farklı müşteri gruplarına ulaşmak ve uluslararası pazarlarda gelişmek.",
      "ar": "توسيع تنوع المنتجات وخدمة شرائح العملاء وتطوير الحضور في الأسواق الدولية.",
      "ru": "Расширение ассортимента, обслуживание разных групп клиентов и развитие международного присутствия."
    },
    "body": [
      {
        "fa": "اهداف منتشرشده، توسعهٔ تنوع محصول و دسترسی گروه‌های گوناگون جامعه به محصولات دندانی را دنبال می‌کنند؛ درمانگاه‌ها، بیمارستان‌ها، دانشگاه‌ها و مراکز خیریه در متن این صفحه نام برده شده‌اند.",
        "en": "The published goals pursue a broader product range and access for different user groups. Clinics, hospitals, universities and charitable treatment centres are named on the source page.",
        "tr": "Yayımlanan hedefler ürün çeşitliliğini ve farklı kullanıcı gruplarının erişimini artırmayı amaçlar. Kaynakta klinikler, hastaneler, üniversiteler ve hayır amaçlı tedavi merkezleri anılır.",
        "ar": "تسعى الأهداف المنشورة إلى توسيع المنتجات وإتاحتها لمجموعات مختلفة. وتذكر الصفحة العيادات والمستشفيات والجامعات والمراكز العلاجية الخيرية.",
        "ru": "Опубликованные цели предусматривают расширение ассортимента и доступности. В источнике названы клиники, больницы, университеты и благотворительные лечебные центры."
      },
      {
        "fa": "توسعهٔ بازارهای صادراتی و استفاده از موقعیت ماکو در نزدیکی مرز ترکیه از محورهای متن است. مطالب مربوط به جایگاه بازار و فعالیت‌های خارجی، روایت تاریخی شرکت‌اند و در قالب آمار عملیاتیِ امروز نمایش داده نمی‌شوند.",
        "en": "Export-market development and Maku’s proximity to the Turkish border are central themes. Statements about market standing and overseas activity remain the company’s historical account rather than present-day operating metrics.",
        "tr": "İhracat pazarlarının geliştirilmesi ve Maku’nun Türkiye sınırına yakınlığı temel konulardır. Pazar konumu ve dış faaliyetler tarihsel anlatı olarak korunur; güncel faaliyet göstergesi değildir.",
        "ar": "يمثل تطوير أسواق التصدير وقرب ماكو من الحدود التركية محورين رئيسيين. تظل بيانات المكانة السوقية والنشاط الخارجي رواية تاريخية للشركة وليست مؤشرات تشغيلية حالية.",
        "ru": "Ключевые темы — экспортные рынки и близость Маку к турецкой границе. Утверждения о положении на рынке и зарубежной деятельности представлены как история, а не текущие показатели."
      }
    ],
    "sourceUrl": "https://idealmakoo.com/pages/22/goals"
  },
  {
    "id": "company-23",
    "slug": "strategy",
    "title": {
      "fa": "اهداف و راهبرد تجاری",
      "en": "Business strategy",
      "tr": "Ticaret stratejisi",
      "ar": "الاستراتيجية التجارية",
      "ru": "Коммерческая стратегия"
    },
    "excerpt": {
      "fa": "توسعه ظرفیت کارخانه و تجهیزات، ارتقای فرایندها و گسترش سبد محصولات دندانی.",
      "en": "Developing factory capacity and equipment, improving processes and broadening the dental product portfolio.",
      "tr": "Fabrika kapasitesi ve ekipmanlarını geliştirmek, süreçleri iyileştirmek ve ürün portföyünü genişletmek.",
      "ar": "تطوير طاقة المصنع ومعداته وتحسين العمليات وتوسيع مجموعة المنتجات السنية.",
      "ru": "Развитие мощностей и оборудования, улучшение процессов и расширение ассортимента стоматологических продуктов."
    },
    "body": [
      {
        "fa": "صفحهٔ استراتژی توضیح می‌دهد که افزایش تقاضا، گسترش فضای کارخانه و ورود ماشین‌آلات و قالب‌های جدید را در اولویت قرار داده است. بهبود دقت تولید و پیوند میان تولید، بازاریابی و فروش نیز در همین روایت مطرح شده است.",
        "en": "The strategy page explains how increased demand made factory expansion and new machinery and moulds priorities. It also discusses production precision and the connection between manufacturing, marketing and sales.",
        "tr": "Strateji sayfası artan talebin fabrika genişlemesini, yeni makineleri ve kalıpları öncelik hâline getirdiğini anlatır. Üretim hassasiyeti ile üretim, pazarlama ve satış ilişkisi de ele alınır.",
        "ar": "توضح صفحة الاستراتيجية أن زيادة الطلب جعلت توسيع المصنع والآلات والقوالب الجديدة أولوية. وتناقش دقة الإنتاج والربط بين التصنيع والتسويق والمبيعات.",
        "ru": "Стратегия связывает рост спроса с расширением фабрики, новым оборудованием и формами. Также обсуждаются точность производства и связь производства с маркетингом и продажами."
      },
      {
        "fa": "بررسی پیشنهادها، ایده‌ها و انتقاد مشتریان و گسترش فعالیت از دندان مصنوعی به دیگر مواد دندان‌پزشکی در متن آمده است. برنامه‌های توسعهٔ ذکرشده، از فهرست محصولات دارای صفحهٔ رسمی مجزا هستند.",
        "en": "Reviewing customer suggestions, ideas and complaints, and expanding beyond denture teeth into other dental materials are described. Development plans remain distinct from products with an actual official product page.",
        "tr": "Müşteri önerileri, fikirleri ve şikâyetlerinin incelenmesi ile diğer dental malzemelere açılım anlatılır. Geliştirme planları, resmî ürün sayfası olan ürünlerden ayrı tutulur.",
        "ar": "يصف النص مراجعة اقتراحات العملاء وأفكارهم وشكاواهم والتوسع إلى مواد سنية أخرى. تبقى خطط التطوير منفصلة عن المنتجات التي لها صفحة رسمية فعلية.",
        "ru": "Упомянуты рассмотрение предложений и жалоб клиентов и развитие других стоматологических материалов. Планы отделены от продуктов с существующими официальными страницами."
      }
    ],
    "sourceUrl": "https://idealmakoo.com/pages/23/stretegy"
  },
  {
    "id": "company-24",
    "slug": "positioning",
    "title": {
      "fa": "جایگاه‌یابی و تجربه مشتری",
      "en": "Positioning and customer experience",
      "tr": "Konumlandırma ve müşteri deneyimi",
      "ar": "التموضع وتجربة العملاء",
      "ru": "Позиционирование и клиентский опыт"
    },
    "excerpt": {
      "fa": "توجه به جزئیات قالب و رنگ، بازخورد مشتری و پشتیبانی از شبکه همکاری.",
      "en": "Attention to mould and shade details, customer feedback and support for the partner network.",
      "tr": "Kalıp ve renk ayrıntıları, müşteri geri bildirimi ve iş ortağı ağının desteklenmesi.",
      "ar": "الاهتمام بتفاصيل القالب واللون وآراء العملاء ودعم شبكة الشركاء.",
      "ru": "Внимание к формам и оттенкам, обратной связи клиентов и поддержке партнёрской сети."
    },
    "body": [
      {
        "fa": "متن جایگاه‌یابی، تحقیق و توسعه، تنوع محصول و ثبت دقیق‌تر نیاز مشتری در سفارش‌ها را شرح می‌دهد. توجه به رنگ و سایز مورد نیاز، یکی از مثال‌های مشخص این صفحه است.",
        "en": "The positioning text describes research and development, product variety and more precise recording of customer requirements. Requested shades and sizes are specific examples on the page.",
        "tr": "Konumlandırma metni Ar-Ge’yi, ürün çeşitliliğini ve müşteri ihtiyaçlarının daha doğru kaydını anlatır. İstenen renk ve boyutlar somut örneklerdir.",
        "ar": "يصف نص التموضع البحث والتطوير وتنوع المنتجات وتسجيل احتياجات العملاء بدقة أكبر. الألوان والمقاسات المطلوبة أمثلة محددة.",
        "ru": "Раздел позиционирования описывает исследования, разнообразие и точную запись потребностей. Приведены примеры запрошенных оттенков и размеров."
      },
      {
        "fa": "موضوعاتی مانند حمل، مرجوعی، تعویض و پشتیبانی عامل فروش در روایت اصلی آمده‌اند. متن کامل برای بررسی سابقه در دسترس است؛ شرایط اجرایی جاری باید در ارتباط با شرکت روشن شود.",
        "en": "Shipping, returns, exchanges and distributor support appear in the original account. The complete text is available as historical reference; current operating terms can be clarified with the company.",
        "tr": "Nakliye, iade, değişim ve bayi desteği özgün anlatıda yer alır. Tam metin tarihsel referans olarak sunulur; güncel koşullar şirketten öğrenilebilir.",
        "ar": "يرد الشحن والإرجاع والاستبدال ودعم الموزعين في الرواية الأصلية. يتاح النص الكامل كمرجع تاريخي؛ تُوضح الشروط الحالية مع الشركة.",
        "ru": "В оригинале упомянуты доставка, возвраты, обмен и поддержка дистрибьюторов. Полный текст доступен для справки; действующие условия уточняются у компании."
      }
    ],
    "sourceUrl": "https://idealmakoo.com/pages/24/positioning"
  },
  {
    "id": "company-25",
    "slug": "segmentation",
    "title": {
      "fa": "مخاطبان و بخش‌بندی بازار",
      "en": "Audiences and market segments",
      "tr": "Hedef kitleler ve pazar bölümleri",
      "ar": "الجمهور وشرائح السوق",
      "ru": "Аудитории и сегменты рынка"
    },
    "excerpt": {
      "fa": "لابراتوارها، کلینیک‌ها، درمانگاه‌ها، بیمارستان‌ها، دانشگاه‌ها و شبکه توزیع محصولات دندانپزشکی.",
      "en": "Dental laboratories, clinics, hospitals, universities and the dental product distribution network.",
      "tr": "Diş laboratuvarları, klinikler, hastaneler, üniversiteler ve dental ürün dağıtım ağı.",
      "ar": "مختبرات الأسنان والعيادات والمستشفيات والجامعات وشبكة توزيع المنتجات السنية.",
      "ru": "Зуботехнические лаборатории, клиники, больницы, университеты и сеть дистрибуции стоматологических продуктов."
    },
    "body": [
      {
        "fa": "صفحهٔ بخش‌بندی بازار، فروشگاه‌های تجهیزات دندانی در شهرهای بزرگ و کوچک و همچنین ارتباط با درمانگاه‌ها، کلینیک‌ها، بیمارستان‌ها و مراکز درمانی دانشگاهی را توصیف می‌کند.",
        "en": "The market-segmentation page describes dental suppliers in large and small cities, together with relationships with clinics, hospitals and university treatment centres.",
        "tr": "Pazar bölümleme sayfası büyük ve küçük şehirlerdeki dental tedarikçileri ve klinik, hastane, üniversite tedavi merkezleriyle ilişkileri tanımlar.",
        "ar": "تصف صفحة تقسيم السوق موردي التجهيزات السنية في المدن الكبيرة والصغيرة، إلى جانب العلاقات مع العيادات والمستشفيات والمراكز الجامعية العلاجية.",
        "ru": "Раздел сегментации описывает поставщиков стоматологических товаров в крупных и малых городах и связи с клиниками, больницами и университетскими лечебными центрами."
      },
      {
        "fa": "برای هر گروه، مسیرهای محصول، دریافت نمونه و همکاری در سایت پیش‌بینی شده است تا درخواست‌ها با موضوع دقیق و مشخصات تماس ثبت شوند.",
        "en": "Product, sample-request and cooperation routes help each audience submit a focused request with contact details.",
        "tr": "Ürün, numune talebi ve iş birliği yolları her grubun iletişim bilgileriyle odaklı talep iletmesini sağlar.",
        "ar": "تساعد مسارات المنتجات وطلب العينات والتعاون كل فئة على تقديم طلب محدد مع بيانات الاتصال.",
        "ru": "Разделы продуктов, образцов и сотрудничества позволяют каждой группе подготовить конкретный запрос с контактными данными."
      }
    ],
    "sourceUrl": "https://idealmakoo.com/pages/25/segmentataion"
  },
  {
    "id": "company-26",
    "slug": "development",
    "title": {
      "fa": "تحقیق و توسعه محصول",
      "en": "Research and product development",
      "tr": "Araştırma ve ürün geliştirme",
      "ar": "البحث وتطوير المنتجات",
      "ru": "Исследования и разработка продукции"
    },
    "excerpt": {
      "fa": "حرکت از تولید اکریلیک به محصولات کامپوزیتی، با توجه به بازخورد بازار و تحقیقات.",
      "en": "Progressing from acrylic teeth to composite products, informed by market feedback and research.",
      "tr": "Pazar geri bildirimi ve araştırmalarla akrilik dişlerden kompozit ürünlere gelişim.",
      "ar": "التطور من الأسنان الأكريليكية إلى المنتجات المركبة بالاستناد إلى البحث وآراء السوق.",
      "ru": "Переход от акриловых зубов к композитам с учётом обратной связи рынка и исследований."
    },
    "body": [
      {
        "fa": "روایت توسعه از دندان‌های آکریلیکی آغاز می‌شود و با تحقیق دربارهٔ ISOSID و کامپوزیت ادامه می‌یابد. تقاضای مشتری و بررسی محصولات خارجی به‌عنوان زمینه‌های این تغییر بیان شده‌اند.",
        "en": "The development account starts with acrylic teeth and proceeds to research into ISOSID and composite. Customer demand and examination of imported products are described as drivers.",
        "tr": "Gelişim anlatısı akrilik dişlerden ISOSID ve kompozit araştırmalarına uzanır. Müşteri talebi ve ithal ürünlerin incelenmesi itici etkenler olarak belirtilir.",
        "ar": "تبدأ رواية التطوير بالأسنان الأكريليكية ثم البحث في ISOSID والكومبوزيت. ويُذكر طلب العميل وفحص المنتجات المستوردة كدافعين.",
        "ru": "История развития начинается с акриловых зубов и переходит к исследованиям ISOSID и композитов. Движущими факторами названы спрос и изучение импортных изделий."
      },
      {
        "fa": "شکل دندان، بسته‌بندی، اتصال به آکریل، استحکام و سایش از موضوع‌های پیگیری‌شده در متن هستند. پژوهش‌های مرتبط با اتصال و سایش، در آرشیو پژوهش این سایت با منبع اصلی قابل مطالعه‌اند.",
        "en": "Tooth form, packaging, acrylic bonding, strength and wear are topics in the account. Related bonding and wear studies can be read in this site’s research archive with their original sources.",
        "tr": "Diş formu, ambalaj, akriliğe bağlanma, dayanım ve aşınma anlatıdaki konulardır. İlgili araştırmalar kaynaklarıyla bu sitenin araştırma arşivinde okunabilir.",
        "ar": "يشمل النص شكل الأسنان والتعبئة والارتباط بالأكريليك والاستحكام والتآكل. يمكن قراءة الدراسات ذات الصلة في أرشيف البحوث مع مصادرها الأصلية.",
        "ru": "В тексте затронуты форма зубов, упаковка, соединение с акрилом, прочность и износ. Связанные исследования доступны в научном архиве с источниками."
      }
    ],
    "sourceUrl": "https://idealmakoo.com/pages/26/development"
  },
  {
    "id": "company-27",
    "slug": "pricing-policy",
    "title": {
      "fa": "سیاست تجاری و ارزش محصول",
      "en": "Commercial policy and product value",
      "tr": "Ticari politika ve ürün değeri",
      "ar": "السياسة التجارية وقيمة المنتج",
      "ru": "Коммерческая политика и ценность продукта"
    },
    "excerpt": {
      "fa": "روایت تاریخی شرکت از تنوع محصولات و تناسب ارزش فنی با نیاز گروه‌های مختلف مشتریان.",
      "en": "The company’s historical account of product variety and technical value for different customer groups.",
      "tr": "Şirketin farklı müşteri grupları için ürün çeşitliliği ve teknik değer konusundaki tarihsel yaklaşımı.",
      "ar": "رواية الشركة التاريخية حول تنوع المنتجات والقيمة الفنية لشرائح العملاء المختلفة.",
      "ru": "Историческое описание подхода компании к разнообразию продукции и технической ценности для разных клиентов."
    },
    "body": [
      {
        "fa": "صفحهٔ قیمت‌گذاری، مسیر تاریخی شرکت از محصولات آکریلیکی به سری‌های ایزوسید و کامپوزیتی را در ارتباط با جایگاه قیمتی توضیح می‌دهد. اعداد و مقایسه‌های آن متن مربوط به همان روایت تاریخی هستند.",
        "en": "The pricing page relates the company’s historical move from acrylic products to Isosid and composite ranges to price positioning. Its numbers and comparisons belong to that historical account.",
        "tr": "Fiyatlandırma sayfası akrilik ürünlerden Isosid ve kompozit serilere tarihsel geçişi fiyat konumuyla ilişkilendirir. Sayılar ve karşılaştırmalar bu tarihsel anlatıya aittir.",
        "ar": "تربط صفحة التسعير التحول التاريخي من الأكريليك إلى سلاسل إيزوسيد والكومبوزيت بالتموضع السعري. تنتمي أرقامها ومقارناتها إلى تلك الرواية التاريخية.",
        "ru": "Раздел ценообразования связывает переход от акрила к Isosid и композитам с ценовым позиционированием. Цифры и сравнения относятся к историческому описанию."
      },
      {
        "fa": "در این نسخه، قیمت عمومی یا تخفیف فعال از آن ارقام ساخته نشده است. درخواست قیمت بر اساس محصول و تعداد، از سبد استعلام قابل آماده‌سازی است.",
        "en": "This version does not turn those figures into public prices or active discounts. A product-and-quantity pricing request can be prepared through the inquiry list.",
        "tr": "Bu sürüm tarihsel sayılardan genel fiyat veya aktif indirim üretmez. Ürün ve miktara göre fiyat talebi, talep listesinden hazırlanabilir.",
        "ar": "لا تحول هذه النسخة الأرقام إلى أسعار عامة أو خصومات فعالة. يمكن إعداد طلب سعر بالمنتج والكمية عبر قائمة الاستعلام.",
        "ru": "Эта версия не преобразует исторические цифры в текущие цены и скидки. Запрос цены по продукту и количеству можно подготовить в списке запросов."
      }
    ],
    "sourceUrl": "https://idealmakoo.com/pages/27/price"
  },
  {
    "id": "company-28",
    "slug": "marketing-training",
    "title": {
      "fa": "آموزش و مدیریت بازار",
      "en": "Market management and learning",
      "tr": "Pazar yönetimi ve öğrenme",
      "ar": "إدارة السوق والتعلم",
      "ru": "Управление рынком и обучение"
    },
    "excerpt": {
      "fa": "شناخت نیاز مصرف‌کننده، مطالعه بازار، بهبود مستمر و توجه به مهارت کارکنان.",
      "en": "Understanding user needs, market study, continuous improvement and staff development.",
      "tr": "Kullanıcı ihtiyaçlarını anlama, pazar araştırması, sürekli iyileştirme ve çalışan gelişimi.",
      "ar": "فهم احتياجات المستخدم ودراسة السوق والتحسين المستمر وتطوير الموظفين.",
      "ru": "Понимание потребностей, изучение рынка, непрерывное улучшение и развитие сотрудников."
    },
    "body": [
      {
        "fa": "متن مدیریت بازاریابی به بررسی نیاز مصرف‌کننده، تحلیل بازار، شناخت محصولات و کانال‌های توزیع و استفاده از بازخوردها برای اصلاح عملکرد می‌پردازد.",
        "en": "The marketing-management text covers consumer needs, market analysis, products and distribution channels, and using feedback to improve performance.",
        "tr": "Pazarlama yönetimi metni tüketici ihtiyaçları, pazar analizi, ürünler, dağıtım kanalları ve geri bildirimle iyileştirmeyi ele alır.",
        "ar": "يتناول نص إدارة التسويق احتياجات المستهلك وتحليل السوق والمنتجات وقنوات التوزيع واستخدام الملاحظات لتحسين الأداء.",
        "ru": "Текст об управлении маркетингом рассматривает потребности, анализ рынка, продукты, каналы распределения и улучшения на основе обратной связи."
      },
      {
        "fa": "توسعهٔ مهارت کارکنان، نگرش بهبود مستمر و حفظ ارتباط با مشتری از دیگر محورهای همین صفحه است. برای دورهٔ آموزشی، تقویم یا رویداد دارای تاریخ، تنها اطلاعات واقعاً منتشرشده در بخش مربوط نمایش داده می‌شود.",
        "en": "Staff skills, continuous improvement and customer relationships are further themes. Dated courses or events are shown only when an actual publication is available in the relevant section.",
        "tr": "Çalışan becerileri, sürekli iyileştirme ve müşteri ilişkileri diğer temalardır. Tarihli eğitim ve etkinlikler yalnızca ilgili bölümde gerçek bir yayın varsa gösterilir.",
        "ar": "مهارات العاملين والتحسين المستمر وعلاقات العملاء محاور أخرى. تُعرض الدورات والفعاليات المؤرخة فقط عند وجود نشر فعلي في القسم المختص.",
        "ru": "Другие темы — навыки сотрудников, постоянное улучшение и отношения с клиентами. Датированные курсы и события отображаются лишь при наличии реальной публикации."
      }
    ],
    "sourceUrl": "https://idealmakoo.com/pages/28/bazar"
  },
  {
    "id": "company-4",
    "slug": "contact",
    "title": {
      "fa": "تماس با ایده‌آل ماکو",
      "en": "Contact Ideal Makoo",
      "tr": "Ideal Makoo ile iletişim",
      "ar": "اتصل بإيدآل ماكو",
      "ru": "Связаться с Ideal Makoo"
    },
    "excerpt": {
      "fa": "دفتر تهران: میدان ولیعصر، ابتدای ضلع جنوبی بلوار کشاورز، پلاک ۲۲، طبقه ۵.",
      "en": "Tehran office: Valiasr Square, south side at the start of Keshavarz Boulevard, No. 22, 5th floor.",
      "tr": "Tahran ofisi: Veliasr Meydanı, Keşaverz Bulvarı başlangıcının güney tarafı, No. 22, 5. kat.",
      "ar": "مكتب طهران: ساحة ولي عصر، بداية الجانب الجنوبي من شارع كشاورز، رقم 22، الطابق الخامس.",
      "ru": "Офис в Тегеране: площадь Валиаср, южная сторона начала бульвара Кешаварз, дом 22, 5-й этаж."
    },
    "body": [
      {
        "fa": "دفتر تهران: میدان ولیعصر، ابتدای ضلع جنوبی بلوار کشاورز، پلاک ۲۲، طبقه ۵.",
        "en": "Tehran office: Valiasr Square, south side at the start of Keshavarz Boulevard, No. 22, 5th floor.",
        "tr": "Tahran ofisi: Veliasr Meydanı, Keşaverz Bulvarı başlangıcının güney tarafı, No. 22, 5. kat.",
        "ar": "مكتب طهران: ساحة ولي عصر، بداية الجانب الجنوبي من شارع كشاورز، رقم 22، الطابق الخامس.",
        "ru": "Офис в Тегеране: площадь Валиаср, южная сторона начала бульвара Кешаварз, дом 22, 5-й этаж."
      }
    ],
    "sourceUrl": "https://idealmakoo.com/pages/4/contact"
  }
];

export const company = {
  "name": {
    "fa": "ایده‌آل ماکو",
    "en": "Ideal Makoo",
    "tr": "Ideal Makoo",
    "ar": "إيدآل ماكو",
    "ru": "Ideal Makoo"
  },
  "about": {
    "fa": "از سال ۱۳۶۰، در مسیر تولید دندان مصنوعی و توسعه مواد دندانی در منطقه آزاد ماکو.",
    "en": "Founded in 1360 SH, Ideal Makoo manufactures denture teeth and develops dental materials in the Maku Free Zone.",
    "tr": "1360 HŞ yılında kurulan Ideal Makoo, Maku Serbest Bölgesi’nde protez diş ve dental malzemeler üretir.",
    "ar": "تأسست إيدآل ماكو عام 1360 هجري شمسي لإنتاج الأسنان الصناعية وتطوير المواد السنية في منطقة ماكو الحرة.",
    "ru": "Ideal Makoo основана в 1360 году солнечной хиджры и производит искусственные зубы и стоматологические материалы в свободной зоне Маку."
  },
  "address": {
    "fa": "دفتر تهران: میدان ولیعصر، ابتدای ضلع جنوبی بلوار کشاورز، پلاک ۲۲، طبقه ۵.",
    "en": "Tehran office: Valiasr Square, south side at the start of Keshavarz Boulevard, No. 22, 5th floor.",
    "tr": "Tahran ofisi: Veliasr Meydanı, Keşaverz Bulvarı başlangıcının güney tarafı, No. 22, 5. kat.",
    "ar": "مكتب طهران: ساحة ولي عصر، بداية الجانب الجنوبي من شارع كشاورز، رقم 22، الطابق الخامس.",
    "ru": "Офис в Тегеране: площадь Валиаср, южная сторона начала бульвара Кешаварз, дом 22, 5-й этаж."
  },
  "factoryLocation": {
    "fa": "منطقه آزاد صنعتی و تجاری ماکو، نزدیک آرارات",
    "en": "Maku industrial and commercial free zone, near Ararat",
    "tr": "Maku sanayi ve ticaret serbest bölgesi, Ağrı Dağı yakınında",
    "ar": "منطقة ماكو الصناعية والتجارية الحرة، قرب أرارات",
    "ru": "Промышленно-торговая свободная зона Маку, у Арарата"
  },
  "phones": [
    "02188899776",
    "02188906776",
    "02188897672",
    "02188893837"
  ],
  "sourceUrl": "https://idealmakoo.com/pages/2/about",
  "contactSourceUrl": "https://idealmakoo.com/pages/4/contact",
  "logo": "/media/brand/logo-transparent.png",
  "heroImage": "/media/official/1686661396.jpg",
  "foundedYear": 1360,
  "foundedCalendar": "Solar Hijri",
  "registrationNumber": "180",
  "website": "https://idealmakoo.com/",
  "instagram": "https://instagram.com/idealmakoo_company",
  "whatsapp": "https://wa.me/989120166058",
  "mediaGallery": [
    "/media/official/1686737295.jpg",
    "/media/official/1686737306.jpg",
    "/media/official/1686737311.jpg",
    "/media/official/1686737318.jpg",
    "/media/official/1686737323.jpg",
    "/media/official/1686737327.jpg"
  ]
};

export const resources: Resource[] = [
  {
    "id": "sheet-apple",
    "slug": "apple-official-image",
    "title": {
      "fa": "دندان مصنوعی اپل — تصویر رسمی",
      "en": "Apple denture teeth — official image",
      "tr": "Apple protez dişler — resmî görsel",
      "ar": "أسنان آبل الصناعية — صورة رسمية",
      "ru": "Искусственные зубы Apple — официальное изображение"
    },
    "url": "/media/official/1686388135.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/6/apple",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "apple"
  },
  {
    "id": "sheet-bstar-nano-composite",
    "slug": "bstar-nano-composite-official-image",
    "title": {
      "fa": "بی‌استار نانو کامپوزیت — تصویر رسمی",
      "en": "B.Star nano composite teeth — official image",
      "tr": "B.Star nano kompozit dişler — resmî görsel",
      "ar": "أسنان بي ستار نانو كومبوزيت — صورة رسمية",
      "ru": "Зубы B.Star Nano Composite — официальное изображение"
    },
    "url": "/media/official/1686378278.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/7/bstar-nano-composite",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "bstar-nano-composite"
  },
  {
    "id": "sheet-super-berelian",
    "slug": "super-berelian-official-image",
    "title": {
      "fa": "دندان مصنوعی سوپر برلیان — تصویر رسمی",
      "en": "Super Berelian denture teeth — official image",
      "tr": "Super Berelian protez dişler — resmî görsel",
      "ar": "أسنان سوبر بريليان الصناعية — صورة رسمية",
      "ru": "Искусственные зубы Super Berelian — официальное изображение"
    },
    "url": "/media/official/1686388117.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/8/super-berelian",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "super-berelian"
  },
  {
    "id": "sheet-glamour",
    "slug": "glamour-official-image",
    "title": {
      "fa": "دندان مصنوعی گلامور — تصویر رسمی",
      "en": "Glamour denture teeth — official image",
      "tr": "Glamour protez dişler — resmî görsel",
      "ar": "أسنان غلامور الصناعية — صورة رسمية",
      "ru": "Искусственные зубы Glamour — официальное изображение"
    },
    "url": "/media/official/1686388105.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/9/glamour",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "glamour"
  },
  {
    "id": "sheet-super-newclar",
    "slug": "super-newclar-official-image",
    "title": {
      "fa": "دندان مصنوعی سوپر نیوکلار — تصویر رسمی",
      "en": "Super Newclar denture teeth — official image",
      "tr": "Super Newclar protez dişler — resmî görsel",
      "ar": "أسنان سوبر نيوكلار الصناعية — صورة رسمية",
      "ru": "Искусственные зубы Super Newclar — официальное изображение"
    },
    "url": "/media/official/1686388092.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/10/super-newclar",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "super-newclar"
  },
  {
    "id": "sheet-marjan-new",
    "slug": "marjan-new-official-image",
    "title": {
      "fa": "دندان مصنوعی مرجان نیو — تصویر رسمی",
      "en": "Marjan New denture teeth — official image",
      "tr": "Marjan New protez dişler — resmî görsel",
      "ar": "أسنان مرجان نيو الصناعية — صورة رسمية",
      "ru": "Искусственные зубы Marjan New — официальное изображение"
    },
    "url": "/media/official/1686388063.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/11/marjan-new",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "marjan-new"
  },
  {
    "id": "sheet-yaghoot",
    "slug": "yaghoot-official-image",
    "title": {
      "fa": "دندان مصنوعی یاقوت — تصویر رسمی",
      "en": "Yaghoot denture teeth — official image",
      "tr": "Yaghoot protez dişler — resmî görsel",
      "ar": "أسنان ياقوت الصناعية — صورة رسمية",
      "ru": "Искусственные зубы Yaghoot — официальное изображение"
    },
    "url": "/media/official/1686388050.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/12/yaghoot",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "yaghoot"
  },
  {
    "id": "sheet-newclar",
    "slug": "newclar-official-image",
    "title": {
      "fa": "دندان مصنوعی نیوکلار — تصویر رسمی",
      "en": "Newclar denture teeth — official image",
      "tr": "Newclar protez dişler — resmî görsel",
      "ar": "أسنان نيوكلار الصناعية — صورة رسمية",
      "ru": "Искусственные зубы Newclar — официальное изображение"
    },
    "url": "/media/official/1686388036.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/13/newclar",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "newclar"
  },
  {
    "id": "sheet-bstar-nano-base",
    "slug": "bstar-nano-base-official-image",
    "title": {
      "fa": "بی‌استار نانو بیس — تصویر رسمی",
      "en": "B.Star Nano Base teeth — official image",
      "tr": "B.Star Nano Base dişler — resmî görsel",
      "ar": "أسنان بي ستار نانو بيس — صورة رسمية",
      "ru": "Зубы B.Star Nano Base — официальное изображение"
    },
    "url": "/media/official/1686388024.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/14/b-star-nano-base",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "bstar-nano-base"
  },
  {
    "id": "sheet-berelian",
    "slug": "berelian-official-image",
    "title": {
      "fa": "دندان مصنوعی برلیان — تصویر رسمی",
      "en": "Berelian denture teeth — official image",
      "tr": "Berelian protez dişler — resmî görsel",
      "ar": "أسنان بريليان الصناعية — صورة رسمية",
      "ru": "Искусственные зубы Berelian — официальное изображение"
    },
    "url": "/media/official/1686482307.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/15/دندان-مصنوعی-برلیان",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "berelian"
  },
  {
    "id": "sheet-president",
    "slug": "president-official-image",
    "title": {
      "fa": "دندان مصنوعی پرزیدنت — تصویر رسمی",
      "en": "President denture teeth — official image",
      "tr": "President protez dişler — resmî görsel",
      "ar": "أسنان بريزيدنت الصناعية — صورة رسمية",
      "ru": "Искусственные зубы President — официальное изображение"
    },
    "url": "/media/official/1686482293.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/16/دندان-مصنوعی-پرزیدنت",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "president"
  },
  {
    "id": "sheet-dentex-etch-37",
    "slug": "dentex-etch-37-official-image",
    "title": {
      "fa": "اسید اچ ۳۷٪ دنتکس — تصویر رسمی",
      "en": "Dentex 37% etching gel — official image",
      "tr": "Dentex %37 asitleme jeli — resmî görsel",
      "ar": "جل تخريش دنتكس 37% — صورة رسمية",
      "ru": "Травильный гель Dentex 37% — официальное изображение"
    },
    "url": "/media/official/1726478812.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/30/اسید-اچ-37%-دنتکس",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "dentex-etch-37"
  },
  {
    "id": "sheet-generation-8-bonding",
    "slug": "generation-8-bonding-official-image",
    "title": {
      "fa": "باندینگ رزین نسل ۸ — تصویر رسمی",
      "en": "Generation 8 resin bonding — official image",
      "tr": "8. nesil rezin bonding — resmî görsel",
      "ar": "بوندنغ راتنجي من الجيل الثامن — صورة رسمية",
      "ru": "Адгезивная смола 8-го поколения — официальное изображение"
    },
    "url": "/media/official/1725864338.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/31/باندینگ-رزین-نسل-8",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "generation-8-bonding"
  },
  {
    "id": "sheet-light-cure-composite",
    "slug": "light-cure-composite-official-image",
    "title": {
      "fa": "کامپوزیت لایت‌کیور — تصویر رسمی",
      "en": "Light-cure composite — official image",
      "tr": "Işıkla sertleşen kompozit — resmî görsel",
      "ar": "كومبوزيت ضوئي التصلب — صورة رسمية",
      "ru": "Светоотверждаемый композит — официальное изображение"
    },
    "url": "/media/official/1725860714.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/32/کامپوزیت-لایت-کیور",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "light-cure-composite"
  },
  {
    "id": "sheet-ideal-line",
    "slug": "ideal-line-official-image",
    "title": {
      "fa": "دندان ایده‌آل لاین — تصویر رسمی",
      "en": "Ideal Line denture teeth — official image",
      "tr": "Ideal Line protez dişler — resmî görsel",
      "ar": "أسنان إيدآل لاين الصناعية — صورة رسمية",
      "ru": "Искусственные зубы Ideal Line — официальное изображение"
    },
    "url": "/media/official/1726476922.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/33/دندان-ایده-آل-لاین",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "ideal-line"
  },
  {
    "id": "sheet-antic",
    "slug": "antic-official-image",
    "title": {
      "fa": "دندان آنتیک — تصویر رسمی",
      "en": "Antic denture teeth — official image",
      "tr": "Antic protez dişler — resmî görsel",
      "ar": "أسنان أنتيك الصناعية — صورة رسمية",
      "ru": "Искусственные зубы Antic — официальное изображение"
    },
    "url": "/media/official/1725860871.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/51/دندان-آنتیک",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "antic"
  },
  {
    "id": "sheet-laboratory-putty",
    "slug": "laboratory-putty-official-image",
    "title": {
      "fa": "پوتی لابراتواری — تصویر رسمی",
      "en": "Laboratory putty — official image",
      "tr": "Laboratuvar putty materyali — resmî görsel",
      "ar": "معجون مخبري — صورة رسمية",
      "ru": "Лабораторная масса Putty — официальное изображение"
    },
    "url": "/media/official/1725860946.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/56/پوتی-لابراتواری",
    "type": "brochure",
    "format": "JPG",
    "language": "fa",
    "productId": "laboratory-putty"
  },
  {
    "id": "cover-research-34",
    "slug": "resin-base-bond-four-teeth-cover",
    "title": {
      "fa": "استحکام اتصال بیس رزینی به گلامور، یاقوت، اپل و ایوکلار",
      "en": "Resin-base bonding to Glamour, Yaghoot, Apple and Ivoclar",
      "tr": "Glamour, Yaghoot, Apple ve Ivoclar dişlerde rezin kaide bağlantısı",
      "ar": "ارتباط القاعدة الراتنجية بغلامور وياقوت وآبل وإيفوكلار",
      "ru": "Соединение базисной смолы с Glamour, Yaghoot, Apple и Ivoclar"
    },
    "url": "/media/official/1689234925.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/34/میزان-استحکام-باند-بیس-رزینی",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  },
  {
    "id": "cover-research-35",
    "slug": "acrylic-composite-resin-bond-cover",
    "title": {
      "fa": "مقایسه اتصال دندان‌های اکریلیکی و کامپوزیتی به رزین پایه",
      "en": "Acrylic and composite tooth bonding to denture-base resin",
      "tr": "Akrilik ve kompozit dişlerin kaide rezinine bağlantısı",
      "ar": "ارتباط الأسنان الأكريليكية والكومبوزيت براتنج القاعدة",
      "ru": "Соединение акриловых и композитных зубов с базисной смолой"
    },
    "url": "/media/official/1689235166.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/35/بررسی-مقایسه-ای-استحکام-اتصال-دندانهای-مصنوعی-آکریلی-و-کامپوزیتی-،ایرانی-به-خارجی-به-رزین-پایه-پروتز",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  },
  {
    "id": "cover-research-36",
    "slug": "three-teeth-denture-base-bond-cover",
    "title": {
      "fa": "اتصال اپل، گلامور و بی‌استار به اکریل بیس دنچر",
      "en": "Apple, Glamour and B.Star bonding to acrylic denture bases",
      "tr": "Apple, Glamour ve B.Star dişlerinin akrilik kaideye bağlantısı",
      "ar": "ارتباط آبل وغلامور وبي ستار بالقاعدة الأكريليكية",
      "ru": "Соединение Apple, Glamour и B.Star с акриловым базисом"
    },
    "url": "/media/official/1689235260.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/36/میزان-استحکام-اتصال-سه-نوع-دندان-مصنوعی",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  },
  {
    "id": "cover-research-37",
    "slug": "president-ivoclar-3d-wear-cover",
    "title": {
      "fa": "مقایسه سایش پرزیدنت و ایوکلار با اسکن سه‌بعدی",
      "en": "President and Ivoclar wear assessed with 3D scanning",
      "tr": "Üç boyutlu taramayla President ve Ivoclar aşınması",
      "ar": "مقارنة تآكل بريزيدنت وإيفوكلار بالمسح ثلاثي الأبعاد",
      "ru": "Сравнение износа President и Ivoclar с помощью 3D-сканирования"
    },
    "url": "/media/official/1689235423.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/37/بررسی-مقاومت-سایشی-دندان-پرزیدنت-و-آیوکلار",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  },
  {
    "id": "cover-research-38",
    "slug": "three-teeth-heat-cured-resin-cover",
    "title": {
      "fa": "اتصال برلیان، سوپر برلیان و ایوکلار به رزین گرماپخت",
      "en": "Berelian, Super Berelian and Ivoclar bonding to heat-cured resin",
      "tr": "Berelian, Super Berelian ve Ivoclar dişlerinin sıcak polimerize rezine bağlantısı",
      "ar": "ارتباط بريليان وسوبر بريليان وإيفوكلار بالراتنج الحراري",
      "ru": "Соединение Berelian, Super Berelian и Ivoclar с термоотверждаемой смолой"
    },
    "url": "/media/official/1689235611.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/38/استحکام-اتصال-سه-نوع-دندان-مصنوعی",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  },
  {
    "id": "cover-research-39",
    "slug": "acrylic-teeth-wear-comparison-cover",
    "title": {
      "fa": "مقایسه سایش شش سری دندان اکریلیکی",
      "en": "Wear comparison of six acrylic tooth ranges",
      "tr": "Altı akrilik diş serisinin aşınma karşılaştırması",
      "ar": "مقارنة تآكل ست سلاسل من الأسنان الأكريليكية",
      "ru": "Сравнение износа шести серий акриловых зубов"
    },
    "url": "/media/official/1689235813.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/39/مقایسه-میزان-سایش-در-دندان-ها",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  },
  {
    "id": "cover-research-40",
    "slug": "iranian-swiss-dentin-bond-cover",
    "title": {
      "fa": "استحکام اتصال کامپوزیت ایده‌آل ماکو و سینرژی به عاج",
      "en": "Dentin bonding of Ideal Makoo and Synergy composites",
      "tr": "Ideal Makoo ve Synergy kompozitlerinin dentine bağlantısı",
      "ar": "ارتباط كومبوزيت إيدآل ماكو وسينرجي بالعاج",
      "ru": "Соединение композитов Ideal Makoo и Synergy с дентином"
    },
    "url": "/media/official/1689235972.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/40/بررسی-آزمایشگاهی-استحکام-برشی-باندینگ-کامپوزیت",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  },
  {
    "id": "cover-research-41",
    "slug": "six-acrylic-ranges-steady-wear-cover",
    "title": {
      "fa": "نرخ سایش پایدار شش گروه دندان مصنوعی",
      "en": "Steady-state wear in six denture tooth groups",
      "tr": "Altı protez diş grubunda kararlı durum aşınması",
      "ar": "التآكل المستقر في ست مجموعات أسنان صناعية",
      "ru": "Стационарный износ шести групп искусственных зубов"
    },
    "url": "/media/official/1689236247.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/41/مقایسه-میزان-سایش-در-دندان-ها",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  },
  {
    "id": "cover-research-42",
    "slug": "iranian-teeth-ivoclar-wear-cover",
    "title": {
      "fa": "بررسی سایش برلیان و سوپر برلیان در مقایسه با ایوکلار",
      "en": "Wear of Berelian and Super Berelian compared with Ivoclar",
      "tr": "Berelian ve Super Berelian aşınmasının Ivoclar ile karşılaştırılması",
      "ar": "تآكل بريليان وسوبر بريليان مقارنة بإيفوكلار",
      "ru": "Износ Berelian и Super Berelian по сравнению с Ivoclar"
    },
    "url": "/media/official/1689236463.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/42/بررسی-مقایسه-ای-سایش-دو-نوع-دندان-مصنوعی-ایرانی",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  },
  {
    "id": "cover-research-20",
    "slug": "six-teeth-wear-rate-cover",
    "title": {
      "fa": "مقایسه نرخ سایش ۶ نوع دندان مصنوعی",
      "en": "Wear-rate comparison of six denture tooth types",
      "tr": "Altı protez diş türünün aşınma hızı karşılaştırması",
      "ar": "مقارنة معدل تآكل ستة أنواع أسنان صناعية",
      "ru": "Сравнение скорости износа шести типов искусственных зубов"
    },
    "url": "/media/official/1686664281.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/20/مقایسه-نرخ-سایش",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  },
  {
    "id": "cover-research-19",
    "slug": "apple-super-major-wear-cover",
    "title": {
      "fa": "مقایسه سایش دندان اپل و سوپر ماژور",
      "en": "Wear comparison of Apple and Super Major teeth",
      "tr": "Apple ve Super Major dişlerin aşınma karşılaştırması",
      "ar": "مقارنة تآكل أسنان آبل وسوبر ماجور",
      "ru": "Сравнение износа зубов Apple и Super Major"
    },
    "url": "/media/official/1686664184.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/19/مقایسه-سایشی-دندان",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  },
  {
    "id": "cover-research-18",
    "slug": "iranian-swiss-shear-bond-cover",
    "title": {
      "fa": "اتصال برشی کامپوزیت ایرانی و سوئیسی",
      "en": "Shear bonding of Iranian and Swiss composites",
      "tr": "İran ve İsviçre kompozitlerinde makaslama bağlantısı",
      "ar": "الارتباط القصي لكومبوزيت إيراني وسويسري",
      "ru": "Соединение на сдвиг иранского и швейцарского композитов"
    },
    "url": "/media/official/1686664033.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/18/استحکام-باند-برشی",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  },
  {
    "id": "cover-research-17",
    "slug": "four-teeth-wear-rate-cover",
    "title": {
      "fa": "مقایسه نرخ سایش ۴ نوع دندان مصنوعی",
      "en": "Wear-rate comparison of four denture tooth types",
      "tr": "Dört protez diş türünün aşınma hızı karşılaştırması",
      "ar": "مقارنة معدل تآكل أربعة أنواع أسنان صناعية",
      "ru": "Сравнение скорости износа четырёх типов искусственных зубов"
    },
    "url": "/media/official/1686663870.jpg",
    "sourceUrl": "https://idealmakoo.com/pages/17/مقایسه-نرخ-سایش",
    "type": "research",
    "format": "JPG",
    "language": "fa"
  }
];
