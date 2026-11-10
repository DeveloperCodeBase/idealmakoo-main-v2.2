import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {dirname,isAbsolute} from 'node:path';
import {captureRestoreAccess,applyRestoreSecurity,RestoreSecurityError} from './restore-security-lib';
import {config} from '../src/server/config';
import {closeDb} from '../src/server/db';

const maximumBytes=32*1024*1024;
const usage='Usage: restore-security.ts capture --output=/private/access.json | apply [--access=/private/access.json]';
function pathFlag(flag:string,prefix:string){const path=flag.slice(prefix.length);if(!path||!isAbsolute(path)||/[\u0000-\u001f\u007f]/.test(path))throw new Error('A protected absolute snapshot path is required.');return path;}
async function readSnapshot(path:string){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const info=await handle.stat();if(!info.isFile()||info.nlink!==1||(info.mode&0o077)!==0||info.size>maximumBytes)throw new Error('The access snapshot must be a private regular file with one link, mode 0600 and size at most 32 MiB.');return JSON.parse(await handle.readFile('utf8'));}
  finally{await handle.close();}
}
async function main(){
  const args=process.argv.slice(2);if(args.length===1&&args[0]==='--help'){console.log(usage);return;}
  const capture=args[0]==='capture'&&args.length===2&&args[1].startsWith('--output='),apply=args[0]==='apply'&&(args.length===1||args.length===2&&args[1].startsWith('--access='));
  if(!capture&&!apply)throw new Error(usage);
  if(!process.env.MIGRATION_DATABASE_URL)throw new Error('MIGRATION_DATABASE_URL is required only for this owner operation.');
  const database=new URL(process.env.MIGRATION_DATABASE_URL);
  if(process.env.PRIVACY_RESTORE_DATABASE){
    if(!/^idealmakoo_drill_[a-z0-9_]+$/.test(process.env.PRIVACY_RESTORE_DATABASE))throw new Error('Only isolated drill database overrides are allowed.');
    database.pathname='/'+process.env.PRIVACY_RESTORE_DATABASE;
  }
  process.env.DATABASE_URL=database.toString();config();
  if(capture){
    const path=pathFlag(args[1],'--output='),snapshot=await captureRestoreAccess(),body=JSON.stringify(snapshot)+'\n';
    if(Buffer.byteLength(body)>maximumBytes)throw new Error('The access snapshot exceeds the bounded 32 MiB owner-tool format.');
    const handle=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try{await handle.writeFile(body,'utf8');await handle.sync();}finally{await handle.close();}
    const directory=await open(dirname(path),constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
    console.log(JSON.stringify({captureId:snapshot.captureId,capturedAt:snapshot.capturedAt,accounts:snapshot.users.length,groups:snapshot.teams.length+snapshot.territories.length}));
    return;
  }
  const snapshot=args[1]?await readSnapshot(pathFlag(args[1],'--access=')):undefined;
  const result=await applyRestoreSecurity(snapshot);console.log(JSON.stringify(result));
  if(!result.ready){console.error('Restore security was applied, but no active senior administrator remains. Keep application and workers stopped; explicitly rotate/reactivate a reviewed environment staff identity with provision-staff before readiness.');process.exitCode=2;}
}
main().catch(error=>{console.error(error instanceof RestoreSecurityError?error.code+': '+error.message:error instanceof SyntaxError?'The access snapshot contains malformed JSON.':error instanceof Error?error.message:'Restore security failed.');process.exitCode=1;}).finally(closeDb);
