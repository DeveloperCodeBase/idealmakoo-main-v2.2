import type {Article,ContentLocale} from '@/data/catalog';
import {researchBodyTranslations} from '@/data/research-body-translations';

/** The retained Persian editorial source and its independently written reading copies. */
export function researchBodyForLocale(article:Pick<Article,'id'|'body'>,locale:ContentLocale):string[]{
 return locale==='fa'?article.body:researchBodyTranslations[article.id]?.[locale]??[];
}
