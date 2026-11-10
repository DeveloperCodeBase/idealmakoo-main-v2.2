import {provisionStaffAccounts} from '../src/server/staff-provisioning';
import {closeDb} from '../src/server/db';
import {config} from '../src/server/config';

async function main(){
  const args=process.argv.slice(2),flags=new Set(args),usage='Usage: provision-staff.ts [--sync-grants] [--rotate-passwords] [--reactivate=stable-env-key] [--reset-mfa=stable-env-key]';
  if(args.length===1&&args[0]==='--help'){console.log(usage);return;}
  if(args.some(flag=>!['--sync-grants','--rotate-passwords'].includes(flag)&&!/^--(?:reactivate|reset-mfa)=[a-z][a-z0-9_-]{1,63}$/.test(flag))||flags.size!==args.length)throw new Error(usage);
  const reactivateKeys=args.filter(flag=>flag.startsWith('--reactivate=')).map(flag=>flag.slice('--reactivate='.length));
  const resetMfaKeys=args.filter(flag=>flag.startsWith('--reset-mfa=')).map(flag=>flag.slice('--reset-mfa='.length));
  if(!process.env.MIGRATION_DATABASE_URL)throw new Error('MIGRATION_DATABASE_URL must be supplied only to this provisioning process.');
  process.env.DATABASE_URL=process.env.MIGRATION_DATABASE_URL;
  config();
  console.log(JSON.stringify(await provisionStaffAccounts({includeBootstrap:true,syncGrants:flags.has('--sync-grants'),rotatePasswords:flags.has('--rotate-passwords'),reactivateKeys,resetMfaKeys})));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Staff provisioning failed.');process.exitCode=1;}).finally(closeDb);
