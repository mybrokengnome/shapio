import { randomBytes } from 'node:crypto';

export type MediaVisibility = 'public' | 'private';

const MAX_FILENAME_LENGTH = 200;
const MAX_SLUG_LENGTH = 80;
/** Characters Windows, macOS or shells treat specially, plus every control character. */
// eslint-disable-next-line no-control-regex
const UNSAFE_FILENAME_CHARACTERS = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;
const SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]{0,127}';
const STORAGE_KEY_PATTERN = new RegExp(`^(public|private)(/${SEGMENT}){2,5}$`);

const splitExtension = (name: string): { stem: string; extension: string } => {
  const dot = name.lastIndexOf('.');
  return dot > 0 && name.length - dot <= 16
    ? { stem: name.slice(0, dot), extension: name.slice(dot) }
    : { stem: name, extension: '' };
};

/**
 * The display name kept for an upload: the last path segment, NFC-normalised, without control or
 * path characters, at most 200 characters with the extension preserved. Never used as a storage path.
 */
export const sanitizeFilename = (input: string): string => {
  const base = input.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .normalize('NFC')
    .replace(UNSAFE_FILENAME_CHARACTERS, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.-]+|[\s.]+$/g, '');
  if (cleaned === '') {
    return 'file';
  }
  if (cleaned.length <= MAX_FILENAME_LENGTH) {
    return cleaned;
  }
  const { stem, extension } = splitExtension(cleaned);
  return `${stem.slice(0, MAX_FILENAME_LENGTH - extension.length)}${extension}`;
};

/** An ASCII, lower-case, URL-safe version of a file name for storage keys: `Été 2026.JPG` → `ete-2026.jpg`. */
export const toStorageSlug = (filename: string): string => {
  const { stem, extension } = splitExtension(filename);
  const slugify = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const slugStem = slugify(stem).slice(0, MAX_SLUG_LENGTH) || 'file';
  const slugExtension = slugify(extension).slice(0, 15);
  return slugExtension ? `${slugStem}.${slugExtension}` : slugStem;
};

/** Relative keys only, made of safe segments under a visibility prefix: no `..`, no absolute paths. */
export const isValidStorageKey = (key: string): boolean => STORAGE_KEY_PATTERN.test(key);

/**
 * `public/<assetId>/<token>/<slug>`. The visibility prefix lets an operator expose only `public/` through a
 * CDN or bucket policy; the random token gives every upload (and replacement) a new, cacheable URL.
 */
export const buildAssetKey = (visibility: MediaVisibility, assetId: string, filename: string): string =>
  `${visibility}/${assetId}/${randomBytes(12).toString('hex')}/${toStorageSlug(filename)}`;

/** Variants sit beside their original: `public/<assetId>/<token>/v/<name>.<extension>`. */
export const buildVariantKey = (assetKey: string, name: string, extension: string): string =>
  `${assetKey.slice(0, assetKey.lastIndexOf('/'))}/v/${name}.${extension}`;

/** The same key under the other visibility prefix (visibility changes move objects). */
export const withVisibility = (key: string, visibility: MediaVisibility): string =>
  `${visibility}${key.slice(key.indexOf('/'))}`;

export const visibilityOfKey = (key: string): MediaVisibility | undefined => {
  const prefix = key.slice(0, key.indexOf('/'));
  return prefix === 'public' || prefix === 'private' ? prefix : undefined;
};

/** Percent-encodes each segment for use in a URL path. */
export const encodeKeyPath = (key: string): string => key.split('/').map(encodeURIComponent).join('/');
