/** Next.js builds every page; this supported Worker ESM envelope adds server AI. */
import {readFile,writeFile,mkdir,cp,rm,stat} from 'node:fs/promises';
import {resolve,basename,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import ts from 'typescript';
import {loadTs} from '../tests/helpers/load-ts.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const hosting=JSON.parse(await readFile(resolve(root,'.openai/hosting.json'),'utf8'));
if(hosting.static)throw new Error('AI server requires the Worker deployment manifest.');
await stat(resolve(root,'out/index.html'));
const {createKnowledge}=await loadTs('worker/knowledge.ts');
const knowledge=createKnowledge();
const handler=await readFile(resolve(root,'worker/ai-handler.ts'),'utf8');
const entry=await readFile(resolve(root,'worker/entry.ts'),'utf8');
const downloadHandler=await readFile(resolve(root,'worker/download.ts'),'utf8');
const zip=await readFile(resolve(root,'public/downloads/idealmakoo-source.zip'));const partSize=12*1024*1024;
const archive={bytes:zip.byteLength,sha256:createHash('sha256').update(zip).digest('hex'),parts:[]};
for(let offset=0;offset<zip.length;offset+=partSize)archive.parts.push({url:`/downloads/idealmakoo-source.${String(archive.parts.length+1).padStart(3,'0')}.bin`,bytes:Math.min(partSize,zip.length-offset)});
// Type-only declarations disappear. Handler has no imports; data is public and deterministic.
const source=`${handler}\n${downloadHandler}\nconst KNOWLEDGE=${JSON.stringify(knowledge)};\nconst SOURCE_ARCHIVE=${JSON.stringify(archive)};\n${entry.replace(/^declare const .+;$/gm,'')}`;
const result=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true,fileName:'worker.ts'});
const errors=(result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error);if(errors.length)throw new Error(ts.formatDiagnosticsWithColorAndContext(errors,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
await rm(resolve(root,'dist'),{recursive:true,force:true,maxRetries:5,retryDelay:120});
await mkdir(resolve(root,'dist/server'),{recursive:true});await mkdir(resolve(root,'dist/.openai'),{recursive:true});
const downloads=resolve(root,'out/downloads');
// The archive is served by the Worker from bounded parts. Never stage the full
// file or a transfer's temporary sibling as a Cloudflare asset.
const copyAsset=source=>!(dirname(source)===downloads&&(basename(source)==='idealmakoo-source.zip'||basename(source).startsWith('.idealmakoo-source.zip.')));
await Promise.all([cp(resolve(root,'out'),resolve(root,'dist/client'),{recursive:true,filter:copyAsset}),writeFile(resolve(root,'dist/server/index.js'),result.outputText),writeFile(resolve(root,'dist/.openai/hosting.json'),JSON.stringify(hosting,null,2)+'\n')]);
await rm(resolve(root,'dist/client/downloads/idealmakoo-source.zip'),{force:true});
for(let i=0;i<archive.parts.length;i++)await writeFile(resolve(root,'dist/client','.'+archive.parts[i].url),zip.subarray(i*partSize,(i+1)*partSize));
const mod=await import('data:text/javascript;base64,'+Buffer.from(result.outputText).toString('base64'));
if(typeof mod.default?.fetch!=='function')throw new Error('Worker must export default.fetch');
const status=await mod.default.fetch(new Request('https://local.test/api/ai/status'),{});const info=await status.json();if(info.configured!==false||info.knowledgeEntries!==knowledge.length)throw new Error('AI configuration isolation failed');
const asset=await mod.default.fetch(new Request('https://local.test/fa/'),{ASSETS:{fetch:async()=>new Response('asset-ok')}});if(await asset.text()!=='asset-ok')throw new Error('Asset pass-through failed');
console.log(JSON.stringify({worker:'dist/server/index.js',client:'dist/client',knowledgeEntries:knowledge.length,workerBytes:Buffer.byteLength(result.outputText),secretEmbedded:false,esmVerified:true}));
