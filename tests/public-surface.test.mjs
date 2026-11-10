import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {createDefaultSitePreferences,parseSitePreferences,validateSitePreferences,scopeSitePreferences,visibleMenuGroups}=await loadTs('src/lib/site-preferences.ts');
const {safeFooterSource}=await loadTs('src/lib/site-preference-content.ts');
const {company}=await loadTs('src/data/catalog.ts');
const {parsePublicNoticeDefinition,parsePublishedPublicNotice,isPublicNoticeActive,publicNoticeRevisionKey,emptyNoticeLocale}=await loadTs('src/lib/public-notices.ts');
const {parsePublications}=await loadTs('src/lib/publications.ts');
const {canChangeRecord}=await loadTs('src/components/workspace/permissions.ts');
const locales=['fa','en','tr','ar','ru'];
const words=value=>Object.fromEntries(locales.map(locale=>[locale,value]));
const notice=(extra={})=>({schemaVersion:1,...emptyNoticeLocale(),startsAt:'2026-10-19T10:00:00.000Z',endsAt:'2026-10-19T11:00:00.000Z',...extra});

test('Legacy office address upgrades without inventing a factory address or changing immutable source data',()=>{
  const legacy=createDefaultSitePreferences();delete legacy.contact.officeAddress;delete legacy.contact.factoryAddress;delete legacy.footerDetails;legacy.contact.address.fa='نشانی دفتر ویرایش‌شده';
  const parsed=parseSitePreferences(legacy);assert.equal(parsed.contact.officeAddress.fa,'نشانی دفتر ویرایش‌شده');assert.deepEqual(parsed.contact.address,parsed.contact.officeAddress);assert.deepEqual(parsed.contact.factoryAddress,company.factoryLocation);assert.notEqual(company.address.fa,parsed.contact.address.fa);
  parsed.contact.factoryAddress.fa='نشانی مستقل کارخانه';assert.equal(parsed.contact.officeAddress.fa,'نشانی دفتر ویرایش‌شده');assert.notEqual(company.factoryLocation.fa,parsed.contact.factoryAddress.fa);assert.deepEqual(validateSitePreferences(parsed),[]);
});
test('Footer information is five-language mutable data and menu-only writes preserve all contact and attribution fields',()=>{
  const published=createDefaultSitePreferences(),draft=structuredClone(published);
  for(const locale of locales){draft.footerDetails.developerName[locale]='Configured '+locale;draft.contact.factoryAddress[locale]='Factory '+locale;}
  draft.footerDetails.sourceUrl='';const menus=scopeSitePreferences(draft,published,'menus');assert.deepEqual(menus.footerDetails,published.footerDetails);assert.deepEqual(menus.contact,published.contact);
  const settings=scopeSitePreferences(draft,published,'settings');assert.deepEqual(settings.footerDetails,draft.footerDetails);assert.deepEqual(settings.navigation,published.navigation);assert.deepEqual(parseSitePreferences(settings).footerDetails,settings.footerDetails);
  for(const value of['javascript:alert(1)','http://example.invalid','https://user:secret@example.invalid','https://example.invalid/#token','https://example.invalid/\nsecret'])assert.equal(safeFooterSource(value),null);
  assert.equal(safeFooterSource('https://example.invalid/about'),'https://example.invalid/about');assert.equal(safeFooterSource(''),'');
});
test('Footer and header menu projection exclude withdrawn destinations in exactly their denied locale without mutating drafts',()=>{
  const preferences=createDefaultSitePreferences(),before=structuredClone(preferences.footer),site={hiddenPageLocales:{about:['fa'],research:['fa'],resources:['fa']}};
  const persian=visibleMenuGroups(preferences.footer,site,'fa').flatMap(group=>group.items.map(item=>item.path)),english=visibleMenuGroups(preferences.footer,site,'en').flatMap(group=>group.items.map(item=>item.path));
  for(const path of['about','research','resources']){assert.equal(persian.includes(path),false);assert.equal(english.includes(path),true);}
  assert.deepEqual(preferences.footer,before);
});
test('Notice definitions reject impossible dates, reversed windows, cross-locale keys and private or executable destinations',()=>{
  const valid=notice({actionPath:'contact',actionLabel:'Contact'});assert.deepEqual(parsePublishedPublicNotice(valid),valid);
  for(const startsAt of['2026-02-30T10:00:00Z','2026-10-19T10:00','not-a-date'])assert.equal(parsePublishedPublicNotice({...valid,startsAt}),null);
  assert.equal(parsePublishedPublicNotice({...valid,endsAt:valid.startsAt}),null);
  for(const actionPath of['https://example.invalid','//example.invalid','admin','account/security','api/v1/media/id','feedback/token','communication-verification/device','saved-share/token','content-previews/token','contact?token=x','fa/contact','contact/../admin','contact#hash'])assert.equal(parsePublishedPublicNotice({...valid,actionPath}),null,actionPath);
  assert.equal(parsePublishedPublicNotice({...valid,actionLabel:''}),null);assert.equal(parsePublishedPublicNotice({...valid,hiddenSecret:'ignored?'}),null);
  assert.equal(parsePublicNoticeDefinition({schemaVersion:1,locales:{de:emptyNoticeLocale()}}),null);
  assert.deepEqual(parsePublicNoticeDefinition({schemaVersion:1,locales:{en:emptyNoticeLocale()}}),{schemaVersion:1,locales:{en:emptyNoticeLocale()}});
});
test('Notice visibility is half-open at the exact start and expiry, disabled by its published revision, with revision-specific dismissal keys',()=>{
  const value=notice();assert.equal(isPublicNoticeActive(value,Date.parse(value.startsAt)-1),false);assert.equal(isPublicNoticeActive(value,Date.parse(value.startsAt)),true);assert.equal(isPublicNoticeActive(value,Date.parse(value.endsAt)-1),true);assert.equal(isPublicNoticeActive(value,Date.parse(value.endsAt)),false);assert.equal(isPublicNoticeActive({...value,enabled:false},Date.parse(value.startsAt)),false);
  const publication={id:'notice',locale:'en',version:1,publishedAt:'2026-10-19T10:00:00Z'};assert.notEqual(publicNoticeRevisionKey(publication),publicNoticeRevisionKey({...publication,version:2}));assert.notEqual(publicNoticeRevisionKey(publication),publicNoticeRevisionKey({...publication,locale:'fa'}));
});
test('Public publication parsing retains only valid notice metadata and rejects corrupt notice-shaped news instead of treating it as ordinary news',()=>{
  const row={id:'notice',kind:'news',slug:'notice',locale:'en',title:'Public fixture',summary:'Message',publicNotice:notice(),publishedAt:'2026-10-19T10:00:00Z',version:2,details:{internal:'never public'}};
  const parsed=parsePublications([row]);assert.equal(parsed.length,1);assert.deepEqual(parsed[0].publicNotice,notice());assert.equal('details'in parsed[0],false);assert.deepEqual(parsePublications([{...row,publicNotice:{...notice(),endsAt:'bad'}}]),[]);assert.deepEqual(parsePublications([{...row,kind:'products'}]),[]);
});
test('Translation policy permits only the assigned notice language and still protects ordinary news metadata and source fields',()=>{
  const before={id:'NOTICE-1',collection:'news',title:words('Title'),summary:words('Message'),status:'draft',owner:'contentEditor',history:[],tags:[],demo:false,details:{publicNotice:{schemaVersion:1,locales:{fa:emptyNoticeLocale(),en:emptyNoticeLocale()}},privateMarker:'preserve'}};
  const actor={id:'translator',role:'translator',locale:'en',allowedLocales:['en']},after=structuredClone(before);after.details.publicNotice.locales.en={...emptyNoticeLocale(),actionPath:'contact',actionLabel:'Contact'};assert.equal(canChangeRecord(before,after,actor),true);
  after.details.publicNotice.locales.fa.enabled=false;assert.equal(canChangeRecord(before,after,actor),false);after.details.publicNotice.locales.fa.enabled=true;after.details.privateMarker='changed';assert.equal(canChangeRecord(before,after,actor),false);
});
