import test from 'node:test';
import assert from 'node:assert/strict';
import { comparePublicSiteContent } from './proxy-proof-content.mjs';

const encode = value => Buffer.from(JSON.stringify(value));
const snapshot = observedAt => ({ observedAt, version: 1, publications: [],
  preferences: { title: 'Example', observedAt: 'nested-value-must-remain' } });
const first = snapshot('2026-10-25T19:53:38.401Z');
const second = snapshot('2026-10-25T19:53:38.431Z');

test('accepts only the declared public timestamp difference and preserves raw equality truth', () => {
  assert.deepEqual(comparePublicSiteContent(encode(first), encode(second)), {
    rawDecodedBytesEqual: false, bothObservedAtValuesValid: true,
    structuralContentEqualExcludingTopLevelObservedAt: true,
  });
  assert.equal(comparePublicSiteContent(encode(first), encode(first)).rawDecodedBytesEqual, true);
});

test('rejects content, type, missing-field and nested timestamp changes', () => {
  const variants = [
    { ...second, version: 2 },
    { ...second, version: '1' },
    { ...second, publications: [{ slug: 'changed' }] },
    { ...second, preferences: { ...second.preferences, title: 'Changed' } },
    { ...second, preferences: { ...second.preferences, observedAt: 'changed' } },
    { ...second, extraField: true },
    { observedAt: second.observedAt, version: second.version, preferences: second.preferences },
  ];
  for (const variant of variants) {
    const result = comparePublicSiteContent(encode(first), encode(variant));
    assert.equal(result.bothObservedAtValuesValid, true);
    assert.equal(result.structuralContentEqualExcludingTopLevelObservedAt, false);
  }
});

test('requires both exact canonical UTC timestamp values before excluding the field', () => {
  for (const invalid of [undefined, null, 1, {}, '2026-02-30T00:00:00.000Z',
    '2026-10-25T19:53:38Z', '2026-10-25T19:53:38.401+00:00']) {
    for (const [left, right] of [[{ ...first, observedAt: invalid }, second], [first, { ...second, observedAt: invalid }]]) {
      const result = comparePublicSiteContent(encode(left), encode(right));
      assert.equal(result.bothObservedAtValuesValid, false);
      assert.equal(result.structuralContentEqualExcludingTopLevelObservedAt, false);
    }
  }
});
