import { assert } from './types';

/** Runtime receives only the mode. The secret account roster belongs to the
 * owner/provisioning process, never to web or worker containers. */
export function staffProvisioningMode(): 'env' | 'hybrid' | 'panel' {
  const mode=process.env.STAFF_PROVISIONING_MODE || (process.env.NODE_ENV==='production'?'hybrid':'panel');
  assert(mode==='env'||mode==='hybrid'||mode==='panel',503,'STAFF_CONFIG','STAFF_PROVISIONING_MODE must be env, hybrid or panel.');
  return mode;
}
export function assertPanelStaffProvisioning() {
  assert(staffProvisioningMode()!=='env',403,'STAFF_ENV_MANAGED','Staff credentials and permissions are managed by the protected server environment in env mode. Use hybrid mode for authorized panel management, or run the owner provisioning command.');
}
