import test from 'node:test';
import assert from 'node:assert/strict';
import {metadataEditorialReview} from '../scripts/lib/metadata-editorial-review.mjs';
const page=(path,extra={})=>({url:`https://example.com/en/${path}/`,locale:'en',httpStatus:200,indexed:true,noindex:false,titles:['Factory'],descriptions:['Contact our team.'],...extra});

test('duplicate descriptions and titles are reported with the distinct same-language destinations',()=>{
 const report=metadataEditorialReview([page('cooperation'),page('cooperation/suppliers'),page('cooperation/suppliers'),page('support',{titles:['Support'],descriptions:['Submit a support request.']})]);
 assert.equal(report.titleGroups,1);assert.equal(report.descriptionGroups,1);assert.equal(report.affectedPages,2);
 assert.deepEqual(report.titles[0].urls,['https://example.com/en/cooperation/','https://example.com/en/cooperation/suppliers/']);
});

test('different languages, noindex accounts, redirects and missing pages do not create false duplicates',()=>{
 const report=metadataEditorialReview([page('one'),page('two',{locale:'tr'}),page('auth/login',{noindex:true}),page('auth/register',{indexed:false}),page('old',{httpStatus:308}),page('missing',{httpStatus:404})]);
 assert.equal(report.titleGroups,0);assert.equal(report.descriptionGroups,0);assert.equal(report.affectedPages,0);
});

test('whitespace and case differences still prompt editorial review but malformed metadata remains the HTML audit concern',()=>{
 const report=metadataEditorialReview([page('one'),page('two',{titles:[' FACTORY  '],descriptions:['Contact\n our   team.']}),page('malformed',{titles:['Factory','Extra'],descriptions:[]})]);
 assert.equal(report.titleGroups,1);assert.equal(report.descriptionGroups,1);assert.equal(report.affectedPages,2);
 assert.equal(report.titles[0].urls.some(url=>url.includes('malformed')),false);
});
