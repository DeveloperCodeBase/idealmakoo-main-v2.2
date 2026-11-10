import test from "node:test";
import assert from "node:assert/strict";
import { loadTs } from "./helpers/load-ts.mjs";

const {
  createDefaultSitePreferences, normalizeMenuPath, siteMenuHref, visibleMenuGroups,
  parseSitePreferences, validateSitePreferences, scopeSitePreferences,
  saveSitePreferencesDraft, readSitePreferencesDraft, applySitePreferences,
  SITE_PREFERENCES_KEY, MAX_MENU_GROUPS, MAX_MENU_ITEMS, normalizeLogoSource,
} = await loadTs("src/lib/site-preferences.ts");
const { company, products } = await loadTs("src/data/catalog.ts");
const { locales } = await loadTs("src/lib/i18n.ts");

function localPreview(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map();
  const window = new EventTarget();
  window.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "window", previous); else delete globalThis.window; });
  return window;
}

test("site defaults preserve the verified factory identity and contact details without inventing email", () => {
  const preferences = createDefaultSitePreferences();
  assert.deepEqual(preferences.brand.name, company.name);
  assert.deepEqual(preferences.contact.address, company.address);
  assert.equal(preferences.contact.phone, company.phones[0]);
  assert.equal(preferences.contact.email, "");
  assert.deepEqual(validateSitePreferences(preferences), []);
  preferences.brand.name.fa = "Edited preview";
  assert.notEqual(company.name.fa, "Edited preview", "editing a draft cannot mutate the factory source");
});

test("every default menu label exists in all five languages and every destination is declared", () => {
  const preferences = createDefaultSitePreferences();
  for (const group of [...preferences.navigation, ...preferences.footer]) {
    for (const locale of locales) assert.ok(group.label[locale]?.trim());
    for (const item of group.items) {
      assert.equal(normalizeMenuPath(item.path), item.path);
      for (const locale of locales) assert.ok(item.label[locale]?.trim());
    }
  }
});

test("menu route normalization removes a supplied language and keeps a real product destination", () => {
  for (const locale of locales) {
    assert.equal(normalizeMenuPath(`/${locale}/products/${products[0].slug}/`), `products/${products[0].slug}`);
    assert.equal(normalizeMenuPath(`/${locale}/`), "");
  }
  assert.equal(normalizeMenuPath(" /products/ "), "products");
  assert.equal(normalizeMenuPath("/"), "");
});

test("custom page and public detail IDs remain canonical when switching language", () => {
  assert.equal(normalizeMenuPath("/fa/page/?id=PAGE-2026_A"), "page?id=PAGE-2026_A");
  assert.equal(normalizeMenuPath("/en/news/detail/?id=NEWS-12"), "news/detail?id=NEWS-12");
  assert.equal(siteMenuHref("/fa/page/?id=PAGE-2026_A", "ru"), "/ru/page/?id=PAGE-2026_A");
  assert.equal(siteMenuHref("/en/products/", "ar"), "/ar/products/");
  assert.equal(siteMenuHref("/", "tr"), "/tr/");
});

test("navigation rejects external, private, traversal and ambiguous query routes", () => {
  const rejected = [
    "https://example.test/", "javascript:alert(1)", "//example.test/path", "data:text/html,hi",
    "admin", "/fa/admin/menus/", "auth/login", "account/requests", "/en/account/",
    "products/../contact", "products/%2e%2e/contact", "\\contact", "contact#x",
    "products?x=1", "page?id=a&id=b", "page?ref=a", "page?id=", "page?id=../x", "page?id=a?x=b",
  ];
  for (const path of rejected) assert.equal(normalizeMenuPath(path), null, path);
});

test("the displayed menu respects reordering, visibility and valid links without mutating the editor draft", () => {
  const preferences = createDefaultSitePreferences();
  const groups = [preferences.navigation[2], preferences.navigation[0], preferences.navigation[1]];
  groups[0].items.reverse();
  groups[0].items[1].visible = false;
  groups[1].visible = false;
  groups[2].items[0].path = "javascript:alert(1)";
  const before = structuredClone(groups);
  const visible = visibleMenuGroups(groups);
  assert.deepEqual(visible.map(group => group.id), ["company", "research"]);
  assert.equal(visible[0].items[0].path, "careers");
  assert.equal(visible[0].items.length, groups[0].items.length - 1);
  assert.equal(visible[1].items.length, groups[2].items.length - 1);
  assert.deepEqual(groups, before);
});

test("hidden and empty groups disappear from the public menu", () => {
  const groups = createDefaultSitePreferences().navigation;
  groups[0].visible = false;
  groups[1].items = [];
  groups[2].items.forEach(item => { item.visible = false; });
  assert.deepEqual(visibleMenuGroups(groups).map(group => group.id), ["cooperation"]);
});

test("malformed saved preferences fall back to source identity and remove unsafe links", () => {
  const draft = createDefaultSitePreferences();
  draft.brand.name = { fa: "Incomplete" };
  draft.contact.phone = "-------";
  draft.contact.email = "mail@example.test?subject=unexpected";
  draft.navigation[0].items[0].path = "//example.test";
  draft.navigation[0].items[1].path = "/ru/contact/";
  draft.navigation.push(structuredClone(draft.navigation[0]));
  const parsed = parseSitePreferences(draft);
  assert.deepEqual(parsed.brand.name, company.name);
  assert.equal(parsed.contact.phone, company.phones[0]);
  assert.equal(parsed.contact.email, "");
  assert.equal(parsed.navigation.length, 4, "duplicate group IDs cannot duplicate rendered menus");
  assert.equal(parsed.navigation[0].items[0].path, "contact");
  assert.equal(parsed.navigation[0].items.length, 5);
  assert.deepEqual(parseSitePreferences({ version: 999 }), createDefaultSitePreferences());
});

