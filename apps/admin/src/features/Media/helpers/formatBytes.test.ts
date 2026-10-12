import { describe, expect, it } from 'vitest';
import { formatBytes } from './formatBytes';

describe('formatBytes', () => {
  it('spells out bytes, singular and plural', () => {
    expect(formatBytes(44)).toBe('44 bytes');
    expect(formatBytes(1)).toBe('1 byte');
    expect(formatBytes(0)).toBe('0 bytes');
  });

  it('abbreviates larger units with one decimal', () => {
    expect(formatBytes(1536)).toBe('1.5 kB');
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
  });
});
