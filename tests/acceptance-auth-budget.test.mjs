import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTs} from './helpers/load-ts.mjs';
const {disposableAuthBudgetContext}=await loadTs('tests/e2e/helpers/auth-budget.ts');
const environment={PLAYWRIGHT_DISPOSABLE_AUTH_BUDGET:'true',TEST_DATABASE_URL:'postgresql://test:test_auth_fixture@127.0.0.1:54329/idealmakoo_acceptance2_1792483631848_1333f0a5',DATABASE_URL:'postgresql://app:test_auth_fixture@127.0.0.1:54329/idealmakoo_acceptance2_1792483631848_1333f0a5',SITE_URL:'http://127.0.0.1:3080',TRUST_PROXY:'true'};
test('auth-budget fixture requires explicit opt-in, named disposable DB, matching loopback targets and no connection overrides',()=>{
 assert.equal(disposableAuthBudgetContext(environment).databaseName,'idealmakoo_acceptance2_1792483631848_1333f0a5');
 assert.equal(disposableAuthBudgetContext({...environment,TEST_DATABASE_URL:'postgresql://test@127.0.0.1/idealmakoo_test',DATABASE_URL:'postgresql://app@127.0.0.1/idealmakoo_test',TRUST_PROXY:'false'}).databaseName,'idealmakoo_test');
 const repair='postgresql://test@127.0.0.1:54329/idealmakoo_repair_acceptance_1792495773181_babbde';
 assert.equal(disposableAuthBudgetContext({...environment,TEST_DATABASE_URL:repair,DATABASE_URL:repair}).databaseName,'idealmakoo_repair_acceptance_1792495773181_babbde');
 for(const name of ['idealmakoo_repair_delivery_1792495773181_babbde','idealmakoo_repair_acceptance_backup','idealmakoo_repair_acceptance_1792495773181_babb','idealmakoo_repair_acceptance_1792495773181_babbdeextra']){
  const target='postgresql://test@127.0.0.1:54329/'+name;assert.throws(()=>disposableAuthBudgetContext({...environment,TEST_DATABASE_URL:target,DATABASE_URL:target}),Error,name);
 }
 for(const patch of [
  {PLAYWRIGHT_DISPOSABLE_AUTH_BUDGET:undefined},{TEST_DATABASE_URL:undefined},{DATABASE_URL:undefined},
  {TEST_DATABASE_URL:'postgresql://test@127.0.0.1/idealmakoo_production'},{DATABASE_URL:'postgresql://app@127.0.0.1:54329/idealmakoo_other'},
  {TEST_DATABASE_URL:environment.TEST_DATABASE_URL+'?options=-c%20search_path=other'},{SITE_URL:'https://factory.example'},
  {SITE_URL:'http://localhost:3080'},{SITE_URL:'http://127.0.0.1:3080/en/'},{SITE_URL:'http://user:password@127.0.0.1:3080'},
  {TEST_DATABASE_URL:environment.TEST_DATABASE_URL.replace('127.0.0.1','database.example')},
 ])assert.throws(()=>disposableAuthBudgetContext({...environment,...patch}),Error,JSON.stringify(Object.keys(patch)));
});
