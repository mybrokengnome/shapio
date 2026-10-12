import { describe, expect, it } from 'vitest';
import { bundleTimestamp, nullableBundleTimestamp, parseRecord } from './format.js';

describe('bundleTimestamp', () => {
  it('writes six fractional digits whatever the database stored', () => {
    expect(bundleTimestamp('2026-10-01T10:22:58.006587Z')).toBe('2026-10-01T10:22:58.006587Z');
    expect(bundleTimestamp('2026-10-01T10:22:58.006Z')).toBe('2026-10-01T10:22:58.006000Z');
    expect(bundleTimestamp('2026-10-01T10:22:58.5Z')).toBe('2026-10-01T10:22:58.500000Z');
    expect(bundleTimestamp('2026-10-01T10:22:58Z')).toBe('2026-10-01T10:22:58.000000Z');
    expect(nullableBundleTimestamp(null)).toBeNull();
  });
});

describe('bundle header', () => {
  const header = (formatVersion: number) =>
    JSON.stringify({
      type: 'header',
      format: 'shapio-export',
      formatVersion,
      shapioVersion: '0.5.6',
      exportedAt: '2026-10-01T00:00:00.000Z',
      schemaVersion: 1,
      snapshot: 0,
      options: { headsOnly: false, includeUsers: false },
    });

  it('imports format versions 1 (milliseconds) and 2 (microseconds), and refuses newer ones', () => {
    expect(parseRecord(header(1), 1)).toMatchObject({ formatVersion: 1 });
    expect(parseRecord(header(2), 1)).toMatchObject({ formatVersion: 2 });
    expect(() => parseRecord(header(3), 1)).toThrow(/Bundle line 1/);
  });
});
