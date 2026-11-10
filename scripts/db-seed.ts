import { closeDb } from '../src/server/db';
import { config } from '../src/server/config';
import { getPublicSite, installSourceGlossaryDrafts, installSourcePageDrafts } from '../src/server/workspace';
import { provisionStaffAccounts } from '../src/server/staff-provisioning';
import { initializeStoragePolicy } from '../src/server/storage-policy';

async function main(){
  if(process.env.MIGRATION_DATABASE_URL)process.env.DATABASE_URL=process.env.MIGRATION_DATABASE_URL;
  config();
  console.log(JSON.stringify({staffProvisioning:await provisionStaffAccounts({includeBootstrap:true})}));
  await initializeStoragePolicy();
  await getPublicSite();
  await installSourceGlossaryDrafts();
  console.log(JSON.stringify({sourcePageIntake:await installSourcePageDrafts()}));
  console.log('Production factory content initialized; demo customers and CRM transactions are not seeded.');
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Seed failed');process.exitCode=1;}).finally(closeDb);

