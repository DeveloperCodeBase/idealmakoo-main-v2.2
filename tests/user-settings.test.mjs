import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const {
  defaultUserSettings, parseUserSettings, readUserSettings, updateOwnUserSettings,
  validateUserSettingsPatch, userSettingsKey, USER_PROFILE_LIMITS, USER_SESSION_KEY,
} = await loadTs('src/lib/user-settings.ts');
const { demoUsers } = await loadTs('src/lib/auth.ts');

const alice = { id: 'local-alice@example.test', name: 'Alice Example', email: 'alice@example.test', role: 'customer', demo: true };
const bob = { id: 'local-bob@example.test', name: 'Bob Example', email: 'bob@example.test', role: 'productManager', demo: true };
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=';

function localPreview(t, session = alice, language = 'en') {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const values = new Map(), events = [];
  const window = new EventTarget();
  window.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  window.addEventListener('idealmakoo:store', event => events.push(event.detail.key));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: { lang: language } } });
  if (session) values.set(USER_SESSION_KEY, JSON.stringify(session));
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
  });
  return { window, values, events, activate: value => value ? values.set(USER_SESSION_KEY, JSON.stringify(value)) : values.delete(USER_SESSION_KEY) };
}

test('personal defaults use the active language and do not inherit another user’s global appearance', t => {
  const { values } = localPreview(t);
  values.set('idealmakoo.theme', 'light');
  values.set('idealmakoo.locale', 'ru');
  for (const locale of ['fa', 'en', 'tr', 'ar', 'ru']) {
    const settings = readUserSettings(alice, locale);
    assert.equal(settings.ownerId, alice.id);
    assert.equal(settings.profile.name, alice.name);
    assert.equal(settings.profile.contactEmail, alice.email);
    assert.equal(settings.profile.avatar, null);
    assert.equal(settings.preferences.language, locale);
    assert.equal(settings.preferences.theme, 'dark');
    assert.equal(settings.revision, 0);
    assert.equal(settings.updatedAt, '');
  }
  assert.equal(values.has(userSettingsKey(alice.id)), false, 'visiting settings does not silently write a record');
  assert.equal(userSettingsKey('local-a+b@example.test'), 'idealmakoo.user-settings.local-a%2Bb%40example.test.v1');
});

test('every actual factory role can save its own profile without acquiring another role or global permissions', t => {
  const { values, activate } = localPreview(t);
  for (const user of demoUsers) {
    const session = { id: user.id, name: user.name, email: user.email, role: user.role, demo: true };
    activate(session);
    const before = values.get(USER_SESSION_KEY);
    const result = updateOwnUserSettings(session, 'profile', { name: `Profile ${user.role}`, organization: 'Own laboratory' }, 0);
    assert.equal(result.ok, true, user.role);
    assert.equal(result.settings.ownerId, user.id);
    assert.equal(result.settings.profile.name, `Profile ${user.role}`);
    assert.equal(values.get(USER_SESSION_KEY), before, 'profile writes never change authentication identity');
    assert.equal(Object.hasOwn(result.settings.profile, 'role'), false);
    assert.equal(result.settings.profile.contactEmail, '', 'demo addresses are not advertised as real contact addresses');
  }
});

test('profile and preferences persist under one owner and broadcast a same-tab update only after success', t => {
  const { values, events } = localPreview(t);
  const profile = updateOwnUserSettings(alice, 'profile', { name: '  آلیسِ نمونه  ', phone: '+۹۸ (۹۱۲) ۱۲۳-۴۵۶۷', avatar: png, bio: 'Dental technician\nMaterials research' }, 0);
  assert.equal(profile.ok, true);
  assert.equal(profile.settings.profile.name, 'آلیسِ نمونه');
  assert.equal(profile.settings.profile.phone, '+۹۸ (۹۱۲) ۱۲۳-۴۵۶۷');
  assert.equal(profile.settings.profile.bio, 'Dental technician\nMaterials research');
  assert.equal(profile.settings.profile.avatar, png);
  assert.ok(Number.isFinite(Date.parse(profile.settings.updatedAt)));
  assert.deepEqual(events, [userSettingsKey(alice.id)]);
  const preferences = updateOwnUserSettings(alice, 'preferences', { theme: 'system', language: 'ru', density: 'compact', sidebar: 'collapsed' }, profile.settings.revision);
  assert.equal(preferences.ok, true);
  assert.deepEqual(preferences.settings.profile, profile.settings.profile);
  assert.equal(preferences.settings.preferences.theme, 'system');
  assert.equal(preferences.settings.preferences.language, 'ru');
  assert.equal(preferences.settings.preferences.sidebar, 'collapsed');
  assert.equal(preferences.settings.revision, 2);
  assert.deepEqual(JSON.parse(values.get(userSettingsKey(alice.id))), preferences.settings);
  assert.deepEqual(readUserSettings(alice, 'en'), preferences.settings);
});

