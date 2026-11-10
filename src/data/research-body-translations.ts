import type {ContentLocale} from '@/data/catalog';

/**
 * Translations of the existing Persian editorial paragraphs in articles[].body.
 * The original source records remain unchanged. Sample counts, limitations and
 * years are retained; no Gregorian conversion or additional research claim is made.
 */
export const researchBodyTranslations:Record<string,Record<Exclude<ContentLocale,'fa'>,string[]>>={
  'research-34':{
    en:[
      'This entry in the company archive concerns a study of the bonding of four tooth models to a resin base. The review focuses on the effects of mechanical and chemical changes to the tooth bonding surface.',
      'The official page reviews differing findings from earlier studies on monomer use and modification of the ridge-lap surface. This section does not establish a single procedure applicable to every material.',
    ],
    tr:[
      'Şirket arşivindeki bu yazı, dört diş modelinin rezin kaideye bağlantısını inceleyen bir çalışmaya ayrılmıştır. İnceleme, dişin bağlantı yüzeyindeki mekanik ve kimyasal değişikliklerin etkisine odaklanır.',
      'Resmî sayfa, monomer kullanımı ve ridge-lap yüzeyinin değiştirilmesi hakkında önceki çalışmaların farklı bulgularını ele alır. Bu bölümden bütün malzemeler için geçerli tek bir uygulama yöntemi çıkarılamaz.',
    ],
    ar:[
      'يتناول هذا المدخل في أرشيف الشركة دراسة ارتباط أربعة طرازات من الأسنان بقاعدة راتنجية. وتتركز المراجعة على أثر التغييرات الميكانيكية والكيميائية في سطح ارتباط السن.',
      'تستعرض الصفحة الرسمية نتائج متباينة لدراسات سابقة بشأن استخدام المونومر وتعديل سطح السن الملامس للقاعدة. ولا يمكن استخلاص إجراء موحد يصلح لجميع المواد من هذا القسم.',
    ],
    ru:[
      'Эта публикация в архиве компании посвящена исследованию соединения четырёх моделей зубов с базисной смолой. Обзор рассматривает влияние механических и химических изменений поверхности соединения зуба.',
      'На официальной странице рассматриваются различающиеся результаты прежних исследований применения мономера и изменения поверхности зуба, прилегающей к базису. Этот раздел не устанавливает единую методику для всех материалов.',
    ],
  },
  'research-35':{
    en:[
      'The study report describes the selection of maxillary canine teeth from three groups and their attachment to a resin base after preparation. Compressive and shear tests were used to measure the force at failure.',
      'The published summary reports no statistically significant difference between the mean bond strengths of the groups. This finding concerns the experimental conditions described.',
    ],
    tr:[
      'Çalışma raporunda, üç gruptan üst çene kanin dişlerinin seçildiği ve hazırlandıktan sonra rezin kaideye bağlandığı belirtilir. Kırılma kuvvetini ölçmek için basma ve makaslama testleri kullanılmıştır.',
      'Yayımlanan özette, grupların ortalama bağlantı dayanımları arasındaki farkın istatistiksel olarak anlamlı olmadığı bildirilir. Bu bulgu, açıklanan deney koşullarıyla ilgilidir.',
    ],
    ar:[
      'يصف تقرير الدراسة اختيار أنياب علوية من ثلاث مجموعات وربطها بقاعدة راتنجية بعد تحضيرها. واستُخدمت اختبارات الضغط والقص لقياس القوة عند الفشل.',
      'لا يذكر الملخص المنشور فرقًا ذا دلالة إحصائية بين متوسطات قوة الارتباط في المجموعات. وترتبط هذه النتيجة بالظروف التجريبية الموصوفة.',
    ],
    ru:[
      'В отчёте об исследовании описаны выбор клыков верхней челюсти из трёх групп и их соединение с базисной смолой после подготовки. Для измерения усилия разрушения использовали испытания на сжатие и сдвиг.',
      'В опубликованном резюме не сообщается о статистически значимом различии средней прочности соединения между группами. Этот результат относится к описанным условиям эксперимента.',
    ],
  },
  'research-36':{
    en:[
      'The factory archive presents a study from Ahvaz Jundishapur University of Medical Sciences involving Apple, Glamour and B.Star teeth. Ten specimens were selected for each group, and shear force was applied to assess bonding.',
      'The figures in the source are the results of that particular test. This page provides a study summary and does not replace the full research report.',
    ],
    tr:[
      'Fabrika arşivi, Ahvaz Cündişapur Tıp Bilimleri Üniversitesinde Apple, Glamour ve B.Star dişleri üzerinde yapılan bir çalışmayı tanıtır. Her grup için on örnek seçilmiş ve bağlantıyı değerlendirmek amacıyla makaslama kuvveti uygulanmıştır.',
      'Kaynakta yer alan sayılar, söz konusu testin sonuçlarıdır. Bu sayfa çalışmanın özetini sunar ve araştırma raporunun tamamının yerini almaz.',
    ],
    ar:[
      'يعرض أرشيف المصنع دراسة من جامعة جندي شابور للعلوم الطبية في الأهواز تناولت أسنان آبل وغلامور وبي ستار. واختيرت عشر عينات لكل مجموعة، وطُبقت قوة قص لتقييم الارتباط.',
      'الأرقام الواردة في المصدر هي نتائج ذلك الاختبار تحديدًا. وتقدم هذه الصفحة ملخصًا للدراسة ولا تحل محل تقرير البحث الكامل.',
    ],
    ru:[
      'В архиве фабрики представлено исследование Ахвазского университета медицинских наук Джундишапур, посвящённое зубам Apple, Glamour и B.Star. Для каждой группы выбрали десять образцов и приложили сдвигающую нагрузку для оценки соединения.',
      'Числа в источнике отражают результаты именно этого испытания. На странице приведено резюме исследования, которое не заменяет полный научный отчёт.',
    ],
  },
  'research-37':{
    en:[
      'The reference page describes a study conducted at the Tehran dental branch of Islamic Azad University in 1394, using the year given in the source. Its aim was to compare the wear resistance of President and Ivoclar in contact with natural teeth using 3D scanning.',
      'The available text mainly explains the rationale and aim of the study and does not publish a final quantitative result. No definite superiority or equivalence is therefore inferred from this page.',
    ],
    tr:[
      'Kaynak sayfa, İslami Azad Üniversitesinin Tahran diş hekimliği biriminde, kaynakta belirtilen takvime göre 1394 yılında yapılan bir çalışmadan söz eder. Çalışmanın amacı, doğal dişle temas eden President ve Ivoclar dişlerinin aşınma direncini üç boyutlu taramayla karşılaştırmaktır.',
      'Erişilebilir metin ağırlıklı olarak araştırmanın gerekçesini ve amacını açıklar; nihai nicel sonucu yayımlamaz. Bu nedenle sayfadan kesin bir üstünlük veya eşdeğerlik sonucu çıkarılmamıştır.',
    ],
    ar:[
      'تشير الصفحة المرجعية إلى دراسة أُجريت في فرع طب الأسنان بطهران التابع للجامعة الإسلامية الحرة سنة 1394 بحسب التاريخ الوارد في المصدر. وهدفت إلى مقارنة مقاومة التآكل لأسنان بريزيدنت وإيفوكلار عند ملامسة الأسنان الطبيعية باستخدام المسح ثلاثي الأبعاد.',
      'يركز النص المتاح أساسًا على مبررات الدراسة وهدفها، ولا ينشر نتيجة كمية نهائية. لذلك لم يُستنتج من هذه الصفحة تفوق أو تكافؤ بصورة قاطعة.',
    ],
    ru:[
      'На исходной странице упоминается исследование, проведённое в стоматологическом подразделении Исламского университета Азад в Тегеране в 1394 году по календарю источника. Его целью было сравнение износостойкости President и Ivoclar при контакте с естественными зубами с помощью трёхмерного сканирования.',
      'Доступный текст преимущественно описывает обоснование и цель исследования и не содержит окончательного количественного результата. Поэтому по этой странице не делается вывод о безусловном превосходстве или эквивалентности.',
    ],
  },
  'research-38':{
    en:[
      'This study examined the bonding of two Iranian tooth models and one foreign model to heat-cured acrylic resin. The method describes 21 specimens in each group and records the force and location of failure.',
      'The published summary reports no significant difference between the mean bond strengths of the three groups. The findings are limited to the specimens and test method used in that study.',
    ],
    tr:[
      'Bu çalışma, iki İran diş modeli ile bir yabancı modelin sıcak polimerize akrilik rezine bağlantısını incelemiştir. Yöntem bölümünde her grup için 21 örnek belirtilmiş, kırılma kuvveti ve kırılma yeri kaydedilmiştir.',
      'Yayımlanan özet, üç grubun ortalama bağlantı dayanımları arasında anlamlı bir fark bildirmez. Bulgular, bu araştırmada kullanılan örnekler ve test yöntemiyle sınırlıdır.',
    ],
    ar:[
      'درست هذه الدراسة ارتباط طرازين إيرانيين من الأسنان وطراز أجنبي واحد بالراتنج الأكريليكي المعالج حراريًا. ويذكر وصف الطريقة 21 عينة لكل مجموعة، مع تسجيل القوة عند الفشل وموقعه.',
      'لا يذكر الملخص المنشور فرقًا ذا دلالة بين متوسطات قوة الارتباط في المجموعات الثلاث. وتقتصر النتائج على عينات تلك الدراسة وطريقة اختبارها.',
    ],
    ru:[
      'В исследовании изучали соединение двух иранских моделей зубов и одной зарубежной модели с акриловой смолой горячего отверждения. В описании метода указана 21 проба для каждой группы; регистрировали усилие и место разрушения.',
      'В опубликованном резюме не сообщается о значимом различии средней прочности соединения между тремя группами. Выводы ограничены образцами и методом испытания, использованными в этом исследовании.',
    ],
  },
  'research-39':{
    en:[
      'This report examines the wear rate during the steady phase of the test and compares different acrylic tooth groups using statistical analysis.',
      'Some numerical results in the source use an older notation. Specialist use of those values requires consulting the original version and reviewing the complete study method.',
    ],
    tr:[
      'Bu rapor, testin kararlı evresindeki aşınma hızını ele alır ve farklı akrilik diş gruplarını istatistiksel analizle karşılaştırır.',
      'Kaynakta bazı sayısal sonuçlar eski bir yazım biçimiyle verilmiştir. Bu değerleri uzmanlık çalışmalarında kullanmak için özgün sürüme başvurmak ve çalışmanın yöntemini bütünüyle incelemek gerekir.',
    ],
    ar:[
      'يتناول هذا التقرير معدل التآكل خلال المرحلة المستقرة من الاختبار، ويقارن مجموعات مختلفة من الأسنان الأكريليكية باستخدام التحليل الإحصائي.',
      'ترد بعض النتائج الرقمية في المصدر بصيغة تدوين قديمة. ويتطلب الاستخدام التخصصي لهذه القيم الرجوع إلى النسخة الأصلية ومراجعة طريقة الدراسة كاملة.',
    ],
    ru:[
      'В этом отчёте рассматривается скорость износа на установившейся стадии испытания и проводится статистическое сравнение разных групп акриловых зубов.',
      'Часть числовых результатов в источнике приведена в старой форме записи. Для профессионального использования этих значений необходимо обратиться к оригинальной версии и изучить методику исследования полностью.',
    ],
  },
  'research-40':{
    en:[
      'The archived article compares two light-cured composites in a shear bond test to dentin. It mentions parametric and nonparametric statistical tests for assessing differences in the results.',
      'The source summary reports no statistically significant difference. This historical report does not confirm the performance of every current formulation or generation of these products.',
    ],
    tr:[
      'Arşivdeki yazı, ışıkla polimerize olan iki kompoziti dentine makaslama bağlantısı testinde karşılaştırır. Sonuçlar arasındaki farkları değerlendirmek için parametrik ve parametrik olmayan istatistiksel testlerden söz edilir.',
      'Kaynak özeti istatistiksel olarak anlamlı bir fark bildirmez. Bu tarihsel rapor, söz konusu ürünlerin güncel tüm formülasyonlarının veya nesillerinin performansını doğrulamaz.',
    ],
    ar:[
      'يقارن المقال المؤرشف مادتين من الكومبوزيت المعالج ضوئيًا في اختبار قوة الارتباط القصي بالعاج. ويذكر اختبارات إحصائية معلمية وغير معلمية لتقييم الفروق بين النتائج.',
      'لا يذكر ملخص المصدر فرقًا ذا دلالة إحصائية. ولا يؤكد هذا التقرير التاريخي أداء جميع التركيبات أو الأجيال الحالية لهذه المنتجات.',
    ],
    ru:[
      'Архивная статья сравнивает два светоотверждаемых композита в испытании прочности соединения с дентином на сдвиг. Для оценки различий результатов упоминаются параметрические и непараметрические статистические тесты.',
      'В резюме источника не сообщается о статистически значимом различии. Этот исторический отчёт не подтверждает характеристики всех современных составов или поколений данных продуктов.',
    ],
  },
  'research-41':{
    en:[
      'This entry focuses on the stage of wear at which its rate becomes steady. Specimen weight loss measured at several stages formed the basis for calculating the wear rate.',
      'The comparison includes Majordent, Myerson, Berelian and Ivoclar groups. The reported statistical relationships can be consulted on the original study page.',
    ],
    tr:[
      'Bu yazı, aşınma hızının kararlı hâle geldiği evreye odaklanır. Aşınma hızının hesaplanmasında, örneklerin birkaç aşamada ölçülen ağırlık kaybı esas alınmıştır.',
      'Karşılaştırmada Majordent, Myerson, Berelian ve Ivoclar grupları yer alır. Bildirilen istatistiksel ilişkiler, çalışmanın özgün sayfasında incelenebilir.',
    ],
    ar:[
      'يركز هذا المدخل على مرحلة التآكل التي يصبح فيها المعدل مستقرًا. واستند حساب معدل التآكل إلى فقدان وزن العينات المقاس على عدة مراحل.',
      'تشمل المقارنة مجموعات ماجوردنت ومايرسون وبريليان وإيفوكلار. ويمكن الاطلاع على العلاقات الإحصائية المبلغ عنها في الصفحة الأصلية للدراسة.',
    ],
    ru:[
      'Эта публикация посвящена стадии износа, на которой его скорость становится постоянной. Основой расчёта служила потеря массы образцов, измеренная на нескольких этапах.',
      'В сравнение включены группы Majordent, Myerson, Berelian и Ivoclar. С опубликованными статистическими соотношениями можно ознакомиться на исходной странице исследования.',
    ],
  },
  'research-42':{
    en:[
      'This study uses weight changes after abrasive contact to compare two Iranian models with Ivoclar. The archived text reports several measurement stages.',
      'The web version contains repeated passages and differing figures in parts of the methods and results. This summary does not restate those figures as definitive data.',
    ],
    tr:[
      'Bu çalışma, iki İran modelini Ivoclar ile karşılaştırmak için aşındırıcı temas sonrasındaki ağırlık değişimlerini kullanır. Arşiv metninde birkaç ölçüm aşaması bildirilmiştir.',
      'Web sürümünün yöntem ve sonuç bölümlerinde bazı tekrarlar ve farklı sayılar bulunur. Bu özet, söz konusu sayıları kesin veriler olarak yeniden aktarmamaktadır.',
    ],
    ar:[
      'تستخدم هذه الدراسة تغير الوزن بعد التلامس الكاشط لمقارنة طرازين إيرانيين بإيفوكلار. ويورد النص المؤرشف عدة مراحل للقياس.',
      'تحتوي نسخة الويب على مقاطع مكررة وأرقام مختلفة في أجزاء من الطريقة والنتائج. ولا يعيد هذا الملخص عرض تلك الأرقام بوصفها بيانات مؤكدة.',
    ],
    ru:[
      'В исследовании используют изменение массы после абразивного контакта для сравнения двух иранских моделей с Ivoclar. В архивном тексте описаны несколько этапов измерений.',
      'В веб-версии отдельные части описания методов и результатов содержат повторяющиеся фрагменты и различающиеся числа. В этом резюме такие числа не воспроизводятся как достоверно установленные данные.',
    ],
  },
  'research-20':{
    en:[
      'The report covers six tooth types and a laboratory method using an abrasive disc in artificial saliva. Specimen weights were recorded before and after the test stages to determine the wear rate.',
      'The analysis focuses on specimen behaviour during the steady phase of wear. This study overlaps with another archive entry about the same six groups and is retained as a separate entry from the original site.',
    ],
    tr:[
      'Rapor, altı diş türünü ve yapay tükürük ortamında aşındırıcı disk kullanılan bir laboratuvar yöntemini kapsar. Aşınma hızını belirlemek için örneklerin ağırlıkları test aşamalarından önce ve sonra kaydedilmiştir.',
      'Analiz, örneklerin kararlı aşınma evresindeki davranışına odaklanır. Bu çalışma, arşivde aynı altı grup hakkındaki başka bir yazıyla örtüşür ve özgün siteden ayrı bir kayıt olarak korunmuştur.',
    ],
    ar:[
      'يشمل التقرير ستة أنواع من الأسنان وطريقة مخبرية تستخدم قرصًا كاشطًا في وسط من اللعاب الاصطناعي. وسُجلت أوزان العينات قبل مراحل الاختبار وبعدها لتحديد معدل التآكل.',
      'يركز التحليل على سلوك العينات خلال مرحلة التآكل المستقرة. وتتداخل هذه الدراسة مع مدخل آخر في الأرشيف عن المجموعات الست نفسها، وقد حُفظت كمدخل مستقل من الموقع الأصلي.',
    ],
    ru:[
      'Отчёт охватывает шесть типов зубов и лабораторную методику с абразивным диском в среде искусственной слюны. Для определения скорости износа массу образцов регистрировали до и после этапов испытания.',
      'Анализ сосредоточен на поведении образцов на установившейся стадии износа. Исследование частично совпадает с другой архивной публикацией о тех же шести группах и сохранено как отдельный материал исходного сайта.',
    ],
  },
  'research-19':{
    en:[
      'In this study, specimens of Apple, Super Major and natural teeth were assigned to test groups. Volume changes were assessed by comparing scans taken before and after use of a chewing simulator.',
      'The source gives a total of 64 specimens. The results and test details must be read together with the experimental conditions, and their application requires specialist assessment.',
    ],
    tr:[
      'Bu araştırmada Apple, Super Major ve doğal diş örnekleri test gruplarına ayrılmıştır. Hacim değişiklikleri, çiğneme simülatörü kullanımından önce ve sonra alınan taramalar karşılaştırılarak değerlendirilmiştir.',
      'Kaynak, toplam örnek sayısını 64 olarak belirtir. Sonuçlar ve test ayrıntıları deney koşullarıyla birlikte incelenmelidir; bunların uygulanması uzman değerlendirmesi gerektirir.',
    ],
    ar:[
      'وُزعت عينات أسنان آبل وسوبر ماجور والأسنان الطبيعية على مجموعات الاختبار في هذه الدراسة. وقُيم تغير الحجم بمقارنة المسوحات المأخوذة قبل استخدام محاكي المضغ وبعده.',
      'يذكر المصدر أن العدد الإجمالي للعينات هو 64. وينبغي قراءة النتائج وتفاصيل الاختبار مع الظروف التجريبية، ويتطلب تطبيقها تقييمًا تخصصيًا.',
    ],
    ru:[
      'В этом исследовании образцы зубов Apple, Super Major и естественных зубов распределили по испытательным группам. Изменения объёма оценивали сравнением сканов, выполненных до и после работы жевательного симулятора.',
      'В источнике указано общее число образцов — 64. Результаты и детали испытания следует рассматривать вместе с условиями эксперимента; их применение требует оценки специалиста.',
    ],
  },
  'research-18':{
    en:[
      'The official entry presents research from the academic year 1380–1381, as dated in the source, in which premolar teeth were examined in two groups. Each group was prepared with its own composite and bonding system.',
      'A shear bond test was performed after preparation and thermal cycling. According to the web summary, no statistically significant difference was reported between the two groups.',
    ],
    tr:[
      'Resmî yazı, kaynakta 1380–1381 akademik yılı olarak tarihlenen ve premolar dişlerin iki grupta incelendiği bir araştırmayı tanıtır. Her grup, kendisine ait kompozit ve bağlantı sistemiyle hazırlanmıştır.',
      'Hazırlık ve termal döngülerin ardından makaslama bağlantısı testi yapılmıştır. Web özetine göre iki grup arasında istatistiksel olarak anlamlı bir fark bildirilmemiştir.',
    ],
    ar:[
      'يعرض المدخل الرسمي بحثًا يعود إلى العام الدراسي 1380–1381 بحسب التاريخ الوارد في المصدر، وفُحصت فيه أسنان ضواحك ضمن مجموعتين. وحُضرت كل مجموعة باستخدام الكومبوزيت ونظام الربط الخاصين بها.',
      'أُجري اختبار قوة الارتباط القصي بعد التحضير والتدوير الحراري. وبحسب ملخص الويب، لم يُبلغ عن فرق ذي دلالة إحصائية بين المجموعتين.',
    ],
    ru:[
      'Официальная публикация представляет исследование за 1380–1381 учебный год по датировке источника, в котором премоляры изучали в двух группах. Каждую группу подготовили с использованием соответствующего композита и системы соединения.',
      'После подготовки и термоциклирования провели испытание прочности соединения на сдвиг. Согласно веб-резюме, статистически значимого различия между двумя группами не выявлено.',
    ],
  },
  'research-17':{
    en:[
      'The described method is based on weighing specimens in contact with an alumina disc and artificial saliva. The wear rate was calculated from the steady phase of specimen behaviour.',
      'The source title names four tooth types, whereas its conclusion lists more names. This inconsistency is retained and identified in the source account rather than corrected without supporting evidence.',
    ],
    tr:[
      'Açıklanan yöntem, alümina disk ve yapay tükürükle temas eden örneklerin ağırlığının ölçülmesine dayanır. Aşınma hızı, örnek davranışının kararlı evresinden hesaplanmıştır.',
      'Kaynak başlığı dört diş türünden söz ederken sonuç bölümü daha fazla ad sıralar. Bu tutarsızlık, belgeye dayanmayan bir düzeltme yapılmadan kaynak anlatımında korunmuş ve belirtilmiştir.',
    ],
    ar:[
      'تستند الطريقة الموصوفة إلى قياس وزن العينات عند ملامستها قرصًا من الألومينا واللعاب الاصطناعي. وحُسب معدل التآكل من المرحلة المستقرة لسلوك العينات.',
      'يذكر عنوان المصدر أربعة أنواع من الأسنان، بينما تسرد الخاتمة أسماء أكثر. وقد حُفظ هذا التناقض ووُضح في عرض المصدر بدلًا من تصحيحه دون سند.',
    ],
    ru:[
      'Описанная методика основана на измерении массы образцов при контакте с диском из оксида алюминия и искусственной слюной. Скорость износа рассчитывали по установившейся стадии поведения образцов.',
      'В заголовке источника названы четыре типа зубов, а в заключении приведено больше наименований. Это несоответствие сохранено и отмечено в изложении источника, без исправления, не подкреплённого документами.',
    ],
  },
};
