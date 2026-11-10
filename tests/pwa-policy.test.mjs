import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedAsset, cacheableResponse, offlinePage } from '../public/sw-policy.js';
const origin = 'https://factory.example';
test('offline cache excludes private routes, API, cross origin, query strings and non-GET requests', () => {
  for (const path of ['/admin','/api/v1/requests','/fa/account/requests','/en/auth/login','/media/resumes/cv.pdf','/media/official/catalog.jpg?token=private','https://other.example/media/official/image.jpg','/media/official/%2e%2e/private.jpg']) assert.equal(allowedAsset(path,origin),false,path);
  assert.equal(allowedAsset('/media/official/product.jpg',origin,'POST'),false);
  assert.equal(allowedAsset('/media/official/product.jpg',origin),true);
  assert.equal(allowedAsset('/fonts/Vazirmatn.woff2',origin),true);
  const icon='/media/official/idealmakoo-favicon-48.png';
  assert.equal(allowedAsset(icon,origin),true);
  for(const path of ['/icons/idealmakoo-favicon-48.png',icon+'?token=private','https://other.example'+icon])assert.equal(allowedAsset(path,origin),false,path);
  assert.equal(allowedAsset(icon,origin,'POST'),false);
});
test('explicit public cache header is required and cannot override private or no-store responses', () => {
  const response = headers => ({ok:true,type:'basic',redirected:false,headers:new Headers(headers)});
  assert.equal(cacheableResponse(response({})),false);
  assert.equal(cacheableResponse(response({'X-Public-Cache':'1'})),true);
  assert.equal(cacheableResponse(response({'X-Public-Cache':'1','Cache-Control':'private'})),false);
  assert.equal(cacheableResponse(response({'X-Public-Cache':'1','Cache-Control':'no-store'})),false);
  assert.equal(cacheableResponse({...response({'X-Public-Cache':'1'}),redirected:true}),false);
});
test('offline navigation is localized while every private, capability and managed-document URL is excluded',()=>{
  assert.equal(offlinePage('/',origin),'/offline/fa.html');
  for(const locale of ['fa','en','tr','ar','ru']){
    assert.equal(offlinePage(`/${locale}/products/`,origin),`/offline/${locale}.html`);
    assert.equal(offlinePage(`/${locale}/resources/`,origin),`/offline/${locale}.html`);
    for(const path of ['admin/','account/requests/','auth/login/','page/','published/token/','feedback/token/','saved-share/token/','communication-preferences/token/','communication-verification/device/','communication-unsubscribe/token/','resources/private-file/'])assert.equal(offlinePage(`/${locale}/${path}`,origin),null,path);
  }
  for(const path of ['/api/v1/site','/admin/','/en/products/?token=private','/en/products/%2e%2e/','https://other.example/en/','https://name:secret@factory.example/en/'])assert.equal(offlinePage(path,origin),null,path);
  assert.equal(offlinePage('/en/',origin,'POST'),null);
});