test("validation detects incomplete translations, invalid contact information and oversized menus", () => {
  const draft = createDefaultSitePreferences();
  draft.navigation[0].label.ru = "";
  draft.contact.phone = "---------";
  draft.contact.email = "not-an-email";
  draft.navigation[0].items[0].path = "admin";
  draft.navigation[0].items = Array.from({ length: MAX_MENU_ITEMS + 1 }, () => structuredClone(draft.navigation[0].items[0]));
  draft.footer = Array.from({ length: MAX_MENU_GROUPS + 1 }, () => structuredClone(draft.footer[0]));
  assert.deepEqual(new Set(validateSitePreferences(draft)), new Set(["labels", "phone", "email", "route", "limit"]));
});

test("the menus editor applies menus only and the brand editor preserves applied navigation", () => {
  const applied = createDefaultSitePreferences();
  const draft = structuredClone(applied);
  draft.brand.name.fa = "Pending brand edit";
  draft.contact.phone = "+98 21 8889 9776";
  draft.navigation.reverse();
  draft.footer[0].visible = false;
  const menus = scopeSitePreferences(draft, applied, "menus");
  assert.deepEqual(menus.brand, applied.brand);
  assert.deepEqual(menus.contact, applied.contact);
  assert.deepEqual(menus.navigation, draft.navigation);
  const settings = scopeSitePreferences(draft, applied, "settings");
  assert.deepEqual(settings.brand, draft.brand);
  assert.deepEqual(settings.contact, draft.contact);
  assert.deepEqual(settings.navigation, applied.navigation);
  assert.deepEqual(settings.footer, applied.footer);
});

test("saving a draft persists it without changing the public preview", async t => {
  const window = localPreview(t);
  const applied = await applySitePreferences(createDefaultSitePreferences());
  const previous = window.localStorage.getItem(SITE_PREFERENCES_KEY);
  const draft = structuredClone(applied);
  draft.brand.name.fa = "Local preview edit";
  assert.equal(await saveSitePreferencesDraft(draft), true);
  assert.equal(readSitePreferencesDraft().brand.name.fa, draft.brand.name.fa);
  assert.equal(window.localStorage.getItem(SITE_PREFERENCES_KEY), previous);
});

test("applying a valid edit persists canonical public preferences and emits a live update", async t => {
  const window = localPreview(t);
  let updates = 0;
  window.addEventListener("idealmakoo:site-preferences", () => { updates++; });
  const draft = createDefaultSitePreferences();
  draft.navigation[0].items[0].path = "/fa/contact/";
  draft.navigation.reverse();
  draft.brand.tagline.en = "Edited local introduction";
  const applied = await applySitePreferences(draft);
  assert.ok(applied?.updatedAt);
  assert.equal(updates, 1);
  const stored = JSON.parse(window.localStorage.getItem(SITE_PREFERENCES_KEY));
  assert.equal(stored.navigation[3].items[0].path, "contact");
  assert.equal(stored.brand.tagline.en, "Edited local introduction");
  assert.deepEqual(stored, applied);
  assert.equal(draft.navigation[3].items[0].path, "/fa/contact/", "applying cannot mutate the draft object");
});

test("an invalid apply is atomic and restoring source defaults is an explicit valid apply", async t => {
  const window = localPreview(t);
  const custom = createDefaultSitePreferences();
  custom.navigation = [];
  custom.contact.phone = "+98 21 8890 6776";
  assert.ok(await applySitePreferences(custom));
  const before = window.localStorage.getItem(SITE_PREFERENCES_KEY);
  custom.contact.phone = "invalid";
  assert.equal(await applySitePreferences(custom), null);
  assert.equal(window.localStorage.getItem(SITE_PREFERENCES_KEY), before);
  const reset = await applySitePreferences(createDefaultSitePreferences());
  assert.deepEqual(reset.contact.address, company.address);
  assert.equal(reset.contact.phone, company.phones[0]);
  assert.equal(reset.navigation.length, 4);
});


test("brand logo upgrades old preferences without losing edited contact data", () => {
  const legacy = createDefaultSitePreferences();
  delete legacy.brand.logo;
  legacy.brand.name.fa = "نام ویرایش‌شده";
  const upgraded = parseSitePreferences(legacy);
  assert.equal(upgraded.brand.logo, company.logo);
  assert.equal(upgraded.brand.name.fa, legacy.brand.name.fa);
  assert.deepEqual(validateSitePreferences(upgraded), []);
});

test("logo selection accepts raster image data and local assets, rejects active or remote payloads", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=";
  assert.equal(normalizeLogoSource(png), png);
  assert.equal(normalizeLogoSource(company.logo), company.logo);
  for (const payload of ["javascript:alert(1)", "data:image/svg+xml,<svg/>", "https://example.invalid/logo.png", "/media/brand/../x.png", "/media/brand/logo.png?x=1", "data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="]) {
    assert.equal(normalizeLogoSource(payload), null, payload);
  }
  const oversized = Buffer.alloc(512 * 1024 + 1);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(oversized);
  assert.equal(normalizeLogoSource("data:image/png;base64," + oversized.toString("base64")), null);
});

test("menu-only publishing preserves the current logo while identity settings replace it", () => {
  const live = createDefaultSitePreferences();
  const draft = createDefaultSitePreferences();
  draft.brand.logo = "/media/official/logo.png";
  assert.equal(scopeSitePreferences(draft, live, "menus").brand.logo, live.brand.logo);
  assert.equal(scopeSitePreferences(draft, live, "settings").brand.logo, draft.brand.logo);
});
