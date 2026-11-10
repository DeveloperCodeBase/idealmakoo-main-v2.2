import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('browser editorial validation accepts valid data and rejects markup without an eval capability probe',()=>{
 const code=`
  import assert from 'node:assert/strict';
  import {z} from 'zod';
  globalThis.window={};
  let attempts=0;
  globalThis.Function=new Proxy(Function,{apply(){attempts++;throw new EvalError('Strict CSP');},construct(){attempts++;throw new EvalError('Strict CSP');}});
  const {parseEditorialSeo}=await import('./src/lib/editorial-seo.ts');
  const valid={article:{authors:[{name:'Reviewer',type:'Person'}]}};
  assert.deepEqual(parseEditorialSeo(valid),valid);
  assert.equal(parseEditorialSeo({article:{authors:[{name:'<script>',type:'Person'}]}}),null);
  assert.equal(attempts,0);
  assert.equal(z.config().jitless,true);
  console.log('CSP validation passed');
 `;
 const output=execFileSync(process.execPath,['--import','tsx','--input-type=module','-e',code],{cwd:fileURLToPath(new URL('../',import.meta.url)),encoding:'utf8',timeout:20000});
 assert.match(output,/CSP validation passed/);
});
