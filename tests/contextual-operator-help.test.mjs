import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';

const {workspaceGuide}=await loadTs('src/components/workspace/contextual-help.ts');
const {operatorHelp}=await loadTs('src/components/workspace/operator-help.ts');
const {roleExperience}=await loadTs('src/components/workspace/role-content.ts');
const {accountGuide}=await loadTs('src/components/account/account-help.ts');
const languages=['fa','en','tr','ar','ru'];

test('every staff overview describes the actual role instead of reusing the CRM record instructions',()=>{
 for(const [role,experience]of Object.entries(roleExperience)){
  const guide=workspaceGuide('overview',role);assert.equal(guide.steps[0],experience.intro,role);assert.ok(guide.steps.includes(operatorHelp.overview));
  for(const module of experience.modules)assert.ok(guide.related.includes(module),`${role}:${module}`);
 }
 assert.match(workspaceGuide('overview','publisher').steps[0].en,/approved/);
 assert.match(workspaceGuide('overview','translator').steps[0].en,/target-language/);
 assert.match(workspaceGuide('overview','analyst').steps[0].en,/aggregate/);
});

test('operational help covers staff provisioning, password consequences, SEO controls and storage application in five languages',()=>{
 for(const [key,step]of Object.entries(operatorHelp))for(const locale of languages)assert.ok(step[locale]?.trim().length>25,`${key}:${locale}`);
 const staff=workspaceGuide('staff').steps.map(step=>step.en).join(' ');assert.match(staff,/initial password/);assert.match(staff,/previous sessions/);assert.match(staff,/Hybrid/);assert.match(staff,/env/);assert.match(staff,/customers only/);
 assert.match(workspaceGuide('roles').steps.map(step=>step.en).join(' '),/12 defined roles/);
 const settings=workspaceGuide('settings').steps.map(step=>step.en).join(' ');assert.match(settings,/Search titles and descriptions/);assert.match(settings,/sitemap\.xml/);assert.match(settings,/MiB/);assert.match(settings,/do not delete existing files/);
});

test('customer guidance covers every existing account section without a foreign-language fallback',()=>{
 const sections=['overview','profile','preferences','organizations','requests','quick-matrix','saved','bookings','data-rooms','tenders','notifications','security'];
 for(const section of sections){
  const guide=accountGuide(section);if(section!=='overview')assert.notEqual(guide,accountGuide('overview'),section);
  assert.ok(guide.steps.length);assert.ok(guide.related.length);
  for(const step of guide.steps)for(const locale of languages){assert.ok(step[locale]?.trim().length>25,`${section}:${locale}`);if(locale==='en')assert.doesNotMatch(step[locale],/[\u0600-\u06ff]/);}
  for(const link of guide.related){assert.ok(link.label);assert.match(link.path,/^(account\/(requests|profile|security|notifications)|products|inquiry-list)$/);}
 }
 assert.match(accountGuide('overview').steps.map(step=>step.en).join(' '),/does not grant staff access/);
 assert.match(accountGuide('requests').steps[0].en,/internal staff notes are not displayed/);
 assert.match(accountGuide('security').steps[0].en,/Staff MFA is mandatory/);
});