test('a stale component cannot read or save a prior user after a different user signs in', t => {
  const { values, activate } = localPreview(t);
  const saved = updateOwnUserSettings(alice, 'profile', { bio: 'Alice private biography', avatar: png }, 0);
  assert.equal(saved.ok, true);
  const aliceRaw = values.get(userSettingsKey(alice.id));
  activate(bob);
  assert.equal(readUserSettings(alice, 'en').profile.bio, '');
  assert.equal(readUserSettings(alice, 'en').profile.avatar, null);
  assert.equal(readUserSettings(bob, 'en').profile.name, bob.name);
  assert.deepEqual(updateOwnUserSettings(alice, 'profile', { name: 'Stale tab' }, 1), { ok: false, reason: 'session' });
  const bobSaved = updateOwnUserSettings(bob, 'preferences', { theme: 'light' }, 0);
  assert.equal(bobSaved.ok, true);
  assert.equal(bobSaved.settings.profile.bio, '');
  assert.equal(values.get(userSettingsKey(alice.id)), aliceRaw);
  activate(alice);
  assert.equal(readUserSettings(alice, 'en').profile.bio, 'Alice private biography');
  assert.equal(readUserSettings(alice, 'en').preferences.theme, 'dark');
});

test('sign-out, changed role, changed login identity and changed session kind reject stale saves', t => {
  const { activate } = localPreview(t);
  for (const current of [null, { ...alice, role: 'admin' }, { ...alice, email: 'someone@example.test' }, { ...alice, demo: false }, { ...alice, role: 'unknown' }]) {
    activate(current);
    assert.deepEqual(updateOwnUserSettings(alice, 'preferences', { theme: 'light' }, 0), { ok: false, reason: 'session' });
  }
  activate({ ...alice, name: 'Updated display name' });
  assert.equal(updateOwnUserSettings(alice, 'profile', { city: 'Maku' }, 0).ok, true, 'display-name synchronization is not a role or login identity change');
});

test('login identity, role and another owner cannot be smuggled into a profile patch', t => {
  const { values } = localPreview(t);
  const sessionBefore = values.get(USER_SESSION_KEY);
  for (const [key, value] of [['role', 'superAdmin'], ['id', bob.id], ['ownerId', bob.id], ['email', bob.email], ['password', 'unexpected'], ['permissions', ['manage']]]) {
    const result = updateOwnUserSettings(alice, 'profile', { name: 'Legitimate name', [key]: value }, 0);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'validation');
  }
  assert.equal(values.get(USER_SESSION_KEY), sessionBefore);
  assert.equal(values.has(userSettingsKey(alice.id)), false);
  assert.equal(values.has(userSettingsKey(bob.id)), false);
});

test('the profile exposes a separate contact email without changing the sign-in email', t => {
  const { values } = localPreview(t);
  const result = updateOwnUserSettings(alice, 'profile', { contactEmail: 'office@example.test', website: 'https://example.test/lab' }, 0);
  assert.equal(result.ok, true);
  assert.equal(result.settings.profile.contactEmail, 'office@example.test');
  assert.equal(result.settings.profile.website, 'https://example.test/lab');
  assert.equal(JSON.parse(values.get(USER_SESSION_KEY)).email, alice.email);
});

