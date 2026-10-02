import { describe, expect, it } from 'vitest';
import { describeUserAgent } from './describeUserAgent';

describe('describeUserAgent', () => {
  it('names browser and system', () => {
    const ua =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
    expect(describeUserAgent(ua)).toBe('Chrome · macOS');
  });

  it('prefers Edge over Chrome', () => {
    expect(describeUserAgent('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36 Edg/140.0')).toBe(
      'Edge · Windows',
    );
  });

  it('returns undefined for unknown agents', () => {
    expect(describeUserAgent('curl/8.0')).toBeUndefined();
    expect(describeUserAgent(null)).toBeUndefined();
  });
});
