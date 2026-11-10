import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { loadTs } from './helpers/load-ts.mjs';

const { DISPLAY_BOOTSTRAP_SCRIPT, DISPLAY_PREFERENCES_EVENT, resolveDisplayTheme, effectiveReducedMotion, applyDisplayPreferences, currentDisplayTimeZone, isReducedMotion, surfaceEffectsEnabled } = await loadTs('src/lib/display-preferences.ts');

const prefs = { theme:'dark', language:'fa', timezone:'Asia/Tehran', motion:'system', effects:true, fontSize:'standard', density:'comfortable', sidebar:'expanded' };
function bootstrap(values, systemDark = false) {
  const document = { documentElement:{dataset:{},style:{}} };
  runInNewContext(DISPLAY_BOOTSTRAP_SCRIPT, { document, localStorage:{getItem:key=>values[key]??null}, matchMedia:()=>({matches:systemDark}) });
  return document.documentElement;
}

test('personal system theme follows the OS while explicit choices remain stable', () => {
  assert.equal(resolveDisplayTheme('system', true), 'dark');
  assert.equal(resolveDisplayTheme('system', false), 'light');
  assert.equal(resolveDisplayTheme('light', true), 'light');
  assert.equal(resolveDisplayTheme('dark', false), 'dark');
  assert.equal(effectiveReducedMotion('reduced', false), true);
  assert.equal(effectiveReducedMotion('system', true), true);
  assert.equal(effectiveReducedMotion('system', false), false);
});

test('the first-paint bootstrap reads only the signed-in owner and ignores another user or guest theme', () => {
  const values = {'idealmakoo.theme':'light','idealmakoo.session.v1':JSON.stringify({id:'local-a@example.com'})};
  assert.equal(bootstrap(values).dataset.theme, 'dark');
  values['idealmakoo.user-settings.local-a%40example.com.v1'] = JSON.stringify({version:1,ownerId:'local-b@example.com',preferences:{...prefs,theme:'light'}});
  assert.equal(bootstrap(values).dataset.theme, 'dark');
  values['idealmakoo.user-settings.local-a%40example.com.v1'] = JSON.stringify({version:1,ownerId:'local-a@example.com',profile:{name:'Private account name'},preferences:{...prefs,theme:'system',motion:'reduced',effects:false,fontSize:'large'}});
  const root=bootstrap(values,false);
  assert.equal(root.dataset.theme,'light');
  assert.equal(root.dataset.motion,'reduced');
  assert.equal(root.dataset.effects,'off');
  assert.equal(root.dataset.fontSize,'large');
  assert.equal(JSON.stringify(root).includes('Private account name'),false);
});

test('bootstrap allow lists reject malformed display values without injecting markup or profile data', () => {
  const values={'idealmakoo.session.v1':JSON.stringify({id:'demo-customer'}),'idealmakoo.user-settings.demo-customer.v1':JSON.stringify({version:1,ownerId:'demo-customer',preferences:{theme:'<script>',motion:'always',fontSize:'999px',effects:'false',density:'arbitrary'}})};
  const root=bootstrap(values);
  assert.deepEqual({...root.dataset},{theme:'dark'});
  assert.equal(bootstrap({'idealmakoo.session.v1':'{broken'}).dataset.theme,undefined);
  assert.equal(bootstrap({'idealmakoo.theme':'light'}).dataset.theme,'light');
});

test('runtime preference changes notify canvas hosts once and validate time zones', t => {
  const oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window');
  const document={documentElement:{dataset:{},style:{}}};const window=new EventTarget();
  Object.defineProperty(globalThis,'document',{configurable:true,value:document});
  Object.defineProperty(globalThis,'window',{configurable:true,value:window});
  t.after(()=>{if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else delete globalThis.document;if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete globalThis.window;});
  let changed=0;window.addEventListener(DISPLAY_PREFERENCES_EVENT,()=>changed++);
  const own={...prefs,theme:'system',motion:'reduced',effects:false,timezone:'Europe/Istanbul'};
  assert.equal(applyDisplayPreferences(own,false),'light');
  assert.equal(changed,1);applyDisplayPreferences(own,false);assert.equal(changed,1);
  assert.equal(isReducedMotion(false),true);assert.equal(surfaceEffectsEnabled(),false);
  assert.equal(currentDisplayTimeZone(),'Europe/Istanbul');
  document.documentElement.dataset.timezone='not-a-timezone';assert.equal(currentDisplayTimeZone(),undefined);
  applyDisplayPreferences(prefs,true);assert.equal(isReducedMotion(false),false);assert.equal(surfaceEffectsEnabled(),true);
});
