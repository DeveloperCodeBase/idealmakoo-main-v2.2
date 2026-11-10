import type {PageDraft} from '@/data/workspace-seed';
import {L} from '@/components/workspace/i18n';

export const taxonomyCopy={
 category:L('دسته‌بندی محتوا','Content category','İçerik kategorisi','فئة المحتوى','Категория материала'),
 hint:L('برای زیرگروه از / استفاده کنید؛ برچسب‌ها را با ویرگول جدا کنید. حداکثر ۲۰ برچسب و ۸۰ نویسه برای هر برچسب. پس از تأیید و انتشار در جست‌وجو نمایش داده می‌شود.','Use / for a subcategory and commas between tags. Up to 20 tags, 80 characters each. Changes appear in search after review and publication.','Alt kategori için /, etiketler arasında virgül kullanın. En fazla 20 etiket, her biri 80 karakter. Değişiklikler inceleme ve yayımdan sonra aramada görünür.','استخدم / للفئة الفرعية والفاصلة بين الوسوم. حتى ٢٠ وسمًا، كل منها ٨٠ حرفًا. تظهر التغييرات في البحث بعد المراجعة والنشر.','Используйте / для подкатегории и запятые между метками. До 20 меток по 80 символов. Изменения появятся в поиске после проверки и публикации.'),
 invalid:L('دسته‌بندی حداکثر ۱۲۰ نویسه و برچسب‌ها حداکثر ۲۰ موردِ ۸۰ نویسه‌ای باشند.','Use a category of at most 120 characters and up to 20 tags of 80 characters each.','Kategori en fazla 120 karakter, etiketler en fazla 20 adet ve 80 karakter olmalıdır.','حد الفئة ١٢٠ حرفًا، وحتى ٢٠ وسمًا بحد أقصى ٨٠ حرفًا لكل وسم.','Категория — до 120 символов, не более 20 меток по 80 символов.'),
};
export const splitTaxonomyTags=(value:string)=>Array.from(new Set(value.split(/[,،\n]/u).map(tag=>tag.trim()).filter(Boolean)));
export const validTaxonomy=(value:PageDraft['taxonomy'])=>!value||value.category.length<=120&&value.tags.length<=20&&value.tags.every(tag=>tag.length<=80);

