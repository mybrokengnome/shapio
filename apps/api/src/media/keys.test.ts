import { describe, expect, it } from 'vitest';
import {
  buildAssetKey,
  buildVariantKey,
  isValidStorageKey,
  sanitizeFilename,
  toStorageSlug,
  visibilityOfKey,
  withVisibility,
} from './keys.js';

const ASSET_ID = '3f2b8c1e-6a4d-4b7e-9c1a-2d3e4f5a6b7c';

describe('media keys', () => {
  it.each([
    ['photo.jpg', 'photo.jpg'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\report.pdf', 'report.pdf'],
    ['bad<name>|?.png', 'bad-name-.png'],
    ['line\nbreak.txt', 'line-break.txt'],
    ['...', 'file'],
    ['', 'file'],
    ['  .hidden ', 'hidden'],
  ])('sanitizes %j to %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });

  it('keeps the extension when shortening long names', () => {
    const name = sanitizeFilename(`${'a'.repeat(300)}.jpeg`);
    expect(name).toHaveLength(200);
    expect(name.endsWith('.jpeg')).toBe(true);
  });

  it.each([
    ['Été 2026.JPG', 'ete-2026.jpg'],
    ['日本.png', 'file.png'],
    ['My  Photo (1).webp', 'my-photo-1.webp'],
    ['noext', 'noext'],
  ])('slugs %j to %j', (input, expected) => {
    expect(toStorageSlug(input)).toBe(expected);
  });

  it('builds keys under a visibility prefix with a fresh token per upload', () => {
    const first = buildAssetKey('public', ASSET_ID, 'Hero Image.PNG');
    const second = buildAssetKey('public', ASSET_ID, 'Hero Image.PNG');
    expect(first).toMatch(new RegExp(`^public/${ASSET_ID}/[0-9a-f]{24}/hero-image\\.png$`));
    expect(first).not.toBe(second);
    expect(isValidStorageKey(first)).toBe(true);
    const variant = buildVariantKey(first, 'thumbnail', 'webp');
    expect(variant).toBe(`${first.slice(0, first.lastIndexOf('/'))}/v/thumbnail.webp`);
    expect(isValidStorageKey(variant)).toBe(true);
  });

  it('moves keys between visibility prefixes', () => {
    const key = buildAssetKey('public', ASSET_ID, 'a.png');
    const moved = withVisibility(key, 'private');
    expect(visibilityOfKey(moved)).toBe('private');
    expect(withVisibility(moved, 'public')).toBe(key);
  });

  it.each([
    '../secret',
    'public/../../etc/passwd',
    '/public/a/b',
    'public/a/../b',
    'other/a/b',
    'public//a',
    'public/a/.hidden',
    'public/a',
    'public/a/b\u0000',
  ])('rejects the unsafe key %j', (key) => {
    expect(isValidStorageKey(key)).toBe(false);
  });
});