test('legacy profiles migrate only for the owner and retain language and timezone on the first deliberate save', t => {
  const { values, activate } = localPreview(t);
  const legacyKey = `idealmakoo.account.${alice.id}.profile.v1`;
  const legacy = { name: 'Previous profile name', phone: '٠٩١٢ ١٢٣ ٤٥٦٧', organization: 'Dental Lab', profession: 'Technician', timezone: 'Europe/Istanbul', language: 'tr', role: 'superAdmin' };
  values.set(legacyKey, JSON.stringify(legacy));
  values.set('idealmakoo.theme', 'light');
  const migrated = readUserSettings(alice, 'en');
  assert.equal(migrated.profile.name, legacy.name);
  assert.equal(migrated.profile.organization, legacy.organization);
  assert.equal(migrated.preferences.language, 'tr');
  assert.equal(migrated.preferences.timezone, 'Europe/Istanbul');
  assert.equal(migrated.preferences.theme, 'dark');
  assert.equal(migrated.revision, 0);
  assert.equal(values.has(userSettingsKey(alice.id)), false);
  const result = updateOwnUserSettings(alice, 'preferences', { effects: false }, 0);
  assert.equal(result.ok, true);
  assert.equal(result.settings.profile.name, legacy.name);
  assert.equal(result.settings.preferences.language, 'tr');
  assert.equal(result.settings.preferences.effects, false);
  assert.equal(values.get(legacyKey), JSON.stringify(legacy), 'migration preserves the original record for rollback');
  activate(bob);
  assert.equal(readUserSettings(bob, 'en').profile.organization, '');
  assert.equal(readUserSettings(bob, 'en').preferences.language, 'en');
});

test('malformed records are bounded and an invalid field does not erase other valid own profile fields', t => {
  const { values } = localPreview(t);
  for (const raw of ['{broken', 'null', '[]', '"string"', JSON.stringify({ version: 999 }), ' '.repeat(400001)]) {
    values.set(userSettingsKey(alice.id), raw);
    assert.deepEqual(readUserSettings(alice, 'en'), defaultUserSettings(alice, 'en'));
  }
  const corrupt = defaultUserSettings(alice, 'en');
  corrupt.revision = 4;
  corrupt.profile.organization = 'Preserved laboratory';
  corrupt.profile.name = 'A'.repeat(USER_PROFILE_LIMITS.name + 40);
  corrupt.profile.avatar = 'data:image/svg+xml,<svg onload="alert(1)"/>';
  corrupt.profile.website = 'javascript:alert(1)';
  corrupt.profile.contactEmail = 'broken';
  corrupt.preferences.timezone = '../invalid';
  corrupt.preferences.theme = 'neon-admin';
  values.set(userSettingsKey(alice.id), JSON.stringify(corrupt));
  const read = readUserSettings(alice, 'en');
  assert.equal(read.profile.organization, 'Preserved laboratory');
  assert.equal(read.profile.name.length, USER_PROFILE_LIMITS.name);
  assert.equal(read.profile.avatar, null);
  assert.equal(read.profile.website, '');
  assert.equal(read.profile.contactEmail, alice.email);
  assert.equal(read.preferences.timezone, 'Asia/Tehran');
  assert.equal(read.preferences.theme, 'dark');
  assert.equal(read.revision, 4);
});

test('an owner mismatch never imports a different person’s serialized profile even under the current owner’s key', t => {
  const { values } = localPreview(t);
  const other = defaultUserSettings(bob, 'ru');
  other.profile.bio = 'Other person private details';
  other.profile.avatar = png;
  other.preferences.theme = 'light';
  values.set(userSettingsKey(alice.id), JSON.stringify(other));
  assert.deepEqual(readUserSettings(alice, 'en'), defaultUserSettings(alice, 'en'));
  assert.deepEqual(parseUserSettings(other, alice, 'en'), defaultUserSettings(alice, 'en'));
});

test('optimistic revision checks preserve edits made by another tab and the untouched section', t => {
  localPreview(t);
  const firstDraft = readUserSettings(alice, 'en'), secondDraft = readUserSettings(alice, 'en');
  const first = updateOwnUserSettings(alice, 'preferences', { theme: 'light', fontSize: 'large' }, firstDraft.revision);
  assert.equal(first.ok, true);
  const stale = updateOwnUserSettings(alice, 'profile', { name: 'Profile from another tab' }, secondDraft.revision);
  assert.deepEqual(stale, { ok: false, reason: 'conflict' });
  const refreshed = readUserSettings(alice, 'en');
  const retry = updateOwnUserSettings(alice, 'profile', { name: 'Profile from another tab' }, refreshed.revision);
  assert.equal(retry.ok, true);
  assert.deepEqual(retry.settings.preferences, first.settings.preferences);
  assert.equal(retry.settings.revision, 2);
});

