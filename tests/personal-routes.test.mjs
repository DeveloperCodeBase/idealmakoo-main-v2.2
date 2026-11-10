import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const auth = await loadTs('src/lib/auth.ts');
const { sitePaths, adminSections, publicIndexablePaths } = await loadTs('src/lib/routes.ts');

test('every staff role can use personal profile and site preferences without company-wide powers', () => {
  assert.equal(auth.roles.length, 12);
  for (const role of auth.roles) {
    for (const module of ['profile', 'preferences']) {
      assert.equal(auth.authorize(role, module), role !== 'customer', `${role}: ${module}`);
      for (const action of auth.workspaceActions) {
        const expected = role !== 'customer' && ['view', 'edit', 'export'].includes(action);
        assert.equal(auth.canWorkspace(role, action, module), expected, `${role}: ${action} ${module}`);
      }
    }
    for (const action of ['view', 'edit', 'manage']) {
      assert.equal(auth.canWorkspace(role, action, 'settings'), ['superAdmin', 'admin'].includes(role), `${role}: ${action} company settings`);
    }
    assert.equal(auth.canWorkspace(role, 'manage', 'roles'), role === 'superAdmin', `${role}: role administration`);
  }
});

test('personal workspace routes remain exact and never turn into cross-account or company-settings aliases', () => {
  for (const module of ['profile', 'preferences']) {
    assert.equal(auth.canonicalWorkspaceSection(`/admin/${module}/`), module);
    for (const child of ['another-user', 'all', 'settings', 'delete-all']) {
      for (const role of auth.roles) assert.equal(auth.authorize(role, `${module}/${child}`), false, `${role}: ${module}/${child}`);
    }
    for (const unknown of ['', 'root', 'owner', 'toString', '__proto__']) assert.equal(auth.authorize(unknown, module), false);
  }
  assert.equal(auth.canonicalWorkspaceSection('settings'), 'settings');
  assert.equal(auth.authorize('customer', 'profile'), false);
});

test('the static route inventory includes personal settings for public accounts and staff workspaces', () => {
  for (const path of ['account/profile', 'account/preferences', 'account/settings', 'account/notifications', 'account/security', 'admin/profile', 'admin/preferences']) {
    assert.ok(sitePaths.includes(path), `Missing executable route: ${path}`);
    assert.ok(!publicIndexablePaths.includes(path), `Private account route must not be indexed: ${path}`);
  }
  assert.ok(adminSections.includes('profile'));
  assert.ok(adminSections.includes('preferences'));
});
