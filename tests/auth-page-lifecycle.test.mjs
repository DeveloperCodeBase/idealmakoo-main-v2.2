import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import * as React from 'react';
import ts from 'typescript';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const locales=['fa','en','tr','ar','ru'],settle=()=>new Promise(done=>setImmediate(done));
const compiled=new Map(),nothing=()=>null,styles=new Proxy({}, {get:(_target,key)=>String(key)});
const paths=new Set([
 'src/components/account/AuthPage.tsx','src/components/account/account-copy.ts','src/components/account/auth-storage.ts',
 'src/lib/api.ts','src/lib/content-lease-client.ts','src/lib/account-return.ts','src/lib/auth.ts','src/lib/locale-routing.ts','src/lib/storage.ts','src/lib/live-copy.ts'
]);
function compile(file){
 if(!compiled.has(file))compiled.set(file,ts.transpileModule(readFileSync(resolve(root,file),'utf8'),{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText);
 return compiled.get(file);
}
function memoryStorage(){const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key),clear:()=>values.clear()};}
function *walk(node){
 if(!node||typeof node!=='object')return;
 if(node.props)yield node;
 for(const child of [node.props?.children].flat(Infinity))yield*walk(child);
}

// Execute the complete actual TSX module and the actual HttpClient, including
// streamed JSON decoding and generation checks. Only the browser/network edge,
// decorative components and React hook scheduling are substituted. Event
// callbacks come from the returned real React element tree; no auth logic is
// copied into this harness. Render and effect commit are separate so a reply
// can settle during the first render of a different mode or locale.
function host(t,{mode='login',locale='en',search='',demo=false,honorAbort=false,cryptoFixture}={}){
 const hooks=[],cache=new Map(),calls=[],accepted=[],notices=[],navigations=[],demoSessions=[];
 const local=memoryStorage(),temporary=memoryStorage(),browser=new EventTarget();
 Object.assign(browser,{localStorage:local,sessionStorage:temporary,location:{pathname:`/${locale}/auth/${mode}/`,search,hash:''},history:{replaceState(_state,_title,path){browser.location.pathname=path;browser.location.search='';}}});
 let props={mode,locale},cursor=0,effects=[],dirty=false,closed=false,view,lateUpdates=0,expirations=0;
 browser.addEventListener('idealmakoo:session-expired',()=>{expirations++;});
 const slot=(kind,create)=>{const index=cursor++;hooks[index]??={kind,...create()};assert.equal(hooks[index].kind,kind,'The actual component hook order is stable');return hooks[index];};
 const useState=initial=>{const hook=slot('state',()=>({value:typeof initial==='function'?initial():initial}));hook.set??=action=>{if(closed){lateUpdates++;return;}const next=typeof action==='function'?action(hook.value):action;if(!Object.is(next,hook.value)){hook.value=next;dirty=true;}};return[hook.value,hook.set];};
 const useRef=value=>slot('ref',()=>({ref:{current:value}})).ref;
 const useEffect=(callback,dependencies)=>{const hook=slot('effect',()=>({}));if(!hook.dependencies||hook.dependencies.length!==dependencies.length||dependencies.some((value,index)=>!Object.is(value,hook.dependencies[index]))){hook.dependencies=dependencies;effects.push({hook,callback});}};
 function fetch(url,options={}){
  return new Promise((resolveFetch,rejectFetch)=>{
   let stream,headersSent=false,bodyFinished=false;
   const call={path:String(url).replace(/^\/api\/v1/,''),options,body:options.body?JSON.parse(options.body):undefined,abortObserved:false,settled:false,
    headers(status=200){assert.equal(headersSent,false);headersSent=true;const body=new ReadableStream({start(controller){stream=controller;}});resolveFetch(new Response(body,{status,headers:{'Content-Type':'application/json'}}));},
    finish(value,status=200){if(!headersSent)this.headers(status);assert.equal(bodyFinished,false);bodyFinished=true;call.settled=true;stream.enqueue(new TextEncoder().encode(JSON.stringify(value)));stream.close();},
    reject(error){if(bodyFinished)return;bodyFinished=true;call.settled=true;if(headersSent)stream.error(error);else rejectFetch(error);}
   };
   const aborted=()=>{call.abortObserved=true;if(honorAbort)call.reject(new DOMException('Fixture request aborted','AbortError'));};
   options.signal?.addEventListener('abort',aborted,{once:true});calls.push(call);
   if(options.signal?.aborted)aborted();
  });
 }
 const globals={console,URL,URLSearchParams,AbortController,DOMException,Headers,FormData,Response,ReadableStream,TextEncoder,TextDecoder,Event,CustomEvent,Date,Promise,JSON,Array,Object,Error,Number,String,Uint8Array,crypto:cryptoFixture||globalThis.crypto,setTimeout,clearTimeout,fetch,
  window:browser,localStorage:local,sessionStorage:temporary,document:{getElementById:()=>null},process:{env:{NODE_ENV:demo?'test':'production',NEXT_PUBLIC_DEMO_MODE:demo?'true':'false'}}};
 function load(file){
  assert.ok(paths.has(file),`Unexpected application dependency: ${file}`);
  if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const imports=name=>{
   if(name==='react')return{...React,useState,useRef,useEffect};
   if(name==='react/jsx-runtime')return require(name);
   if(name==='next/link')return{__esModule:true,default:({children,...props})=>React.createElement('a',props,children)};
   if(name==='next/navigation')return{useRouter:()=>({push:path=>navigations.push(path)})};
   if(name==='lucide-react')return new Proxy({}, {get:()=>nothing});
   if(name==='./CustomerOtp')return{__esModule:true,default:nothing,otpCopy:{sms:Object.fromEntries(locales.map(l=>[l,'SMS'])),email:Object.fromEntries(locales.map(l=>[l,'Email']))}};
   if(name==='@/components/experience/ToothExperience')return{__esModule:true,default:nothing};
   if(name==='./account.module.css')return{__esModule:true,default:styles};
   if(name==='@/lib/i18n')return{direction:value=>['fa','ar'].includes(value)?'rtl':'ltr',isLocale:value=>locales.includes(value)};
   if(name==='@/components/providers/AppProvider')return{useApp:()=>({locale:props.locale,dir:['fa','ar'].includes(props.locale)?'rtl':'ltr',theme:'light',t:key=>`${props.locale}:${key}`,href:path=>load('src/lib/locale-routing.ts').localizedPath(props.locale,path),notify:value=>notices.push(value),acceptSession:(user,csrf)=>{accepted.push({user,csrf});if(csrf)load('src/lib/api.ts').setCsrfToken(csrf);},signIn:(role,name,email)=>{demoSessions.push({role,name,email});return true;}})};
   let target=name.startsWith('@/')?resolve(root,'src',name.slice(2)):resolve(root,dirname(file),name);
   target=target.slice(root.length).replace(/^\//,'');
   for(const candidate of [target,target+'.ts',target+'.tsx'])if(paths.has(candidate))return load(candidate);
   assert.fail('Unexpected import '+name+' from '+file);
  };
  runInNewContext(compile(file),{...globals,module,exports:module.exports,require:imports},{filename:file});
  return module.exports;
 }
 const api=load('src/lib/api.ts');api.setCsrfToken('test_auth_current_csrf');
 const Component=load('src/components/account/AuthPage.tsx').default;
 function render(patch={}){assert.equal(effects.length,0,'Commit pending effects before another render');assert.equal(closed,false);props={...props,...patch};browser.location.pathname=`/${props.locale}/auth/${props.mode}/`;cursor=0;dirty=false;view=Component({mode:props.mode});return view;}
 function commit(){let count=0;while(effects.length||dirty){assert.ok(++count<=20,'Actual effects settle without a loop');const work=effects;effects=[];for(const {hook,callback}of work){hook.cleanup?.();hook.cleanup=callback();}if(dirty)render();}return view;}
 async function flush(){for(let i=0;i<3;i++){commit();await settle();}commit();}
 const instance={api,browser,local,temporary,calls,accepted,notices,navigations,demoSessions,render,commit,flush,
  get view(){return view;},get lateUpdates(){return lateUpdates;},get expirations(){return expirations;},
  copy(key){return load('src/components/account/account-copy.ts').accountText(props.locale,key,value=>`${props.locale}:${value}`);},
  find(predicate){const node=[...walk(view)].find(predicate);assert.ok(node,'Expected a node from actual AuthPage markup');return node;},
  input(name){return this.find(node=>node.type==='input'&&(node.props.name===name||(name==='verification'&&node.props.className==='otpInput')));},
  fill(name,value){this.input(name).props.onChange({target:{value}});commit();},
  check(value=true){this.find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({target:{checked:value}});commit();},
  submit(){return this.find(node=>node.type==='form').props.onSubmit({preventDefault(){}});},
  get alert(){return [...walk(view)].find(node=>node.props.role==='alert')?.props.children??'';},
  get complete(){return [...walk(view)].some(node=>node.props.role==='status');},
  get disabled(){return this.find(node=>node.type==='button'&&node.props.type==='submit').props.disabled;},
  next(path){const value=calls.find(call=>call.path===path&&!call.settled);assert.ok(value,`Expected pending ${path}; actual ${calls.map(call=>call.path).join(', ')}`);return value;},
  unmount(){if(closed)return;for(const hook of hooks)if(hook.kind==='effect')hook.cleanup?.();closed=true;},
  replayEffects(){for(const hook of hooks)if(hook.kind==='effect'){hook.cleanup?.();hook.dependencies=undefined;}render();commit();}
 };
 t.after(()=>{instance.unmount();for(const call of calls)if(!call.settled)call.reject(new Error('Unsettled fixture transport during cleanup'));api.clearCsrfToken();});
 render();commit();return instance;
}
const user=(role='customer')=>({id:'test_auth_customer',role,name:'Test user',email:'test-auth@example.test',demo:false});
const signIn=(host)=>{host.fill('email','TEST-AUTH@example.test');host.fill('password','test_auth_password_2026!');return host.submit();};
const noAdoption=host=>{assert.equal(host.accepted.length,0);assert.equal(host.navigations.length,0);assert.equal(host.notices.length,0);assert.equal(host.calls.some(call=>call.path==='/auth/logout'),false);};

test('two submit events before a React rerender produce only one actual login request',async t=>{
 const h=host(t);h.fill('email','test-auth@example.test');h.fill('password','test_auth_password_2026!');
 const first=h.submit(),second=h.submit();await h.flush();
 assert.equal(h.calls.length,1);assert.equal(h.disabled,true);assert.ok(h.calls[0].options.signal instanceof AbortSignal);
 h.next('/auth/login').finish({user:user(),csrfToken:'test_auth_next_csrf'});await Promise.all([first,second]);await h.flush();
 assert.equal(h.accepted.length,1);assert.deepEqual(h.navigations,['/en/account/']);
});

test('unmount aborts the owned fetch and ignores a late decoded login even when transport ignores cancellation',async t=>{
 const h=host(t),pending=signIn(h);await h.flush();const response=h.next('/auth/login');response.headers();await settle();h.unmount();
 assert.equal(response.options.signal.aborted,true);assert.equal(response.abortObserved,true);
 response.finish({user:user('admin'),csrfToken:'test_auth_obsolete_csrf'});await pending;
 noAdoption(h);assert.equal(h.lateUpdates,0);
});

test('the first render of another mode or locale invalidates a reply before passive-effect cleanup',async t=>{
 for(const patch of [{mode:'recover'},{locale:'fa'}]){
  const h=host(t),pending=signIn(h);await h.flush();const response=h.next('/auth/login');
  h.render(patch);response.finish({user:user(),csrfToken:'test_auth_obsolete_csrf'});await pending;
  noAdoption(h);await h.submit();assert.equal(h.calls.length,1,'The new context cannot submit before its effect owns the view.');h.commit();assert.equal(h.disabled,false);h.unmount();
 }
});

test('returning to the original locale does not revive its earlier request or overwrite a current MFA challenge',async t=>{
 const h=host(t),old=signIn(h);await h.flush();const oldResponse=h.next('/auth/login');
 h.render({locale:'fa'});h.commit();h.render({locale:'en'});h.commit();
 const current=signIn(h);await h.flush();const fresh=h.calls.filter(call=>call.path==='/auth/login').at(-1);
 fresh.finish({mfaRequired:true,challengeToken:'test_auth_current_challenge'});await current;await h.flush();
 oldResponse.finish({mfaRequired:true,challengeToken:'test_auth_obsolete_challenge'});await old;await h.flush();
 assert.deepEqual(h.navigations,['/en/auth/mfa/']);assert.equal(h.accepted.length,0);
 h.render({mode:'mfa'});h.commit();h.fill('verification','۱۲۳۴۵۶');const verify=h.submit();await h.flush();
 const verification=h.next('/auth/mfa/verify');assert.equal(verification.body.challengeToken,'test_auth_current_challenge');assert.equal(verification.body.code,'123456');
 verification.finish({user:user('admin'),csrfToken:'test_auth_verified_csrf'});await verify;await h.flush();
 assert.equal(h.accepted[0].user.role,'admin');assert.equal(h.navigations.at(-1),'/en/admin/');
});

test('a stale failure and finally cannot clear a replacement request or display old-language errors',async t=>{
 const h=host(t),old=signIn(h);await h.flush();const previous=h.next('/auth/login');
 h.render({locale:'tr'});h.commit();const current=signIn(h);await h.flush();const replacement=h.calls.filter(call=>call.path==='/auth/login').at(-1);
 previous.finish({code:'AUTH_BUSY',title:'Temporarily busy',detail:'Private server detail must not appear'},503);await old;await h.flush();
 assert.equal(h.alert,'');assert.equal(h.disabled,true);assert.equal(replacement.options.signal.aborted,false);
 const duplicate=h.submit();await duplicate;assert.equal(h.calls.length,2);
 replacement.finish({code:'INVALID_CREDENTIALS',title:'Unauthorized'},401);await current;await h.flush();
 assert.equal(h.alert,h.copy('wrongCredentials'));assert.equal(h.disabled,false);assert.equal(h.expirations,0);noAdoption(h);
});

test('late recovery and reset replies cannot announce success or navigate the new form',async t=>{
 for(const reset of [false,true]){
  const h=host(t,{mode:'recover',search:reset?'?token=test_auth_reset_token_1234567890':''});
  if(reset){h.fill('password','test_auth_new_password_2026!');h.fill('confirmPassword','test_auth_new_password_2026!');}else h.fill('email','test-auth@example.test');
  const pending=h.submit();await h.flush();const response=h.next(reset?'/auth/password/reset':'/auth/password/forgot');
  h.render({locale:'ru'});h.commit();response.finish({ok:true});await pending;await h.flush();
  noAdoption(h);assert.equal(h.complete,false);assert.equal(h.disabled,false);
  if(reset)assert.equal(h.input('password').props.value,'test_auth_new_password_2026!');h.unmount();
 }
 const current=host(t,{mode:'recover'});current.fill('email','test-auth@example.test');const submitted=current.submit();await current.flush();current.next('/auth/password/forgot').finish({ok:true});await submitted;await current.flush();assert.equal(current.complete,true);
});

test('current registration, customer return paths and staff enrollment flows retain their actual payloads and routes',async t=>{
 for(const locale of locales){
  const returnTo=`/${locale}/account/requests/?id=test_owned_request`,h=host(t,{mode:'register',locale,search:'?returnTo='+encodeURIComponent(returnTo)});
  h.fill('name','Test customer');h.fill('email','TEST-AUTH@example.test');h.fill('password','test_auth_password_2026!');h.fill('confirmPassword','test_auth_password_2026!');h.check();
  const pending=h.submit();await h.flush();const registration=h.next('/auth/register');
  assert.equal(JSON.stringify(registration.body),JSON.stringify({name:'Test customer',email:'test-auth@example.test',password:'test_auth_password_2026!'}));
  registration.finish({user:user(),csrfToken:'test_auth_registered_csrf'});await pending;await h.flush();assert.deepEqual(h.navigations,[returnTo]);h.unmount();
  const staff=host(t,{locale,search:'?returnTo='+encodeURIComponent(returnTo)}),signedIn=signIn(staff);await staff.flush();
  staff.next('/auth/login').finish({user:{...user('admin'),mfaEnrollmentRequired:true},mfaEnrollmentRequired:true,csrfToken:'test_auth_enrollment_csrf'});await signedIn;await staff.flush();
  assert.deepEqual(staff.navigations,[`/${locale}/account/security/?returnTo=${encodeURIComponent(returnTo)}`]);assert.equal(staff.accepted[0].user.mfaEnrollmentRequired,true);staff.unmount();
 }
});

test('AUTH_BUSY is a generic localized503, preserves the current session and allows an explicit retry in all five locales',async t=>{
 const expected={fa:'سرویس احراز هویت موقتاً شلوغ است. کمی بعد دوباره تلاش کنید.',en:'Authentication is temporarily busy. Please try again shortly.',tr:'Kimlik doğrulama hizmeti geçici olarak yoğun. Lütfen biraz sonra tekrar deneyin.',ar:'خدمة التحقق من الهوية مشغولة مؤقتًا. حاول مجددًا بعد قليل.',ru:'Сервис проверки учётных данных временно занят. Повторите попытку немного позже.'};
 for(const locale of locales){
  const h=host(t,{locale}),pending=signIn(h);await h.flush();h.next('/auth/login').finish({code:'AUTH_BUSY',title:'Busy',detail:'test_private_account_status'},503);await pending;await h.flush();
  assert.equal(h.alert,expected[locale]);assert.equal(h.disabled,false);assert.equal(h.expirations,0);noAdoption(h);
  const retry=h.submit();await h.flush();const response=h.next('/auth/login');assert.equal(new Headers(response.options.headers).get('X-CSRF-Token'),'test_auth_current_csrf');
  response.finish({code:'INVALID_CREDENTIALS',title:'Unauthorized'},401);await retry;await h.flush();assert.equal(h.alert,h.copy('wrongCredentials'));assert.equal(h.expirations,0);h.unmount();
 }
});

test('the existing HttpClient account-generation guard rejects a body completed after another account is accepted',async t=>{
 const h=host(t),pending=signIn(h);await h.flush();const response=h.next('/auth/login');response.headers();await settle();
 h.api.setCsrfToken('test_auth_replacement_csrf');response.finish({user:user(),csrfToken:'test_auth_obsolete_csrf'});await pending;await h.flush();
 noAdoption(h);assert.equal(h.alert,'The server version changed. Review the current saved version before retrying.');assert.equal(h.expirations,0);
});

test('effect cleanup cancels its request without clearing a later request when effects are mounted again',async t=>{
 const h=host(t,{honorAbort:true}),previous=signIn(h);await h.flush();const aborted=h.next('/auth/login');
 h.replayEffects();const current=signIn(h);await h.flush();await previous;assert.equal(aborted.options.signal.aborted,true);
 assert.equal(h.disabled,true);const response=h.next('/auth/login');response.finish({user:user(),csrfToken:'test_auth_current_result_csrf'});await current;await h.flush();
 assert.equal(h.accepted.length,1);assert.equal(h.expirations,0);assert.equal(h.calls.some(call=>call.path==='/auth/logout'),false);
});

test('normal local demo customer and staff flows remain distinct from production authentication',async t=>{
 for(const role of ['customer','admin']){
  const h=host(t,{demo:true}),fixture=[...walk(h.view)].find(node=>node.type==='button'&&[...walk(node)].some(child=>child.type==='small'&&child.props.children===`demo.${role==='customer'?'customer':'admin'}@idealmako.invalid`));
  assert.ok(fixture);fixture.props.onClick();h.commit();const pending=h.submit();await pending;await h.flush();
  assert.equal(h.calls.length,0);assert.equal(h.accepted.length,0);
  if(role==='customer'){assert.equal(h.demoSessions[0].role,'customer');assert.equal(h.navigations.at(-1),'/en/account/');}
  else{assert.equal(h.demoSessions.length,0);assert.equal(h.navigations.at(-1),'/en/auth/mfa/');assert.match(h.temporary.getItem('idealmakoo.auth.pending.v1'),/"role":"admin"/);}
  h.unmount();
 }
});

test('a completed demo registration still saves locally, while an abandoned derivation cannot save or sign in',async t=>{
 for(const abandon of [false,true]){
  let finish;
  const cryptoFixture={randomUUID:()=> 'test_auth_demo_salt',subtle:{importKey:async()=>({}),deriveBits:()=>new Promise(done=>{finish=done;})}};
  const h=host(t,{mode:'register',demo:true,cryptoFixture});h.fill('name','Test demo customer');h.fill('email','test-demo@example.test');h.fill('password','test_auth_demo_password_2026!');h.fill('confirmPassword','test_auth_demo_password_2026!');h.check();
  const pending=h.submit();await h.flush();assert.equal(typeof finish,'function');if(abandon)h.unmount();
  finish(new Uint8Array(32).buffer);await pending;
  assert.equal(h.calls.length,0);assert.equal(h.accepted.length,0);
  if(abandon){assert.equal(h.local.getItem('idealmakoo.local-accounts.v1'),null);assert.equal(h.demoSessions.length,0);assert.equal(h.navigations.length,0);assert.equal(h.lateUpdates,0);}
  else{await h.flush();const saved=JSON.parse(h.local.getItem('idealmakoo.local-accounts.v1'));assert.equal(saved.length,1);assert.equal(saved[0].role,'customer');assert.equal(saved[0].email,'test-demo@example.test');assert.equal(saved[0].passwordDigest,'0'.repeat(64));assert.equal(h.demoSessions.length,1);assert.equal(h.navigations.at(-1),'/en/account/');}
  h.unmount();
 }
});

test('each recovery request sends the current interface locale for the server email template and recovery link',async t=>{
 for(const locale of locales){
  const h=host(t,{mode:'recover',locale});h.fill('email','TEST-AUTH@example.test');
  const pending=h.submit();await h.flush();const response=h.next('/auth/password/forgot');
  assert.equal(JSON.stringify(response.body),JSON.stringify({email:'test-auth@example.test',locale}));assert.equal(response.options.method,'POST');
  response.finish({ok:true,message:'Generic recovery response'});await pending;await h.flush();
  assert.equal(h.complete,true);assert.equal(h.alert,'');assert.equal(h.accepted.length,0);assert.equal(h.navigations.length,0);h.unmount();
 }
});

test('leaving recovery clears its token, restores email validation and cannot reuse that token on returning',async t=>{
 for(const mode of ['login','register']){
  const h=host(t,{mode:'recover',search:'?token=test_auth_mode_transition_token_123'});
  assert.equal([...walk(h.view)].some(node=>node.type==='input'&&node.props.name==='email'),false);
  h.render({mode});h.commit();
  assert.equal([...walk(h.view)].some(node=>node.type==='input'&&node.props.name==='email'),true,'The reused login or registration form must restore its email input.');
  h.fill('email','invalid-email');await h.submit();h.commit();assert.equal(h.alert,'en:validEmail');assert.equal(h.calls.length,0);
  if(mode==='register')assert.ok(h.input('name'));
  h.render({mode:'recover'});h.commit();assert.ok(h.input('email'));
  assert.equal([...walk(h.view)].some(node=>node.type==='input'&&node.props.name==='password'),false,'Returning without a new URL token must open ordinary recovery.');
  h.fill('email','test-auth@example.test');const pending=h.submit();await h.flush();const response=h.next('/auth/password/forgot');assert.equal(response.body.token,undefined);
  assert.equal(h.calls.some(call=>call.path==='/auth/password/reset'),false);response.finish({ok:true});await pending;await h.flush();h.unmount();
 }
 const active=host(t,{mode:'recover',search:'?token=test_auth_active_recovery_token_123'});
 active.fill('password','test_auth_replacement_password_2026!');active.fill('confirmPassword','test_auth_replacement_password_2026!');active.render({locale:'fa'});active.commit();
 const submitted=active.submit();await active.flush();const response=active.next('/auth/password/reset');assert.equal(response.body.token,'test_auth_active_recovery_token_123');
 response.finish({ok:true});await submitted;await active.flush();assert.deepEqual(active.navigations,['/fa/auth/login/']);assert.ok(active.input('email'));assert.equal(active.calls.length,1);
});
