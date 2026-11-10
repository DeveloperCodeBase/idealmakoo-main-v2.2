import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';

const {publicLocaleDestination,publicationLocaleSibling,localePublications}=await loadTs('src/lib/publication-locales.ts');
const {products,articles}=await loadTs('src/data/catalog.ts');
const row=(locale,overrides={})=>({id:'release-one',kind:'news',slug:'opening',locale,...overrides});

test('released record translations follow their identity when their public slugs differ',()=>{
  const en=row('en'),fa=row('fa',{slug:'ef-tetah'}),site={publications:[en,fa]};
  assert.equal(publicationLocaleSibling(site.publications,en,'fa'),fa);
  assert.equal(publicLocaleDestination(site,'fa','/en/news/opening/?ref=two%2Fone#details'),'/fa/news/ef-tetah/?ref=two%2Fone#details');
  assert.equal(publicLocaleDestination(site,'en','/fa/news/ef-tetah/'),'/en/news/opening/');
  assert.equal(publicLocaleDestination(site,'tr','/en/news/opening/'),null);
});

test('independent page translation IDs use the shared stable path, never an unrelated kind',()=>{
  const source=row('fa',{id:'page-fa',kind:'page',slug:'laboratory-protocol'});
  const translated=row('en',{id:'page-en',kind:'page',slug:source.slug});
  const unrelated=row('ar',{id:'page-fa',kind:'news',slug:source.slug});
  const site={publications:[source,translated,unrelated]};
  assert.equal(publicationLocaleSibling(site.publications,source,'en'),translated);
  assert.equal(publicationLocaleSibling(site.publications,source,'ar'),undefined);
  assert.equal(publicLocaleDestination(site,'en','/fa/laboratory-protocol/'),'/en/laboratory-protocol/');
  assert.equal(publicLocaleDestination(site,'ar','/fa/laboratory-protocol/'),null);
});

test('a reviewed source rename falls back only to the existing original language source and respects withdrawals',()=>{
  for(const [source,kind,prefix,hiddenKey]of [[products[0],'product','products','hiddenProductLocales'],[articles[0],'research','research','hiddenArticleLocales']]){
    const en=row('en',{id:source.id,kind,slug:'reviewed-english'}),fa=row('fa',{id:source.id,kind,slug:'reviewed-persian'});
    const original=`${prefix}/${source.slug}`;
    assert.equal(publicLocaleDestination({publications:[en]},'fa','/en/'+prefix+'/reviewed-english/'),'/fa/'+original+'/');
    assert.equal(publicLocaleDestination({publications:[en,fa]},'fa','/en/'+original+'/'),'/fa/'+prefix+'/reviewed-persian/');
    assert.equal(publicLocaleDestination({publications:[en,fa],[hiddenKey]:{[source.id]:['fa']}},'fa','/en/'+prefix+'/reviewed-english/'),null);
  }
});

test('hidden target paths do not become language destinations and private routes keep their opaque URL',()=>{
  const site={publications:[row('en'),row('ar')],hiddenPageLocales:{'news/opening':['ar']}};
  assert.equal(publicLocaleDestination(site,'ar','/en/news/opening/'),null);
  for(const path of ['account/requests/detail','auth/reset','admin/pages','saved-share/opaque-token','communication-verification/opaque-token']){
    assert.equal(publicLocaleDestination(site,'ru',`/en/${path}/?token=one%2Ftwo#section`),`/ru/${path}/?token=one%2Ftwo#section`);
  }
  assert.equal(publicLocaleDestination(site,'en','/en/news/%broken/'),null);
});

test('malformed public locale metadata cannot become a navigation path',()=>{
  const valid=row('fa');
  const invalid=[null,[],{},row('xx'),row('en',{slug:'../auth'}),row('en',{slug:'safe/%2e%2e/auth'}),row('en',{slug:'safe?token=bad'}),row('en',{slug:'safe\\auth'})];
  assert.deepEqual(localePublications([valid,...invalid]),[valid]);
  assert.deepEqual(localePublications({publications:[valid]}),[]);
});
