#!/usr/bin/env node
/** Create a private, allowlisted source release. Nothing is written under public/. */
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, unzipSync } from 'fflate';

const root=await realpath(fileURLToPath(new URL('../',import.meta.url)));
const args=process.argv.slice(2);
if(args.includes('--help')) {
  console.log('Usage: npm run package:source [-- --check]\n--check scans the exact release allowlist and secrets without creating an archive.\nOutput: ../deliverables/idealmakoo-production-VERSION.zip plus SHA-256 and file manifest.');
  process.exit(0);
}
if(args.some(value=>value!=='--check'))throw new Error('Only --check is supported. The private output directory is fixed.');
const checkOnly=args.includes('--check');
const roots=['src','public','worker','scripts','deploy','db','tests','docs','.github'];
const rootFiles=['README.md','SECURITY.md','package.json','package-lock.json','Dockerfile','docker-compose.yml','.dockerignore','.env.example','.gitignore','next.config.ts','next-env.d.ts','tsconfig.json','tailwind.config.ts','postcss.config.mjs','playwright.config.ts','vitest.config.ts','LICENSE','LICENSE.md','NOTICE'];
const required=['README.md','SECURITY.md','package.json','package-lock.json','Dockerfile','docker-compose.yml','.dockerignore','.env.example','next.config.ts','tsconfig.json','scripts/install-ubuntu.sh','scripts/backup.sh','scripts/restore.sh','scripts/worker.ts','scripts/package-production.mjs','scripts/privacy-ledger.ts','deploy/caddy/Caddyfile','deploy/postgres/init-roles.sh','db/migrations/001_core.sql','src/server/db.ts','docs/DEPLOYMENT.fa.md','docs/OPERATIONS.fa.md','docs/API.md','docs/ORIGINAL-SPEC.md','docs/VERIFICATION.fa.md','docs/PRODUCTION-COVERAGE.fa.md'];
const excludedParts=new Set(['node_modules','.git','.next','.openai','.sites-runtime','out','dist','coverage','test-results','playwright-report','tmp','temp','qa-artifacts','deliverables','storage','privacy-ledger','integrations','backups','shared','releases','__pycache__']);
const excludedNames=new Set(['.env','.env.local','.env.production','.env.production.local','.npmrc','backup-identity.txt','.DS_Store','SOURCE-MANIFEST.json']);
const forbiddenExtensions=new Set(['.log','.pem','.key','.age','.dump','.pyc','.p12','.pfx','.jks','.db','.sqlite','.sqlite3','.tsbuildinfo','.zip','.tgz','.gz','.7z','.rar']);
const sourceExtensions=new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.css','.scss','.json','.md','.txt','.csv','.yaml','.yml','.toml','.sql','.sh','.py','.svg','.d.ts']);
const assetExtensions=new Set([...sourceExtensions,'.pdf','.png','.jpg','.jpeg','.webp','.avif','.gif','.ico','.woff','.woff2','.ttf','.otf','.hdr','.webmanifest','.wasm','.mp4','.webm','.mp3','.ogg','.wav']);
// Generated, non-personal binary fixtures required by the document-upload HTTP
// regression. Keep this exact allowlist separate from public production assets.
const testMediaFixtures=new Set(['tests/fixtures/resource-upload/video.mp4','tests/fixtures/resource-upload/audio.mp3']);
// Reviewed lossless public lighting asset. Other archives remain excluded;
// retaining this exact transport file is required by the production HDR loader.
const compressedPublicAssets=new Set(['public/media/environment/blue-lagoon-1k.hdr.gz']);
// Only these reviewed, script-free offline documents belong in the release.
// Do not broaden the source allowlist to accept arbitrary HTML files.
const publicOfflineDocuments=new Set(['fa','en','tr','ar','ru'].map(locale=>`public/offline/${locale}.html`));
// Script-free role manuals are intentionally public help pages. Their images
// use dedicated educational accounts and contain no customer or secret data.
const manualRoles=['superAdmin','admin','contentEditor','productManager','scientificReviewer','translator','publisher','hr','business','analyst','support','customer'];
const publicRoleManuals=new Set(['index',...manualRoles].map(role=>`public/manuals/${role}.html`));
required.push(...testMediaFixtures,...compressedPublicAssets,...publicOfflineDocuments,...publicRoleManuals,'public/manuals/style.css',...manualRoles.flatMap(role=>[`public/manuals/assets/${role}-overview.png`,`public/manuals/assets/${role}-workspace.png`,`docs/role-guides/${role}.fa.md`]),'docs/EXPANSION-SPEC-2.2.fa.md','docs/IMPLEMENTATION-PLAN-2.2.fa.md','docs/INSTALL-SERVICES-SEO-2.2.fa.md','docs/START-HERE-2.2.0.fa.md','docs/VERIFICATION-2.2.0.fa.md');
const byteLimit=512*1024*1024,fileLimit=100*1024*1024;
const findings=[];
let excluded=0,totalBytes=0;
const toPosix=value=>value.split(sep).join('/');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const credentials=[
  ['Google API credential',/AIza[0-9A-Za-z_-]{20,}/g],
  ['AQ provider credential',/AQ\.[0-9A-Za-z._-]{20,}/g],
  ['AI provider credential',/sk-(?:(?:or-v1|proj|ant-api\d+)-)?[0-9A-Za-z_-]{20,}/g],
  ['Private key',/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g],
  ['GitHub credential',/(?:gh[pousr]_[0-9A-Za-z]{25,}|github_pat_[0-9A-Za-z_]{25,})/g],
  ['Cloud access key',/(?:AKIA|ASIA)[0-9A-Z]{16}/g],
  ['Telegram bot credential',/\b[0-9]{8,12}:[0-9A-Za-z_-]{30,}\b/g],
];
function excludedPath(path) {
  const parts=path.split('/'),name=parts.at(-1);
  return parts.some(part=>excludedParts.has(part))||excludedNames.has(name)||name.startsWith('.env.')&&name!=='.env.example'||(forbiddenExtensions.has(extname(name).toLowerCase())&&!compressedPublicAssets.has(path))||name.endsWith('.sql.gz')||name==='idealmakoo-source.zip';
}
function scan(path,bytes) {
  const content=bytes.toString('utf8');
  for(const [label,pattern] of credentials) {
    pattern.lastIndex=0;
    if(pattern.test(content))findings.push({file:path,reason:label});
  }
  if(path==='.env.example')for(const line of content.split('\n')) {
    const match=/^([A-Z][A-Z0-9_]*(?:SECRET|PASSWORD|API_KEY|BOT_TOKEN|ENCRYPTION_KEY))=(.*)$/.exec(line);
    if(match&&match[2].trim()&&!['\'\'','""'].includes(match[2].trim()))findings.push({file:path,reason:'Environment examples must not contain a populated secret'});
  }
  // Connection examples may use placeholders or explicitly ephemeral CI fixtures.
  const databaseUrl=/(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s/@:]+:([^\s/@]+)@/g;
  for(const match of content.matchAll(databaseUrl)) {
    const value=match[1];
    const expression=/^(?:\$\{[a-zA-Z_][a-zA-Z0-9_]*\}|\$[a-zA-Z_][a-zA-Z0-9_]*|\{[a-zA-Z_][a-zA-Z0-9_]*\})$/.test(value);
    const placeholder=/^<[A-Z0-9_]+>$/.test(value)||['CHANGE_ME','YOUR_PASSWORD','PLACEHOLDER','REDACTED'].includes(value);
    const fixture=/^(?:ci_only_|test[_-]|TEST_)/.test(value)&&(/^(?:tests|\.github)\//.test(path));
    if(expression||placeholder||fixture)continue;
    findings.push({file:path,reason:'Embedded database password'});break;
  }
}
const files=new Map();
async function collect(path) {
  if(excludedPath(path)){excluded++;return;}
  const absolute=join(root,...path.split('/')),stat=await lstat(absolute);
  if(stat.isSymbolicLink())throw new Error(`Release allowlist refuses symbolic links: ${path}`);
  if(stat.isDirectory()) {
    for(const entry of (await readdir(absolute)).sort())await collect(`${path}/${entry}`);
    return;
  }
  if(!stat.isFile()||stat.nlink>1)throw new Error(`Release allowlist refuses non-regular or multiply linked files: ${path}`);
  if(path.split('/').some(part=>['..','.','__proto__','constructor','prototype'].includes(part)))throw new Error(`Unsafe archive path: ${path}`);
  const name=basename(path),extensions=path.startsWith('public/')?assetExtensions:sourceExtensions;
  if(!rootFiles.includes(path)&&!testMediaFixtures.has(path)&&!compressedPublicAssets.has(path)&&!publicOfflineDocuments.has(path)&&!publicRoleManuals.has(path)&&!['Dockerfile','Caddyfile','LICENSE','NOTICE'].includes(name)&&!extensions.has(extname(name).toLowerCase()))throw new Error(`Review this unsupported release file type before packaging: ${path}`);
  if(stat.size>fileLimit||totalBytes+stat.size>byteLimit)throw new Error('Release exceeds the reviewed source/media size limit.');
  const bytes=await readFile(absolute),after=await lstat(absolute);
  if(bytes.length!==stat.size||after.mtimeMs!==stat.mtimeMs||after.ino!==stat.ino)throw new Error(`A release file changed while packaging: ${path}. Retry after edits finish.`);
  scan(path,bytes);totalBytes+=bytes.length;files.set(path,bytes);
}
async function optionalRoot(path) {
  try {await lstat(join(root,path));}catch(error){if(error.code==='ENOENT')return;throw error;}
  await collect(path);
}
for(const directory of roots)await optionalRoot(directory);
for(const path of rootFiles)await optionalRoot(path);
// A reviewed Compose override is part of the deployment, regardless of its suffix.
for(const path of (await readdir(root)).filter(name=>/^compose\.[a-zA-Z0-9_-]+\.ya?ml$/.test(name)).sort())await collect(path);
for(const path of required)if(!files.has(path))throw new Error(`Required production file is missing: ${path}`);
if(findings.length) {
  for(const item of findings)console.error(`Packaging blocked: ${item.reason} in ${item.file}`);
  throw new Error(`The source release contains ${findings.length} potential credential findings. Values were not printed. Remove them before packaging.`);
}
const pkg=JSON.parse(files.get('package.json').toString('utf8'));
if(!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pkg.version))throw new Error('Invalid release version.');
const releaseName=`idealmakoo-production-${pkg.version}`,prefix=`${releaseName}/`;
const epoch=process.env.SOURCE_DATE_EPOCH;
const generatedAt=epoch===undefined?new Date():new Date(Number(epoch)*1000);
if(!Number.isFinite(generatedAt.valueOf())||generatedAt.valueOf()<Date.UTC(1980,0,1)||generatedAt.getUTCFullYear()>2107)throw new Error('SOURCE_DATE_EPOCH must describe a valid ZIP timestamp from 1980 through 2107.');
const entries=[...files.entries()].sort(([a],[b])=>a.localeCompare(b,'en'));
const manifest={format:1,project:pkg.name,version:pkg.version,generatedAt:generatedAt.toISOString(),fileCount:entries.length,uncompressedBytes:totalBytes,archiveRoot:prefix,includes:roots,credentialScan:'passed',verification:'See the included production verification and coverage documents; packaging does not execute deployment or application tests.',files:Object.fromEntries(entries.map(([path,bytes])=>[path,{sha256:sha256(bytes),bytes:bytes.length}]))};
const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
const sums=Buffer.from([...entries.map(([path,bytes])=>`${sha256(bytes)}  ${path}`),`${sha256(manifestBytes)}  RELEASE-MANIFEST.json`].join('\n')+'\n');
if(checkOnly) {
  console.log(JSON.stringify({check:'passed',files:entries.length,uncompressedBytes:totalBytes,excluded,credentialFindings:0,archiveRoot:prefix}));
  process.exit(0);
}
const output=resolve(root,'../deliverables');
const outputRelative=relative(root,output);
if(!outputRelative.startsWith(`..${sep}`))throw new Error('Release output must remain outside the application project.');
await mkdir(output,{recursive:true,mode:0o700});await chmod(output,0o700);
if(await realpath(output)!==output)throw new Error('Release output cannot be a symlink.');
const zipEntries=Object.create(null);
for(const [path,bytes] of [...entries,['RELEASE-MANIFEST.json',manifestBytes],['SHA256SUMS',sums]]) {
  const executable=path.endsWith('.sh');
  zipEntries[prefix+path]=[bytes,{mtime:generatedAt,os:3,attrs:((executable?0o100755:0o100644)<<16)>>>0,level:compressedPublicAssets.has(path)||(assetExtensions.has(extname(path).toLowerCase())&&!sourceExtensions.has(extname(path).toLowerCase()))?0:6}];
}
const archive=zipSync(zipEntries),reopened=unzipSync(archive);
if(Object.keys(reopened).length!==entries.length+2)throw new Error('ZIP verification found an unexpected entry count.');
for(const [path,bytes] of entries)if(sha256(reopened[prefix+path]??Buffer.alloc(0))!==sha256(bytes))throw new Error(`ZIP verification failed for ${path}`);
if(sha256(reopened[prefix+'RELEASE-MANIFEST.json'])!==sha256(manifestBytes)||sha256(reopened[prefix+'SHA256SUMS'])!==sha256(sums))throw new Error('ZIP manifest verification failed.');
const archiveName=`${releaseName}.zip`,archivePath=join(output,archiveName),digest=sha256(archive),temporary=`${archivePath}.partial-${process.pid}`;
try {
  await writeFile(temporary,archive,{mode:0o600,flag:'wx'});await rename(temporary,archivePath);
  await writeFile(`${archivePath}.sha256`,`${digest}  ${archiveName}\n`,{mode:0o600});
  await writeFile(join(output,`${releaseName}.manifest.json`),JSON.stringify({...manifest,archiveSha256:digest,archiveBytes:archive.length},null,2)+'\n',{mode:0o600});
}finally{await rm(temporary,{force:true});}
console.log(JSON.stringify({archive:archivePath,sha256:digest,bytes:archive.length,files:entries.length+2,credentialFindings:0,verified:'every ZIP entry checksum matched'}));
