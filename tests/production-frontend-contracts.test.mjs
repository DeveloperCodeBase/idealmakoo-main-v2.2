import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';

const {safeAccountReturn,withAccountReturn}=await loadTs('src/lib/account-return.ts');
const {parseRichText}=await loadTs('src/lib/rich-text.ts');
const {safeAiLink}=await loadTs('src/lib/ai-links.ts');
const token='v'.repeat(43);

test('account invitations and verification retain only validated same-locale account destinations',()=>{
 for(const locale of ['fa','en','tr','ar','ru']){
  const path=`/${locale}/account/organizations/?invite=${token}`;
  assert.equal(safeAccountReturn(path,locale),path);
  assert.equal(safeAccountReturn(`/${locale}/account/security?verify=${token}`,locale),`/${locale}/account/security/?verify=${token}`);
  assert.equal(withAccountReturn(`/${locale}/auth/login/`,path),`/${locale}/auth/login/?returnTo=${encodeURIComponent(path)}`);
 }
 for(const path of ['https://evil.test/en/account/','//evil.test/en/account/','/en/account/../admin','/en/account/%2e%2e/admin','/en/account/organizations/?invite=x','/en/account/organizations/?invite='+token+'&invite='+token,'/en/account/profile/?next=https://evil.test','/en/account/organizations/#'+token,'/en/account/organizations/\\evil','/fa/account/organizations/?invite='+token])assert.equal(safeAccountReturn(path,'en'),'');
});

test('editorial Markdown keeps headings, lists, quotes, tables and fenced code as text tokens',()=>{
 const parsed=parseRichText('## Scientific article\nA **reviewed** introduction with *emphasis*.\n\n- First\n- Second\n\n1. Step one\n2. Step two\n\n> Quoted text\n> Second line\n\n| Property | Value |\n| --- | --- |\n| Material | PMMA |\n\n```html\n<script>alert(1)</script>\n```');
 assert.deepEqual(parsed.map(block=>block.type),['heading','paragraph','list','list','quote','table','code']);
 assert.deepEqual(parsed[5],{type:'table',head:['Property','Value'],rows:[['Material','PMMA']]});
 assert.deepEqual(parsed[6],{type:'code',language:'html',text:'<script>alert(1)</script>'});
 assert.equal(parsed[3].ordered,true);
 assert.equal(parseRichText('<iframe src="https://evil.test"></iframe>')[0].type,'paragraph');
 for(const unsafe of ['javascript:alert(1)','data:text/html,test','//evil.test','https://user:pass@evil.test'])assert.equal(safeAiLink(unsafe,'fa'),'');
 assert.equal(safeAiLink('/fa/custom-article/','en'),'/en/custom-article/');
});

test('unterminated code, RTL prose and escaped table separators preserve all authored text',()=>{
 const rtl='این متن کامل فارسی است؛ هر نسخه باید حفظ شود.';
 assert.deepEqual(parseRichText(rtl),[{type:'paragraph',text:rtl}]);
 assert.deepEqual(parseRichText('```js\nlet first = 1;\nlet second = 2;'),[{type:'code',language:'js',text:'let first = 1;\nlet second = 2;'}]);
 assert.deepEqual(parseRichText('| Name | Value |\n| --- | --- |\n| A \\| B | 2 |')[0].rows,[['A | B','2']]);
});
