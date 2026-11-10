import { products, type Product, type Localized, type ContentLocale } from '@/data/catalog';
export { localizedPath } from '@/lib/locale-routing';

export type CustomProduct = Product & { origin: 'editor' };
const locales: ContentLocale[] = ['fa','en','tr','ar','ru'];
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export const isCustomProductId = (id: string) => typeof id === 'string' && id.length <= 100 && /^custom-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id);
const text = (value: unknown, max = 20000): value is string => typeof value === 'string' && value.length <= max;
function localized(value: unknown): value is Localized { return object(value) && locales.every(locale => text(value[locale])); }
function safeUrl(value: unknown, optional = false): value is string {
  if (!text(value,4000)) return false;
  if (!value) return optional;
  if (/[\u0000-\u0020\\]/.test(value)) return false;
  if (/^\/(?![\/\\])/.test(value) && !/[\u0000-\u0020\\]/.test(value)) return !value.split(/[?#]/)[0].split('/').includes('..');
  try { const url = new URL(value); return ['https:','http:'].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}

/** A manual definition is never inserted into the immutable official catalogue.
 * Only a reviewed publication makes it available to public catalogue consumers. */
export function parseCustomProduct(value: unknown): CustomProduct | null {
  if (!object(value) || value.origin !== 'editor' || typeof value.id !== 'string' || !isCustomProductId(value.id) || products.some(product => product.id === value.id)) return null;
  if (!text(value.slug,180) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) || !text(value.brand,160) || !value.brand.trim() || typeof value.family !== 'string' || !['teeth','materials'].includes(value.family)) return null;
  if (!localized(value.name) || !localized(value.description) || !localized(value.material) || !locales.some(locale => value.name && (value.name as Localized)[locale].trim())) return null;
  if (!safeUrl(value.image) || !safeUrl(value.sourceUrl,true) || !Array.isArray(value.gallery) || value.gallery.length > 60 || !value.gallery.every(url => safeUrl(url))) return null;
  if (!Array.isArray(value.features) || value.features.length > 40 || !value.features.every(localized)) return null;
  if (!Array.isArray(value.specs) || value.specs.length > 200 || !value.specs.every(row => object(row) && localized(row.label) && localized(row.value))) return null;
  if (!Array.isArray(value.downloads) || value.downloads.length > 200 || !value.downloads.every(row => object(row) && localized(row.label) && safeUrl(row.url) && safeUrl(row.sourceUrl,true))) return null;
  const copy = (source: Localized): Localized => Object.fromEntries(locales.map(locale => [locale,source[locale]])) as Localized;
  return {origin:'editor',id:value.id,slug:value.slug,brand:value.brand,family:value.family as Product['family'],name:copy(value.name),description:copy(value.description),material:copy(value.material),image:value.image,sourceUrl:value.sourceUrl,gallery:[...value.gallery],features:value.features.map(copy),specs:value.specs.map(row=>({label:copy(row.label),value:copy(row.value)})),downloads:value.downloads.map(row=>({label:copy(row.label),url:row.url,sourceUrl:row.sourceUrl}))};
}

export function createCustomProduct(input: {id:string;slug:string;brand:string;family:Product['family'];title:string;locale:ContentLocale;sourceUrl?:string}): CustomProduct {
  const blank = () => Object.fromEntries(locales.map(locale => [locale,''])) as Localized;
  const name = blank(); name[input.locale] = input.title.trim();
  const definition = parseCustomProduct({origin:'editor',id:input.id,slug:input.slug.trim(),brand:input.brand.trim(),family:input.family,name,description:blank(),material:blank(),sourceUrl:input.sourceUrl?.trim() || '',image:'/media/brand/product-placeholder.svg',gallery:[],features:[],specs:[],downloads:[]});
  if (!definition) throw new Error('Invalid custom product definition');
  return definition;
}

export function workspaceProducts(records: readonly {collection:string;details?:Record<string,unknown>}[]): Product[] {
  const custom = new Map<string,CustomProduct>();
  for (const record of records) {
    if (record.collection !== 'products') continue;
    const definition = parseCustomProduct(record.details?.customProduct);
    if (definition && !custom.has(definition.id)) custom.set(definition.id,definition);
  }
  return [...products,...custom.values()];
}

/** Production links follow the reviewed slug. The explicit static demo retains
 * its prebuilt paths and query-addressable custom-product fallback. */
export function productPath(product: {id:string;slug:string}): string {
  const staticDemo=process.env.NODE_ENV!=='production'&&process.env.NEXT_PUBLIC_DEMO_MODE==='true';
  if(!staticDemo&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(product.slug))return `products/${product.slug}`;
  const canonical = products.find(item => item.id === product.id);
  return canonical ? `products/${canonical.slug}` : `products/detail/?id=${encodeURIComponent(product.id)}`;
}
