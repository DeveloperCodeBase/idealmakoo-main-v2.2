import {cp,access,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const standalone=join(root,'.next/standalone');
try{await access(join(standalone,'server.js'));}catch{throw new Error('Production build not found. Run npm run build first.');}
// Next standalone excludes static assets; Docker copies the same two directories.
await mkdir(join(standalone,'.next'),{recursive:true});
await Promise.all([cp(join(root,'public'),join(standalone,'public'),{recursive:true}),cp(join(root,'.next/static'),join(standalone,'.next/static'),{recursive:true})]);
const child=spawn(process.execPath,[join(standalone,'server.js')],{cwd:standalone,stdio:'inherit',env:{...process.env,NODE_ENV:'production',HOSTNAME:process.env.BIND_HOST||'0.0.0.0',PORT:process.env.PORT||'3000'}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
