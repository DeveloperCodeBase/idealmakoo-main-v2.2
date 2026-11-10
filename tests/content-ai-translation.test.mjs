import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {maskTranslation,unmaskTranslation,splitTranslation,parseTranslationValues,translationLanguageCheck}=await loadTs('src/lib/content-ai-translation.ts');
const nonce='0123456789abcdef01234567';

test('translation preserves URLs, markup, code, template placeholders and technical values byte for byte',()=>{
 const source='## راهنما\n\nمحصول IM-42 PMMA با عدد ۱۲.۵ و 12.5: https://example.test/a?version=2\n`unsafe($value)`\n```js\nalert(1)\n```\n<a href="/en/item/">نام</a> {{customer}} ${region}\n[نام](/fa/contact/) [نام](#details) help@example.test';
 const masked=maskTranslation(source,nonce),translated=masked.text.replace(/راهنما|محصول|با عدد|و|نام/g,'Translated');
 assert.equal(masked.text.includes('https://example.test/'),false);assert.equal(masked.text.includes('alert(1)'),false);
 const result=unmaskTranslation(translated,masked);
 for(const value of Object.values(masked.tokens))assert.ok(result.includes(value));
 assert.equal(result.includes('__IM_'),false);assert.equal(result.includes('IM-42'),true);assert.ok(result.includes('۱۲.۵'));assert.ok(result.includes('${region}'));assert.ok(result.includes('PMMA'));assert.ok(result.includes('help@example.test'));assert.ok(result.includes('](/fa/contact/)'));assert.ok(result.includes('](#details)'));
});
test('a model cannot drop, duplicate, invent or alter a protected value',()=>{
 const masked=maskTranslation('Link https://example.test/path and number 25',nonce),marker=Object.keys(masked.tokens)[0];
 for(const output of[masked.text.replace(marker,''),masked.text+' '+marker,masked.text.replace(marker,marker.replace('_0__','_999__')),masked.text+' __IM_aaaaaaaaaaaaaaaaaaaaaaaa_0__'])assert.throws(()=>unmaskTranslation(output,masked));
 assert.throws(()=>maskTranslation('__IM_'+nonce+'_0__',nonce));assert.throws(()=>maskTranslation('safe','untrusted'));
});
test('long multilingual text, no-space text and marker boundaries reconstruct exactly without truncating a tail',()=>{
 for(const source of['متن طولانی برای ترجمه.\n\n'.repeat(2000)+'پایان','Text😀'.repeat(3000)+'END','x'.repeat(252)+' https://example.test/'+('a'.repeat(2000))+' '+'x'.repeat(1800),'x'.repeat(253)+' 25'+'x'.repeat(2000)]){
  const masked=maskTranslation(source,nonce),parts=splitTranslation('body',masked.text,256);
  assert.equal(parts.map(part=>part.text+part.separator).join(''),masked.text);
  assert.equal(unmaskTranslation(parts.map(part=>part.text+part.separator).join(''),masked),source);
  for(const part of parts)assert.equal(/[\uD800-\uDBFF]$/.test(part.text),false);
  for(const marker of Object.keys(masked.tokens))assert.equal(parts.filter(part=>part.text.includes(marker)).length,1,'A placeholder belongs to exactly one intact segment');
 }
});
test('provider JSON uses an exact field schema and never strips markdown fences to pretend malformed output was valid',()=>{
 assert.deepEqual(parseTranslationValues('{"body":"Text","title":"Title"}',['title','body']),{body:'Text',title:'Title'});
 for(const text of['```json\n{"title":"Title"}\n```','{"title":"Title","extra":"untrusted"}','{"title":4}','["Title"]','null','{"__proto__":{"polluted":true}}'])assert.throws(()=>parseTranslationValues(text,['title']));
 assert.equal({}.polluted,undefined);
});
test('script leakage is rejected for the target without blocking code placeholders or Latin product names',()=>{
 assert.equal(translationLanguageCheck('English نام','en'),false);assert.equal(translationLanguageCheck('Türkçe текст','tr'),false);assert.equal(translationLanguageCheck('Текст فارسی','ru'),false);assert.equal(translationLanguageCheck('متن текст','fa'),false);
 assert.equal(translationLanguageCheck('فارسی IM-42','fa'),true);assert.equal(translationLanguageCheck('English __IM_'+nonce+'_0__','en'),true);assert.equal(translationLanguageCheck('Русский Ideal Makoo','ru'),true);
});
