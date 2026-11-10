import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

// Only checked-in public source imagery is eligible for Next's optimizer.
// User uploads, API resources and remote URLs never enter this manifest.
const root=fileURLToPath(new URL('../',import.meta.url));
const destination=path.join(root,'src/data/public-image-dimensions.json');
const directories=['media/brand','media/documents/previews','media/official'];
const check=process.argv.includes('--check');
if(process.argv.slice(2).some(value=>value!=='--check'))throw new Error('Usage: node scripts/public-image-manifest.mjs [--check]');
async function discover(directory){
 const result=[];
 for(const entry of await fs.readdir(path.join(root,'public',directory),{withFileTypes:true})){
  const relative=path.posix.join(directory,entry.name);
  if(entry.isDirectory())result.push(...await discover(relative));
  else if(entry.isFile()&&/\.(?:png|jpe?g|webp|avif)$/i.test(entry.name))result.push(relative);
 }
 return result;
}
const files=(await Promise.all(directories.map(discover))).flat().sort();
const entries=[];
for(const file of files){
 const metadata=await sharp(path.join(root,'public',file)).metadata();
 if(!metadata.width||!metadata.height)throw new Error(`No intrinsic dimensions: ${file}`);
 entries.push(['/'+file,[metadata.width,metadata.height]]);
}
const content=JSON.stringify(Object.fromEntries(entries),null,2)+'\n';
if(check){
 if(await fs.readFile(destination,'utf8')!==content)throw new Error('Static image dimensions changed. Run node scripts/public-image-manifest.mjs and review the generated manifest.');
 console.log(`Verified ${entries.length} checked-in public image dimensions.`);
}else{
 await fs.writeFile(destination,content);
 console.log(`Wrote ${entries.length} checked-in public image dimensions.`);
}
