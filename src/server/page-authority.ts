import type {PageDraft} from '../data/workspace-seed';
import {canManageSitePage,isProtectedSitePage} from '../lib/page-authority';
import {assert,type Actor} from './types';

/** Call after reloading the account under the workspace lock. Checking both
 * snapshots prevents moving an ordinary page into/out of a protected route. */
export function assertSitePageMutation(actor:Actor,...pages:(Pick<PageDraft,'slug'>|undefined)[]){
  for(const page of pages)if(page&&isProtectedSitePage(page.slug))assert(actor.mfaVerified&&canManageSitePage(actor.role,page.slug),403,'PAGE_ADMIN_REQUIRED','Privacy and terms pages require current administrative settings authority and MFA.');
}
