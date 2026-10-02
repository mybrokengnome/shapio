import type { ByteRange } from '../media/types.js';

/**
 * Parses a single-range `Range: bytes=…` header against a size. Returns undefined when absent or not a
 * single byte range (serve the whole body), or 'unsatisfiable' (416). Multi-range requests get the
 * whole body, which RFC 9110 allows.
 */
export const parseByteRange = (
  header: string | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | undefined => {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (match[1] === '' && match[2] === '')) {
    return undefined;
  }
  const [, first = '', last = ''] = match;
  if (first === '') {
    const suffix = Number(last);
    return suffix === 0 || size === 0
      ? 'unsatisfiable'
      : { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  return start >= size || end < start ? 'unsatisfiable' : { start, end };
};
