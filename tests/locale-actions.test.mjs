import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import {loadTs} from './helpers/load-ts.mjs';

const {locales} = await loadTs('src/lib/i18n.ts');
const {localizedPath,changedPreferredLocale} = await loadTs('src/lib/locale-routing.ts');
const {publicLocaleDestination,localePublications} = await loadTs('src/lib/publication-locales.ts');
const {roles,roleLandingPath,roleLandingRoute} = await loadTs('src/lib/auth.ts');

// Exercise the actual event handlers, with only their UI/storage boundaries
// stubbed. TypeScript's parser extracts the callback; no copy of its logic is
// maintained in a test and no browser/rendering result is implied by this suite.
const callbacks = new Map();
function handler(file, name, context) {
  context={demoMode:true,publicTokenPage:false,readServerSite:()=>null,initialSite:null,publicLocaleDestination,localePublications,notify:()=>{},networkError:error=>error.message,locale:'en',setGuestMerge:()=>{},readGuestInquiry:()=>null,writeGuestInquiry:()=>true,clearCsrfToken:()=>{},identityRef:{current:'user-a'},collectionRef:{current:{}},setSettingsState:()=>{},setSettingsOwner:()=>{},setRequests:()=>{},setInquiriesState:()=>{},setCompareState:()=>{},setSavedState:()=>{},saving:false,setSaving:()=>{},...context};
  const key = `${file}:${name}`;
  if (callbacks.has(key)) return runInNewContext(callbacks.get(key), context);
  const source = ts.createSourceFile(file, readFileSync(new URL(`../${file}`,import.meta.url),'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let callback;
  function find(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) callback = node.initializer;
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(callback, `Missing actual action: ${file} ${name}`);
  if (ts.isCallExpression(callback)) callback = callback.arguments[0];
  const compiled = ts.transpileModule(`(${callback.getText(source)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
  callbacks.set(key, compiled);
  return runInNewContext(compiled, context);
}
const provider = 'src/components/providers/AppProvider.tsx';
const auth = 'src/components/account/AuthPage.tsx';
const settings = 'src/components/account/PersonalSettings.tsx';

function logoutFixture(options={}) {
  const identityRef=options.identityRef||{current:'user-a'},locale=options.locale||'en',generation=3;
  const requestContextKey=JSON.stringify([identityRef.current,'customer',locale,generation]);
  const initialQueue=new Promise(()=>{});
  const refs={identityRef,publicTokenRef:{current:false},authGenerationRef:{current:generation},requestContextRef:{current:requestContextKey},requestSequence:{current:11},settingsSequence:{current:13},requestRef:{current:[{id:'private-request'}]},collectionRef:options.collectionRef||{current:{inquiries:[{productId:'private'}],compare:['private-product'],saved:['private-product']}},metaRef:{current:{collectionVersion:4,savedVersion:7,defaultWishlistId:'private-wishlist'}},collectionQueue:{current:initialQueue},mergeBusy:{current:'private-merge'}};
  const state={authGeneration:generation,session:{id:identityRef.current},sessionError:'',serverSessionReady:true,collectionOwner:requestContextKey,requestResolution:{context:requestContextKey,status:'ready',error:''},settingsContext:requestContextKey,settingsState:{ownerId:identityRef.current},settingsError:'Previous error',guestMerge:{source:{userId:identityRef.current}},merging:true,settingsOwner:identityRef.current,requests:[{id:'private-request'}],inquiries:[{productId:'private'}],compare:['private-product'],saved:['private-product']};
  const context={...refs,...options,locale,requestContextKey,authGeneration:generation};
  const setters={setAuthGeneration:'authGeneration',setSession:'session',setSessionError:'sessionError',setServerSessionReady:'serverSessionReady',setCollectionOwner:'collectionOwner',setRequestResolution:'requestResolution',setSettingsContext:'settingsContext',setSettingsState:'settingsState',setSettingsError:'settingsError',setGuestMerge:'guestMerge',setMerging:'merging',setSettingsOwner:'settingsOwner',setRequests:'requests',setInquiriesState:'inquiries',setCompareState:'compare',setSavedState:'saved'};
  for(const [name,key]of Object.entries(setters))context[name]=value=>{state[key]=typeof value==='function'?value(state[key]):value;options[name]?.(value);};
  // These are the actual production ownership predicate and invalidation
  // callback, sharing the same refs as signOut. The fixture models setters,
  // rather than replacing advanceAuth with a no-op or copied clearing logic.
  context.contextCurrent=handler(provider,'contextCurrent',context);
  context.advanceAuth=handler(provider,'advanceAuth',context);
  return{run:handler(provider,'signOut',context),state,refs,initialQueue,generation};
}
function assertPrivateLogoutInvalidated(fixture) {
  const {state,refs,generation,initialQueue}=fixture;
  assert.equal(state.authGeneration,generation+1);assert.equal(refs.authGenerationRef.current,generation+1);
  assert.equal(refs.requestSequence.current,12);assert.equal(refs.settingsSequence.current,14);
  assert.equal(refs.requestRef.current.length,0);
  for(const key of ['inquiries','compare','saved'])assert.equal(refs.collectionRef.current[key].length,0);
  assert.equal(refs.metaRef.current.collectionVersion,0);assert.equal(refs.metaRef.current.savedVersion,0);assert.equal(refs.metaRef.current.defaultWishlistId,'');assert.notEqual(refs.collectionQueue.current,initialQueue);
  assert.equal(refs.mergeBusy.current,null);assert.equal(state.merging,false);assert.equal(state.guestMerge,null);
  assert.equal(state.collectionOwner,null);assert.equal(state.requestResolution,null);assert.equal(state.settingsContext,null);assert.equal(state.settingsState,null);assert.equal(state.settingsError,'');
  for(const key of ['requests','inquiries','compare','saved'])assert.equal(state[key].length,0);
}

test('normal, demo and MFA sign-in completion retains the chosen page language across all roles and saved preferences', () => {
  for (const locale of locales) for (const saved of locales) {
    const destinations = [];
    const finish = handler(auth, 'finishSignIn', {locale,signIn:(role,name,email)=>({id:'local-user',role,name,email}),writeStore:()=>true,notify:()=>{},t:key=>key,router:{push:path=>destinations.push(path)},roleLandingPath,roleLandingRoute,localizedPath,readUserSettings:()=>({preferences:{language:saved}})});
    for (const role of roles) {
      finish({role,name:'Test user',email:'user@example.test',route:'untrusted'});
      assert.equal(destinations.at(-1), `/${locale}/${role === 'customer' ? 'account' : 'admin'}/`);
    }
  }
});

test('super-admin role switching retains the current locale even when the destination account prefers another', () => {
  for (const locale of locales) for (const saved of locales) {
    const destinations = [];
    const change = handler(provider, 'setRole', {session:{role:'superAdmin'},roles,signIn:role=>({id:`demo-${role}`,role}),router:{replace:path=>destinations.push(path)},notify:()=>{},t:key=>key,locale,roleLandingPath,roleLandingRoute,localizedPath,readUserSettings:()=>({preferences:{language:saved}})});
    for (const role of roles) {change(role);assert.equal(destinations.at(-1),roleLandingPath(role,locale));}
  }
  const destinations = [];
  handler(provider,'setRole',{session:{role:'customer'},roles,signIn:()=>assert.fail('Unauthorized role switch'),notify:()=>{},t:key=>key,router:{replace:path=>destinations.push(path)}})('admin');
  assert.deepEqual(destinations,[]);
});

test('logout returns to the current language home page', async () => {
  for (const locale of locales) {
    const destinations=[],sessions=[];
    const fixture=logoutFixture({locale,setSession:value=>sessions.push(value),window:{},router:{push:path=>destinations.push(path)},href:path=>localizedPath(locale,path)});
    await fixture.run();assertPrivateLogoutInvalidated(fixture);
    assert.deepEqual(sessions,[null]);assert.deepEqual(destinations,[`/${locale}/`]);
  }
});

test('an explicit language selection preserves the page, encoded query and hash and avoids duplicate history entries', () => {
  for (const locale of locales) for (const language of locales) {
    const destinations=[],writes=[];
    const location=new URL(`https://factory.test/${locale}/products/detail/?id=custom-one&note=a%2Fb#variants`);
    handler(provider,'switchLocale',{locale,pathname:location.pathname,window:{location},session:{id:'user-a'},userSettings:{preferences:{language:locale}},readUserSettings:()=>({preferences:{language:locale}}),savePreferences:patch=>{writes.push({...patch});return Promise.resolve({ok:true});},notify:()=>{},t:key=>key,router:{push:path=>destinations.push(path)},localizedPath})(language);
    assert.deepEqual(destinations,language===locale?[]:[`/${language}/products/detail/?id=custom-one&note=a%2Fb#variants`]);
    assert.equal(writes.length,language===locale?0:1);
  }
});

test('capability-page language changes never write the signed-in account preferences', () => {
  for(const locale of locales)for(const language of locales){
    const destinations=[];const location=new URL(`https://factory.test/${locale}/saved-share/opaque-token/?view=public#items`);
    handler(provider,'switchLocale',{publicTokenPage:true,locale,pathname:location.pathname,window:{location},session:{id:'private-owner'},userSettings:{preferences:{language:locale}},savePreferences:()=>assert.fail('A public capability cannot mutate private account preferences'),router:{push:path=>destinations.push(path)},localizedPath})(language);
    assert.deepEqual(destinations,language===locale?[]:[`/${language}/saved-share/opaque-token/?view=public#items`]);
  }
});

test('the language control follows the released localized slug and refuses missing or withdrawn translations before saving preferences',()=>{
  const publications=[{id:'launch',kind:'news',slug:'new-line',locale:'en'},{id:'launch',kind:'news',slug:'khate-jadid',locale:'fa'}];
  for(const hidden of [false,true])for(const language of ['fa','tr']){
    const destinations=[],writes=[],notices=[];
    const location=new URL('https://factory.test/en/news/new-line/?campaign=one%2Ftwo#materials');
    const site={publications,...hidden?{hiddenPageLocales:{'news/khate-jadid':['fa']}}:{}};
    const action=handler(provider,'switchLocale',{demoMode:false,locale:'en',pathname:location.pathname,window:{location},initialSite:site,session:{id:'user-a'},userSettings:{preferences:{language:'en'}},savePreferences:patch=>{writes.push({...patch});return Promise.resolve({ok:true});},notify:message=>notices.push(message),t:key=>key,router:{push:path=>destinations.push(path)}});
    action(language);
    if(language==='fa'&&!hidden){assert.deepEqual(destinations,['/fa/news/khate-jadid/?campaign=one%2Ftwo#materials']);assert.deepEqual(writes,[{language:'fa'}]);assert.deepEqual(notices,[]);}
    else{assert.deepEqual(destinations,[]);assert.deepEqual(writes,[]);assert.deepEqual(notices,['translationUnavailable']);}
  }
});

test('a rejected real logout retains the account and reports the transport failure without redirecting', async()=>{
  const sessions=[],destinations=[],notices=[],owner={current:'user-a'};
  const fixture=logoutFixture({demoMode:false,locale:'en',apiClient:{request:async(path,options)=>{assert.equal(path,'/auth/logout');assert.equal(options.method,'POST');throw new Error('Server logout failed');}},identityRef:owner,setSession:value=>sessions.push(value),notify:value=>notices.push(value),router:{push:path=>destinations.push(path)},window:{},href:path=>localizedPath('en',path)});
  await fixture.run();assert.equal(fixture.state.authGeneration,fixture.generation);assert.equal(fixture.refs.authGenerationRef.current,fixture.generation);assert.equal(fixture.refs.collectionQueue.current,fixture.initialQueue);assert.equal(fixture.refs.requestRef.current[0].id,'private-request');assert.equal(fixture.state.settingsState.ownerId,'user-a');
  assert.equal(owner.current,'user-a');assert.deepEqual(sessions,[]);assert.deepEqual(destinations,[]);assert.deepEqual(notices,['Server logout failed']);
});

test('confirmed real logout clears private state and a bound guest merge without copying account data',async()=>{
  const sessions=[],destinations=[],journalWrites=[],requests=[],inquiries=[],owner={current:'user-a'},collection={current:{inquiries:[{productId:'private'}]}};let csrfCleared=0;
  const fixture=logoutFixture({demoMode:false,locale:'ru',apiClient:{request:async(path,options)=>{assert.equal(path,'/auth/logout');assert.equal(options.method,'POST');return{ok:true};}},identityRef:owner,collectionRef:collection,setSession:value=>sessions.push(value),setRequests:value=>requests.push(value),setInquiriesState:value=>inquiries.push(value),readGuestInquiry:()=>({userId:'user-a',items:[{productId:'guest'}]}),writeGuestInquiry:value=>journalWrites.push(value),clearCsrfToken:()=>csrfCleared++,router:{push:path=>destinations.push(path)},window:{},href:path=>localizedPath('ru',path)});
  await fixture.run();assertPrivateLogoutInvalidated(fixture);
  assert.equal(owner.current,null);assert.equal(csrfCleared,1);assert.deepEqual(sessions,[null]);assert.deepEqual(journalWrites,[null]);assert.equal(requests[0].length,0);assert.equal(inquiries[0].length,0);assert.deepEqual(destinations,['/ru/']);assert.equal(collection.current.inquiries.length,0);
});

test('saving appearance or profile preserves the active locale; only an explicitly changed language is applied', async () => {
  for (const locale of locales) for (const before of locales) for (const after of locales) for (const section of ['preferences','profile']) {
    const switched=[];
    const result={ok:true,settings:{profile:{name:'Updated'},preferences:{language:after,theme:'light'}}};
    const app={locale,saveProfile:()=>result,savePreferences:()=>result,notify:()=>{},switchLocale:language=>switched.push(language)};
    const submit=handler(settings,'submit',{app,section,dirty:true,avatarBusy:false,profile:{name:'Updated'},preferences:result.settings.preferences,baseline:{revision:1,preferences:{language:before}},setBaseline:()=>{},setProfile:()=>{},setPreferences:()=>{},setIssues:()=>{},setError:()=>{},text:key=>key,changedPreferredLocale});
    await submit({preventDefault:()=>{}});
    assert.deepEqual(switched,section==='preferences'&&before!==after&&after!==locale?[after]:[]);
  }
});

test('a failed or conflicted preference save cannot apply its draft language', async () => {
  for (const reason of ['storage','conflict','validation','session']) {
    const switched=[];
    await handler(settings,'submit',{app:{locale:'en',savePreferences:()=>({ok:false,reason}),switchLocale:locale=>switched.push(locale)},section:'preferences',dirty:true,avatarBusy:false,profile:{},preferences:{language:'ar'},baseline:{revision:1,preferences:{language:'fa'}},setIssues:()=>{},setError:()=>{},changedPreferredLocale})({preventDefault:()=>{}});
    assert.deepEqual(switched,[]);
  }
});
