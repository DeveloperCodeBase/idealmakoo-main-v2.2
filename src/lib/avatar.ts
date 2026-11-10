/** Browser-only image decoding is kept outside the profile repository. Uploaded
 * files are decoded locally and re-encoded as a small, static raster image; the
 * original file and its EXIF metadata are never written to the account store. */
export const AVATAR_INPUT_MAX_BYTES = 8 * 1024 * 1024;
export const AVATAR_MAX_BYTES = 192 * 1024;
export const AVATAR_MAX_PIXELS = 32_000_000;
export const AVATAR_OUTPUT_SIZE = 512;

export type AvatarIssue = 'type' | 'size' | 'decode' | 'dimensions' | 'crop' | 'encode';
export class AvatarError extends Error {
  readonly code: AvatarIssue;
  constructor(code: AvatarIssue) {
    super(`avatar.${code}`);
    this.name = 'AvatarError';
    this.code = code;
  }
}

export interface AvatarCrop {
  zoom: number;
  /** Normalized movement within the image's available overhang. */
  offsetX: number;
  offsetY: number;
  rotation: 0 | 90 | 180 | 270;
}
export const DEFAULT_AVATAR_CROP: Readonly<AvatarCrop> = Object.freeze({ zoom: 1, offsetX: 0, offsetY: 0, rotation: 0 });

export interface DecodedAvatar {
  width: number;
  height: number;
  previewUrl: string;
  source: CanvasImageSource;
  dispose(): void;
}
export interface AvatarImageMetadata {
  type: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
}
export interface AvatarCropGeometry {
  size: number;
  scale: number;
  centerX: number;
  centerY: number;
  drawWidth: number;
  drawHeight: number;
  rotatedWidth: number;
  rotatedHeight: number;
  maxOffsetX: number;
  maxOffsetY: number;
  radians: number;
}

const ascii = (bytes: Uint8Array, start: number, length: number) => String.fromCharCode(...bytes.subarray(start, start + length));
const u16be = (bytes: Uint8Array, offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
const u32be = (bytes: Uint8Array, offset: number) => (bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
const u32le = (bytes: Uint8Array, offset: number) => bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + (bytes[offset + 3] * 0x1000000);
const u24le = (bytes: Uint8Array, offset: number) => bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16);
const validDimensions = (width: number, height: number, maxPixels = AVATAR_MAX_PIXELS) => Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0 && width * height <= maxPixels;

/** Check both the signature and the raster container, including animation flags.
 * Decoding remains the browser's job; this inexpensive pass rejects oversized
 * image headers before allocating a decoded image. */
export function inspectAvatarImage(bytes: Uint8Array): AvatarImageMetadata | null {
  if (!(bytes instanceof Uint8Array) || bytes.length < 12) return null;
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) {
    if (bytes.length < 45 || u32be(bytes, 8) !== 13 || ascii(bytes, 12, 4) !== 'IHDR') return null;
    const width = u32be(bytes, 16), height = u32be(bytes, 20);
    if (!width || !height || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) return null;
    let hasData = false, position = 8;
    while (position + 12 <= bytes.length) {
      const length = u32be(bytes, position), kind = ascii(bytes, position + 4, 4);
      if (length > bytes.length - position - 12 || !/^[A-Za-z]{4}$/.test(kind)) return null;
      if (['acTL', 'fcTL', 'fdAT'].includes(kind) || (kind === 'IHDR' && position !== 8)) return null;
      if (kind === 'IDAT' && length > 0) hasData = true;
      position += length + 12;
      if (kind === 'IEND') return length === 0 && hasData && position === bytes.length ? { type: 'image/png', width, height } : null;
    }
    return null;
  }

  if (bytes[0] === 255 && bytes[1] === 216) {
    if (bytes[bytes.length - 2] !== 255 || bytes[bytes.length - 1] !== 217) return null;
    let position = 2, dimensions: { width: number; height: number } | null = null;
    while (position + 1 < bytes.length) {
      if (bytes[position++] !== 255) return null;
      while (bytes[position] === 255) position++;
      const marker = bytes[position++];
      if (marker === 217) return null;
      if (marker === 0 || marker === 216 || marker === undefined) return null;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (position + 2 > bytes.length) return null;
      const length = u16be(bytes, position);
      if (length < 2 || position + length > bytes.length - 2) return null;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 8 || dimensions) return null;
        dimensions = { height: u16be(bytes, position + 3), width: u16be(bytes, position + 5) };
      }
      if (marker === 218) return dimensions?.width && dimensions.height ? { type: 'image/jpeg', ...dimensions } : null;
      position += length;
    }
    return null;
  }

  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP' && u32le(bytes, 4) + 8 === bytes.length) {
    let position = 12, dimensions: { width: number; height: number } | null = null;
    let canvas: { width: number; height: number } | null = null;
    while (position + 8 <= bytes.length) {
      const kind = ascii(bytes, position, 4), length = u32le(bytes, position + 4), start = position + 8;
      if (length > bytes.length - start) return null;
      if (kind === 'ANIM' || kind === 'ANMF') return null;
      if (kind === 'VP8X') {
        if (length !== 10 || canvas || (bytes[start] & 2)) return null;
        canvas = { width: u24le(bytes, start + 4) + 1, height: u24le(bytes, start + 7) + 1 };
      }
      if (kind === 'VP8 ') {
        if (dimensions || length < 10 || (bytes[start] & 1) || bytes[start + 3] !== 157 || bytes[start + 4] !== 1 || bytes[start + 5] !== 42) return null;
        dimensions = { width: (bytes[start + 6] | (bytes[start + 7] << 8)) & 16383, height: (bytes[start + 8] | (bytes[start + 9] << 8)) & 16383 };
      }
      if (kind === 'VP8L') {
        if (dimensions || length < 5 || bytes[start] !== 47) return null;
        const packed = u32le(bytes, start + 1);
        if ((packed >>> 29) !== 0) return null;
        dimensions = { width: (packed & 16383) + 1, height: ((packed >>> 14) & 16383) + 1 };
      }
      position = start + length + (length % 2);
    }
    if (position !== bytes.length || !dimensions?.width || !dimensions.height) return null;
    if (canvas && (canvas.width !== dimensions.width || canvas.height !== dimensions.height)) return null;
    return { type: 'image/webp', ...dimensions };
  }
  return null;
}

