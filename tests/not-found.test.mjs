import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';

const {notFoundLocale,notFoundMetadata,notFoundDescriptions}=await loadTs('src/lib/not-found.ts');
for(const locale of ['fa','en','tr','ar','ru'])test(`missing page keeps ${locale} language and non-indexable metadata`,()=>{
  assert.equal(notFoundLocale(`/${locale}/missing/`),locale);
  assert.equal(notFoundLocale(`/%${locale.charCodeAt(0).toString(16)}${locale.slice(1)}/missing/`),locale);
  const metadata=notFoundMetadata(locale);
  assert.ok(metadata.title.absolute.length>10);
  assert.equal(metadata.description,notFoundDescriptions[locale]);
  assert.deepEqual(JSON.parse(JSON.stringify(metadata.robots)),{index:false,follow:false,noarchive:true});
  assert.equal(metadata.referrer,'no-referrer');
  assert.equal(metadata.alternates,undefined);
});
test('unknown, embedded and malformed locale segments cannot choose a foreign error-page language',()=>{
  for(const path of [null,undefined,'','/','/english/','//en/missing/','/EN/missing/','/missing/en/','/en%2fmissing/','https://example.test/en/'])assert.equal(notFoundLocale(path),'fa');
});
