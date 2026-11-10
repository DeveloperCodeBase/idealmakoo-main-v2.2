import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { loadTs } from './helpers/load-ts.mjs';

const { locales, direction } = await loadTs('src/lib/i18n.ts');
const { localeFromPath, localizedPath, rememberedLocale, entryLocalePath, applyRouteLocale, LOCALE_STORAGE_KEY } = await loadTs('src/lib/locale-routing.ts');
const { safeAiLink } = await loadTs('src/lib/ai-links.ts');
const { createHomeBlocks } = await loadTs('src/lib/site-content.ts');
const { DISPLAY_BOOTSTRAP_SCRIPT } = await loadTs('src/lib/display-preferences.ts');

const storage = (initial = null) => {
  const values = new Map(initial === null ? [] : [[LOCALE_STORAGE_KEY, initial]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
};

test('internal page navigation keeps the active locale, repairs copied prefixes and preserves exact query/hash values', () => {
  const suffix = '?id=custom-new&next=%2Ffa%2Faccount%2F&q=%D9%85%D8%A7%DA%A9%D9%88#sheet-2';
  for (const active of locales) for (const copied of locales) {
    assert.equal(localizedPath(active, `/${copied}/products/detail/${suffix}`), `/${active}/products/detail/${suffix}`);
    assert.equal(localizedPath(active, `${copied}/account/preferences`), `/${active}/account/preferences/`);
    assert.equal(localizedPath(active, `/${copied}`), `/${active}/`);
    assert.equal(localizedPath(active, `/${copied}/fa/en/admin/`), `/${active}/admin/`);
    assert.equal(localizedPath(active, 'research/en/materials'), `/${active}/research/en/materials/`, 'only a leading locale is replaced');
  }
});

test('locale recognition is exact and does not mistake another route or an external URL for a language', () => {
  for (const locale of locales) for (const ending of ['', '/', '/account/', '?q=1', '#top']) assert.equal(localeFromPath(`/${locale}${ending}`), locale);
  for (const path of ['/english/', '/far/', '/trash/', '/arabic/', '/ruby/', '/admin/', '/', 'https://factory.test/fa/']) assert.equal(localeFromPath(path), null);
});

test('source/download files, endpoints, external links and same-page references are never rewritten as localized pages', () => {
  const links = ['https://idealmakoo.com/fa/product', 'http://example.test/en/', '//cdn.example.test/fa/image', 'mailto:info@example.test', 'tel:+982100000000', '/media/products/item.jpg?size=large#preview', '/downloads/idealmakoo-source.zip', '/resources/catalogue.pdf#page=2', '/api/ai/status', '/_next/static/app.js', '/manifests/en.webmanifest', '/robots.txt', '/sw.js', '#idealmakoo-collections', '?page=8#sheet'];
  for (const locale of locales) for (const link of links) assert.equal(localizedPath(locale, link), link);
});

test('root and admin entry aliases retain search/hash and prefer an explicit URL over any remembered language', () => {
  for (const locale of locales) {
    assert.equal(entryLocalePath('', { pathname:'/', search:'?utm_source=site', hash:'#catalogues' }, locale), `/${locale}/?utm_source=site#catalogues`);
    assert.equal(entryLocalePath('admin/preferences', { pathname:'/admin/preferences/', search:'?tab=display', hash:'#language' }, locale), `/${locale}/admin/preferences/?tab=display#language`);
    for (const saved of locales) {
      assert.equal(entryLocalePath('admin', { pathname:`/${locale}/admin/`, search:'?id=A%2FB', hash:'#panel' }, saved), `/${locale}/admin/?id=A%2FB#panel`);
      assert.equal(entryLocalePath(`/${locale}/admin/`, { pathname:'/admin/', search:'', hash:'' }, saved), `/${locale}/admin/`);
    }
  }
});

test('another tab changing its language cannot change this tab at a root alias', () => {
  for (const current of locales) for (const elsewhere of locales) {
    const view = { sessionStorage:storage(current), localStorage:storage(elsewhere) };
    assert.equal(rememberedLocale(view), current);
    view.localStorage.setItem(LOCALE_STORAGE_KEY, elsewhere);
    assert.equal(entryLocalePath('', {pathname:'/',search:'',hash:''}, rememberedLocale(view)), `/${current}/`);
  }
});

test('unavailable or corrupt browser storage always leaves a navigable entry route', () => {
  const blocked = {get sessionStorage() {throw new Error('blocked');}, get localStorage() {throw new Error('blocked');}};
  assert.equal(rememberedLocale(blocked), 'fa');
  for (const locale of locales) assert.equal(rememberedLocale({get sessionStorage() {throw new Error('blocked');}, localStorage:storage(locale)}), locale);
  assert.equal(rememberedLocale({sessionStorage:storage('not-a-locale'),localStorage:storage('javascript:invalid')}), 'fa');
});

test('route commits and history changes mirror language/direction without reading stored account preferences', () => {
  const view = {sessionStorage:storage('fa'),localStorage:storage('ru')};
  const doc = {documentElement:{lang:'fa',dir:'rtl'},defaultView:view};
  for (const locale of ['en','ar','tr','fa','ru','ar','en']) {
    const active = localeFromPath(`/${locale}/account/`);
    applyRouteLocale(doc, active);
    assert.equal(doc.documentElement.lang, locale);
    assert.equal(doc.documentElement.dir, direction(locale));
    assert.equal(view.sessionStorage.getItem(LOCALE_STORAGE_KEY), locale);
    assert.equal(view.localStorage.getItem(LOCALE_STORAGE_KEY), locale);
  }
  const blocked = {documentElement:{},defaultView:{get sessionStorage() {throw new Error('blocked');},get localStorage() {throw new Error('blocked');}}};
  applyRouteLocale(blocked, 'ar');assert.equal(blocked.documentElement.dir, 'rtl');
});

test('first paint applies appearance preferences without replacing the locale encoded by the server', () => {
  for (const locale of locales) for (const saved of locales) {
    const document = {documentElement:{lang:locale,dir:direction(locale),dataset:{},style:{}}};
    const values = {'idealmakoo.session.v1':JSON.stringify({id:'user-a'}),'idealmakoo.user-settings.user-a.v1':JSON.stringify({version:1,ownerId:'user-a',preferences:{language:saved,theme:'light'}})};
    runInNewContext(DISPLAY_BOOTSTRAP_SCRIPT, {document,localStorage:{getItem:key=>values[key]??null},matchMedia:()=>({matches:false})});
    assert.equal(document.documentElement.lang, locale);assert.equal(document.documentElement.dir, direction(locale));assert.equal(document.documentElement.dataset.theme, 'light');
  }
});

test('copied landing-page CTA routes target the active language without modifying stored editorial content', () => {
  for (const source of locales) {
    const blocks = createHomeBlocks(source), before = structuredClone(blocks);
    for (const locale of locales) for (const block of blocks) for (const link of [block.link, block.options?.secondaryLink].filter(Boolean)) {
      if (localeFromPath(link)) assert.equal(localeFromPath(localizedPath(locale, link)), locale);
    }
    assert.deepEqual(blocks, before);
  }
});

test('assistant internal links preserve the active language for all five source prefixes and retain source files', () => {
  for (const current of locales) for (const source of locales) {
    assert.equal(safeAiLink(`/${source}/resources/?id=DOC-1#sheet-2`, current), `/${current}/resources/?id=DOC-1#sheet-2`);
    assert.equal(safeAiLink(`/${source}`, current), `/${current}/`);
  }
  for (const current of locales) {
    assert.equal(safeAiLink('/products/', current), `/${current}/products/`);
    assert.equal(safeAiLink('/media/catalogue.pdf#page=2', current), '/media/catalogue.pdf#page=2');
    assert.equal(safeAiLink('https://idealmakoo.com/fa/product', current), 'https://idealmakoo.com/fa/product');
    for (const invalid of ['javascript:alert(1)', 'data:text/html,unsafe', '//example.test', '/\\example.test', '/fa/../admin', 'https://user:password@example.test']) assert.equal(safeAiLink(invalid, current), '');
  }
});