/** Only small, static raster data URLs can enter a saved profile. External URLs,
 * SVG, renamed payloads, animated images and large canvas headers are rejected. */
export function normalizeAvatarSource(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > Math.ceil(AVATAR_MAX_BYTES / 3) * 4 + 40) return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4 !== 0) return null;
  const padding = match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0;
  if (match[2].length / 4 * 3 - padding > AVATAR_MAX_BYTES) return null;
  try {
    const binary = atob(match[2]), bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const metadata = inspectAvatarImage(bytes);
    if (!metadata || metadata.type !== match[1] || !validDimensions(metadata.width, metadata.height, AVATAR_OUTPUT_SIZE ** 2) || metadata.width > AVATAR_OUTPUT_SIZE || metadata.height > AVATAR_OUTPUT_SIZE) return null;
    return value;
  } catch { return null; }
}

export function validateAvatarFile(file: Pick<File, 'size' | 'type'>, bytes?: Uint8Array): AvatarImageMetadata | null {
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > AVATAR_INPUT_MAX_BYTES) throw new AvatarError('size');
  const declared = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  if (declared && !['image/png', 'image/jpeg', 'image/webp'].includes(declared)) throw new AvatarError('type');
  if (!bytes) return null;
  if (bytes.length !== file.size) throw new AvatarError('decode');
  const metadata = inspectAvatarImage(bytes);
  if (!metadata || (declared && metadata.type !== declared)) throw new AvatarError('type');
  if (!validDimensions(metadata.width, metadata.height)) throw new AvatarError('dimensions');
  return metadata;
}

export async function decodeAvatar(file: File): Promise<DecodedAvatar> {
  validateAvatarFile(file);
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await file.arrayBuffer()); } catch { throw new AvatarError('decode'); }
  validateAvatarFile(file, bytes);
  if (typeof window === 'undefined') throw new AvatarError('decode');
  let source: ImageBitmap | HTMLImageElement | null = null, previewUrl = '';
  try {
    // The browser applies EXIF orientation before the crop is measured.
    if (typeof createImageBitmap === 'function') source = await createImageBitmap(file, { imageOrientation: 'from-image' });
    else {
      previewUrl = URL.createObjectURL(file);
      const image = new Image();
      image.decoding = 'async';
      image.src = previewUrl;
      await image.decode();
      source = image;
    }
    const width = 'naturalWidth' in source ? source.naturalWidth : source.width;
    const height = 'naturalHeight' in source ? source.naturalHeight : source.height;
    if (!validDimensions(width, height)) throw new AvatarError('dimensions');
    previewUrl ||= URL.createObjectURL(file);
    let disposed = false;
    const image = source;
    return {
      width, height, previewUrl,
      get source() { if (disposed) throw new AvatarError('decode'); return image; },
      dispose() {
        if (disposed) return;
        disposed = true;
        URL.revokeObjectURL(previewUrl);
        if ('close' in image) image.close();
      },
    };
  } catch (error) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (source && 'close' in source) source.close();
    throw error instanceof AvatarError ? error : new AvatarError('decode');
  }
}

