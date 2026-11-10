import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs } from './helpers/load-ts.mjs';

const {
  AVATAR_MAX_BYTES, AVATAR_INPUT_MAX_BYTES, AVATAR_MAX_PIXELS, AVATAR_OUTPUT_SIZE,
  AvatarError, DEFAULT_AVATAR_CROP, inspectAvatarImage, normalizeAvatarSource,
  validateAvatarFile, calculateAvatarCrop, decodeAvatar,
} = await loadTs('src/lib/avatar.ts');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5xkAAAAASUVORK5CYII=';
const pngBytes = Buffer.from(png.split(',')[1], 'base64');
// Tiny synthetic colour fixtures, encoded with a raster encoder, not container
// headers with an invented compressed payload.
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDgqKKK+oPlj//Z';
const webp = 'data:image/webp;base64,UklGRjgAAABXRUJQVlA4ICwAAADwAQCdASoCAAMAAUAmJaACdLoB+AAF9AAA/vFNr/xu3GG/Bd/5BerfNsaAAA==';
const asPng = bytes => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;

function withDimensions(width, height) {
  const image = Buffer.from(pngBytes);
  image.writeUInt32BE(width, 16); image.writeUInt32BE(height, 20);
  return image;
}
function chunk(kind, data) {
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0); result.write(kind, 4); data.copy(result, 8);
  return result;
}
const expectIssue = code => error => error instanceof AvatarError && error.code === code;

test('saved avatars accept a small static PNG and inspect its declared dimensions', () => {
  assert.deepEqual(inspectAvatarImage(pngBytes), { type: 'image/png', width: 1, height: 1 });
  assert.equal(normalizeAvatarSource(png), png);
  assert.equal(AVATAR_OUTPUT_SIZE, 512);
  assert.equal(AVATAR_MAX_BYTES, 192 * 1024);
});

test('real JPEG and WebP rasters are accepted only under their matching MIME type', () => {
  for (const [value, type] of [[jpeg, 'image/jpeg'], [webp, 'image/webp']]) {
    const bytes = Buffer.from(value.split(',')[1], 'base64');
    assert.deepEqual(inspectAvatarImage(bytes), { type, width: 2, height: 3 });
    assert.equal(normalizeAvatarSource(value), value);
    assert.equal(validateAvatarFile({ size: bytes.length, type }, bytes).type, type);
    assert.equal(normalizeAvatarSource(value.replace(type, 'image/png')), null);
    assert.equal(inspectAvatarImage(bytes.subarray(0, bytes.length - 2)), null, 'truncated containers fail closed');
  }
});

test('active, remote, renamed and malformed payloads cannot become saved avatars', () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>').toString('base64');
  for (const value of [
    'https://example.test/avatar.png', '/media/brand/logo-transparent.png', 'javascript:alert(1)',
    `data:image/svg+xml;base64,${svg}`, `data:image/png;base64,${svg}`,
    png.replace('image/png', 'image/jpeg'), png.replace('image/png', 'image/webp'),
    png.replace(';base64,', ';charset=utf-8;base64,'), `${png}\n`, `${png.slice(0, -1)}%`,
    'data:image/png;base64,iVBORw0KGgo=', asPng(Buffer.concat([pngBytes, Buffer.from('<script/>')])),
  ]) assert.equal(normalizeAvatarSource(value), null, value.slice(0, 80));
});

test('stored raster dimensions and encoded byte limits are checked before display', () => {
  assert.equal(normalizeAvatarSource(asPng(withDimensions(513, 1))), null);
  assert.equal(normalizeAvatarSource(asPng(withDimensions(1, 513))), null);
  assert.equal(normalizeAvatarSource(asPng(withDimensions(0, 1))), null);
  const oversize = Buffer.alloc(AVATAR_MAX_BYTES + 1);
  pngBytes.copy(oversize);
  assert.equal(normalizeAvatarSource(asPng(oversize)), null);
});

