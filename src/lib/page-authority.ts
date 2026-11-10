import {canWorkspace} from './auth';

/** These published routes explain the site's privacy/consent contract. Their
 * text is editable by administrators, with the ordinary review/release flow. */
export function isProtectedSitePage(slug:string):boolean {
  const path=slug.replace(/^\/+|\/+$/g,'').replace(/^(?:fa|en|tr|ar|ru)\//i,'').toLowerCase();
  return path==='privacy'||path==='terms';
}
export function canManageSitePage(role:string,slug:string):boolean {
  return !isProtectedSitePage(slug)||['admin','superAdmin'].includes(role)&&canWorkspace(role,'manage','settings');
}