test('unchanged normalized saves do not create noisy revisions or store events', t => {
  const { events, values } = localPreview(t);
  const current = updateOwnUserSettings(alice, 'profile', { city: 'Maku' }, 0);
  assert.equal(current.ok, true);
  const raw = values.get(userSettingsKey(alice.id));
  const same = updateOwnUserSettings(alice, 'profile', { city: '  Maku  ' }, current.settings.revision);
  assert.equal(same.ok, true);
  assert.equal(same.settings.revision, 1);
  assert.equal(values.get(userSettingsKey(alice.id)), raw);
  assert.equal(events.length, 1);
});

test('avatar removal is explicit and does not clear other profile details', t => {
  localPreview(t);
  const first = updateOwnUserSettings(alice, 'profile', { avatar: png, organization: 'Dental studio' }, 0);
  assert.equal(first.ok, true);
  const removed = updateOwnUserSettings(alice, 'profile', { avatar: null }, first.settings.revision);
  assert.equal(removed.ok, true);
  assert.equal(removed.settings.profile.avatar, null);
  assert.equal(removed.settings.profile.organization, 'Dental studio');
});

test('field validation catches invalid email, website schemes, phones, limits and preference values before writes', t => {
  const { values } = localPreview(t);
  const profileCases = [
    [{ name: 'A' }, 'profile.name'], [{ name: 'A'.repeat(101) }, 'profile.name'],
    [{ phone: '+abcd123' }, 'profile.phone'], [{ phone: '----' }, 'profile.phone'],
    [{ bio: 'a'.repeat(601) }, 'profile.bio'], [{ contactEmail: 'a b@example.test' }, 'profile.contactEmail'],
    [{ website: 'javascript:alert(1)' }, 'profile.website'], [{ website: 'https://user:pass@example.test/' }, 'profile.website'],
    [{ avatar: 'https://example.test/avatar.png' }, 'profile.avatar'], [{ avatar: false }, 'profile.avatar'],
  ];
  for (const [patch, issue] of profileCases) {
    const result = updateOwnUserSettings(alice, 'profile', patch, 0);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'validation');
    assert.ok(result.issues.includes(issue), issue);
  }
  for (const [field, value] of [['language', 'de'], ['theme', 'custom'], ['effects', 'false'], ['timezone', 'Mars/Olympus'], ['fontSize', 'huge'], ['density', 'none'], ['sidebar', true], ['motion', 'fast']]) {
    assert.deepEqual(validateUserSettingsPatch('preferences', { [field]: value }), [`preferences.${field}`]);
  }
  assert.deepEqual(validateUserSettingsPatch('profile', { name: '  ‮Alice\u0000  ', phone: '+۹۸ (۹۱۲) ۱۲۳-۴۵۶۷' }), []);
  assert.deepEqual(validateUserSettingsPatch('preferences', { timezone: 'UTC', language: 'ar', effects: false }), []);
  assert.equal(values.has(userSettingsKey(alice.id)), false);
});

test('storage write failure is reported and never announces a saved profile', t => {
  const { values, events, window } = localPreview(t);
  const current = updateOwnUserSettings(alice, 'profile', { city: 'Maku' }, 0);
  assert.equal(current.ok, true);
  const before = values.get(userSettingsKey(alice.id));
  window.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  assert.deepEqual(updateOwnUserSettings(alice, 'profile', { city: 'Tehran' }, 1), { ok: false, reason: 'storage' });
  assert.equal(values.get(userSettingsKey(alice.id)), before);
  assert.equal(events.length, 1);
});

test('a blocked storage read falls back safely and refuses to save', t => {
  const { window } = localPreview(t);
  window.localStorage.getItem = () => { throw new Error('Storage blocked'); };
  assert.deepEqual(readUserSettings(alice, 'en'), defaultUserSettings(alice, 'en'));
  assert.deepEqual(updateOwnUserSettings(alice, 'profile', { city: 'Maku' }, 0), { ok: false, reason: 'storage' });
});