/** Cover-crop geometry shared by the editor preview and final export. Offsets
 * cannot uncover a blank edge, including after a quarter-turn rotation. */
export function calculateAvatarCrop(width: number, height: number, crop: AvatarCrop = DEFAULT_AVATAR_CROP, size = AVATAR_OUTPUT_SIZE): AvatarCropGeometry {
  if (!validDimensions(width, height)) throw new AvatarError('dimensions');
  if (!crop || ![crop.zoom, crop.offsetX, crop.offsetY, size].every(Number.isFinite) || crop.zoom < 1 || crop.zoom > 3 || Math.abs(crop.offsetX) > 1 || Math.abs(crop.offsetY) > 1 || ![0, 90, 180, 270].includes(crop.rotation) || !Number.isInteger(size) || size < 1 || size > AVATAR_OUTPUT_SIZE) throw new AvatarError('crop');
  const rotated = crop.rotation === 90 || crop.rotation === 270;
  const rotatedWidth = rotated ? height : width, rotatedHeight = rotated ? width : height;
  const scale = Math.max(size / rotatedWidth, size / rotatedHeight) * crop.zoom;
  const maxOffsetX = Math.max(0, (rotatedWidth * scale - size) / 2), maxOffsetY = Math.max(0, (rotatedHeight * scale - size) / 2);
  return {
    size, scale, centerX: size / 2 + crop.offsetX * maxOffsetX, centerY: size / 2 + crop.offsetY * maxOffsetY,
    drawWidth: width * scale, drawHeight: height * scale,
    rotatedWidth: rotatedWidth * scale, rotatedHeight: rotatedHeight * scale,
    maxOffsetX, maxOffsetY, radians: crop.rotation * Math.PI / 180,
  };
}

export function drawAvatarPreview(canvas: HTMLCanvasElement, avatar: DecodedAvatar, crop: AvatarCrop, size = AVATAR_OUTPUT_SIZE): void {
  const geometry = calculateAvatarCrop(avatar.width, avatar.height, crop, size);
  canvas.width = size; canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new AvatarError('encode');
  context.clearRect(0, 0, size, size);
  context.save();
  try {
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.translate(geometry.centerX, geometry.centerY);
    context.rotate(geometry.radians);
    context.drawImage(avatar.source, -geometry.drawWidth / 2, -geometry.drawHeight / 2, geometry.drawWidth, geometry.drawHeight);
  } catch (error) { throw error instanceof AvatarError ? error : new AvatarError('decode'); }
  finally { context.restore(); }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    try { canvas.toBlob(resolve, type, quality); } catch { reject(new AvatarError('encode')); }
  });
}
async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
  return `data:${blob.type};base64,${btoa(binary)}`;
}

export async function encodeAvatar(avatar: DecodedAvatar, crop: AvatarCrop): Promise<string> {
  if (typeof document === 'undefined') throw new AvatarError('encode');
  const canvas = document.createElement('canvas');
  drawAvatarPreview(canvas, avatar, crop);
  try {
    for (const quality of [0.9, 0.8, 0.68, 0.5]) {
      const blob = await canvasBlob(canvas, 'image/webp', quality);
      if (blob?.size && blob.size <= AVATAR_MAX_BYTES) {
        const url = normalizeAvatarSource(await blobDataUrl(blob));
        if (url) return url;
      }
      // Unsupported WebP encoders return PNG; further quality settings do not
      // shrink PNG, so move directly to the JPEG fallback.
      if (blob && blob.type !== 'image/webp') break;
    }
    const opaque = document.createElement('canvas');
    opaque.width = AVATAR_OUTPUT_SIZE; opaque.height = AVATAR_OUTPUT_SIZE;
    const context = opaque.getContext('2d');
    if (!context) throw new AvatarError('encode');
    context.fillStyle = '#eef2f7'; context.fillRect(0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE); context.drawImage(canvas, 0, 0);
    for (const quality of [0.9, 0.8, 0.68, 0.5]) {
      const blob = await canvasBlob(opaque, 'image/jpeg', quality);
      if (blob?.size && blob.size <= AVATAR_MAX_BYTES) {
        const url = normalizeAvatarSource(await blobDataUrl(blob));
        if (url) return url;
      }
    }
  } catch (error) { throw error instanceof AvatarError ? error : new AvatarError('encode'); }
  throw new AvatarError('encode');
}
