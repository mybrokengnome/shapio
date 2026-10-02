import { fileTypeFromBuffer } from 'file-type';

export type SniffResult =
  | { ok: true; mimeType: string }
  | { ok: false; code: 'TYPE_NOT_ALLOWED' | 'TYPE_MISMATCH' | 'TYPE_UNKNOWN'; detected: string | undefined };

/** Types with no magic bytes: accepted on the declared type when the bytes are plain UTF-8 text. */
const TEXT_TYPES: ReadonlySet<string> = new Set([
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'image/svg+xml',
]);
const SVG_ROOT = /<svg[\s>]/i;

/** `Image/PNG; charset=x` → `image/png`. */
export const normalizeMimeType = (value: string): string => value.split(';')[0]?.trim().toLowerCase() ?? '';

export const isMimeTypeAllowed = (mimeType: string, allowed: readonly string[]): boolean =>
  allowed.some((pattern) =>
    pattern.endsWith('/*') ? mimeType.startsWith(pattern.slice(0, -1)) : mimeType === pattern,
  );

/** Audio and video share containers (WebM, MP4, Ogg); detection cannot always tell them apart. */
const familyOf = (mimeType: string): string => {
  const top = mimeType.slice(0, mimeType.indexOf('/'));
  return top === 'audio' || top === 'video' ? 'av' : mimeType === 'image/svg+xml' ? 'image' : top;
};

const isPlainText = (sample: Buffer): boolean => {
  if (sample.includes(0)) {
    return false;
  }
  try {
    // `stream: true` tolerates a multi-byte character cut off at the end of the sample.
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true });
    return true;
  } catch {
    return false;
  }
};

const sniffText = (sample: Buffer, declared: string, allowed: readonly string[]): SniffResult => {
  if (!TEXT_TYPES.has(declared) || !isPlainText(sample)) {
    return { ok: false, code: 'TYPE_UNKNOWN', detected: undefined };
  }
  if (declared === 'image/svg+xml' && !SVG_ROOT.test(sample.toString('utf8'))) {
    return { ok: false, code: 'TYPE_MISMATCH', detected: 'text/plain' };
  }
  return isMimeTypeAllowed(declared, allowed)
    ? { ok: true, mimeType: declared }
    : { ok: false, code: 'TYPE_NOT_ALLOWED', detected: declared };
};

/**
 * Decides an upload's type from its first bytes (magic numbers), never from its name or the declared type
 * alone: an executable renamed to `photo.png` is detected as an executable and refused. The detected type
 * must be allowed (MEDIA_ALLOWED_TYPES) and belong to the same family as the declared one.
 */
export const sniffMediaType = async (
  sample: Buffer,
  declaredMimeType: string,
  allowed: readonly string[],
): Promise<SniffResult> => {
  const declared = normalizeMimeType(declaredMimeType);
  const detected = await fileTypeFromBuffer(sample);
  if (!detected || (detected.mime === 'application/xml' && declared === 'image/svg+xml')) {
    return sniffText(sample, declared, allowed);
  }
  if (!isMimeTypeAllowed(detected.mime, allowed)) {
    return { ok: false, code: 'TYPE_NOT_ALLOWED', detected: detected.mime };
  }
  if (familyOf(detected.mime) !== familyOf(declared)) {
    return { ok: false, code: 'TYPE_MISMATCH', detected: detected.mime };
  }
  return { ok: true, mimeType: detected.mime };
};