test('APNG animation control chunks are rejected instead of persisting moving profile images', () => {
  const animated = Buffer.concat([pngBytes.subarray(0, 33), chunk('acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])), pngBytes.subarray(33)]);
  assert.equal(inspectAvatarImage(animated), null);
  assert.equal(normalizeAvatarSource(asPng(animated)), null);
});

test('WebP animation flags are rejected even when the file also contains a static frame', () => {
  const original = Buffer.from(webp.split(',')[1], 'base64');
  const extended = Buffer.alloc(18);
  extended.write('VP8X', 0); extended.writeUInt32LE(10, 4);
  extended[8] = 2; extended[12] = 1; extended[15] = 2;
  const animated = Buffer.concat([original.subarray(0, 12), extended, original.subarray(12)]);
  animated.writeUInt32LE(animated.length - 8, 4);
  assert.equal(inspectAvatarImage(animated), null);
});

test('uploads enforce the 8 MiB cap, accepted raster MIME types and matching file signatures', () => {
  assert.equal(validateAvatarFile({ size: AVATAR_INPUT_MAX_BYTES, type: 'image/png' }), null);
  assert.throws(() => validateAvatarFile({ size: AVATAR_INPUT_MAX_BYTES + 1, type: 'image/png' }), expectIssue('size'));
  assert.throws(() => validateAvatarFile({ size: 0, type: 'image/png' }), expectIssue('size'));
  assert.throws(() => validateAvatarFile({ size: pngBytes.length, type: 'image/svg+xml' }, pngBytes), expectIssue('type'));
  assert.throws(() => validateAvatarFile({ size: pngBytes.length, type: 'image/jpeg' }, pngBytes), expectIssue('type'));
  assert.throws(() => validateAvatarFile({ size: pngBytes.length + 1, type: 'image/png' }, pngBytes), expectIssue('decode'));
  assert.equal(validateAvatarFile({ size: pngBytes.length, type: '' }, pngBytes).type, 'image/png', 'a file without a MIME label is identified by its actual raster signature');
});

test('large compressed image headers are rejected before a browser decoder allocates pixels', () => {
  const atLimit = withDimensions(8000, 4000), tooLarge = withDimensions(8001, 4000);
  assert.equal(8000 * 4000, AVATAR_MAX_PIXELS);
  assert.equal(validateAvatarFile({ size: atLimit.length, type: 'image/png' }, atLimit).width, 8000);
  assert.throws(() => validateAvatarFile({ size: tooLarge.length, type: 'image/png' }, tooLarge), expectIssue('dimensions'));
});

test('cover crop fills the square at all pan extremes, zoom levels and quarter-turn rotations', () => {
  for (const [width, height] of [[1200, 800], [800, 1200], [512, 512], [640, 3200]]) {
    for (const rotation of [0, 90, 180, 270]) for (const zoom of [1, 1.5, 3]) for (const offsetX of [-1, 0, 1]) for (const offsetY of [-1, 0, 1]) {
      const crop = calculateAvatarCrop(width, height, { zoom, offsetX, offsetY, rotation });
      assert.ok(crop.centerX - crop.rotatedWidth / 2 <= 1e-8);
      assert.ok(crop.centerY - crop.rotatedHeight / 2 <= 1e-8);
      assert.ok(crop.centerX + crop.rotatedWidth / 2 >= 512 - 1e-8);
      assert.ok(crop.centerY + crop.rotatedHeight / 2 >= 512 - 1e-8);
      if (offsetX > 0) assert.ok(crop.centerX >= 256, 'positive offset moves the image right');
      if (offsetY > 0) assert.ok(crop.centerY >= 256, 'positive offset moves the image down');
    }
  }
});

test('the smaller editor preview has exactly the same composition as the exported avatar', () => {
  const options = { zoom: 2.3, offsetX: 0.75, offsetY: -0.6, rotation: 90 };
  const full = calculateAvatarCrop(1600, 900, options, 512);
  const preview = calculateAvatarCrop(1600, 900, options, 300);
  for (const key of ['centerX', 'centerY', 'drawWidth', 'drawHeight', 'rotatedWidth', 'rotatedHeight', 'maxOffsetX', 'maxOffsetY']) assert.ok(Math.abs(preview[key] / 300 - full[key] / 512) < 1e-9, key);
  assert.equal(preview.radians, full.radians);
});

test('invalid crop geometry cannot produce an empty image or unbounded canvas', () => {
  for (const options of [
    { ...DEFAULT_AVATAR_CROP, zoom: 0.9 }, { ...DEFAULT_AVATAR_CROP, zoom: 3.1 },
    { ...DEFAULT_AVATAR_CROP, offsetX: NaN }, { ...DEFAULT_AVATAR_CROP, offsetY: 1.01 },
    { ...DEFAULT_AVATAR_CROP, rotation: 45 },
  ]) assert.throws(() => calculateAvatarCrop(100, 200, options), expectIssue('crop'));
  assert.throws(() => calculateAvatarCrop(0, 200, DEFAULT_AVATAR_CROP), expectIssue('dimensions'));
  assert.throws(() => calculateAvatarCrop(100, 200, DEFAULT_AVATAR_CROP, 10000), expectIssue('crop'));
});

test('browser decoding applies photo orientation and releases both the bitmap and object URL', async t => {
  const names = ['window', 'createImageBitmap'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const seen = [], released = [];
  let closed = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
  Object.defineProperty(globalThis, 'createImageBitmap', { configurable: true, value: async (_file, options) => {
    seen.push(options);
    return { width: 200, height: 100, close: () => { closed++; } };
  } });
  URL.createObjectURL = () => 'blob:avatar-local-test';
  URL.revokeObjectURL = url => { released.push(url); };
  t.after(() => {
    for (const name of names) { const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  });
  const avatar = await decodeAvatar(new File([pngBytes], 'photo.png', { type: 'image/png' }));
  assert.deepEqual(seen, [{ imageOrientation: 'from-image' }]);
  assert.equal(avatar.width, 200);
  assert.equal(avatar.height, 100);
  assert.equal(avatar.previewUrl, 'blob:avatar-local-test');
  avatar.dispose(); avatar.dispose();
  assert.equal(closed, 1);
  assert.deepEqual(released, ['blob:avatar-local-test']);
  assert.throws(() => avatar.source, expectIssue('decode'));
});
