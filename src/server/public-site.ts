import { cache } from 'react';
import { getPublicSite } from './workspace';
import { assertPrivacyReady } from './privacy';

export { publicationPath } from '../lib/publication-path';

/** Share one public snapshot per render after the independent erasure ledger is current. */
export const getServerPublicSite = cache(async () => {
  await assertPrivacyReady();
  return getPublicSite();
});
export function publicOrigin():string{return (process.env.SITE_URL||process.env.NEXT_PUBLIC_SITE_URL||'https://idealmako.ir').replace(/\/+$/,'');}
