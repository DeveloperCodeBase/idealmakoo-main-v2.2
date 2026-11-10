import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';

// The legacy adapter suite intentionally tests the explicitly enabled demo.
// Production authentication, database behavior and browsers have separate gates.
const files=readdirSync(new URL('../tests/',import.meta.url)).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>`tests/${name}`);
const result=spawnSync(process.execPath,['--import','tsx','--test','--test-isolation=none',...files],{stdio:'inherit',env:{...process.env,NODE_ENV:'test',NEXT_PUBLIC_DEMO_MODE:'true'}});
if(result.error)throw result.error;
process.exitCode=result.status??1;
