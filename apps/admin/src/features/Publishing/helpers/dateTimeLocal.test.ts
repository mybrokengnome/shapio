import { describe, expect, it } from 'vitest';
import { dateTimeLocalToIso, defaultScheduleValue, toDateTimeLocalValue } from './dateTimeLocal';

describe('dateTimeLocalToIso', () => {
  it('reads the value in the local time zone', () => {
    const local = new Date(2026, 9, 2, 14, 30);
    expect(dateTimeLocalToIso('2026-10-02T14:30')).toBe(local.toISOString());
  });

  it('accepts seconds', () => {
    expect(dateTimeLocalToIso('2026-10-02T14:30:15')).toBe(new Date(2026, 9, 2, 14, 30, 15).toISOString());
  });

  it.each(['', '2026-10-02', '2026-02-31T10:00', '2026-13-01T10:00', '2026-10-02T25:00', 'tomorrow'])(
    'rejects %j',
    (value) => {
      expect(dateTimeLocalToIso(value)).toBeUndefined();
    },
  );

  it('round-trips with toDateTimeLocalValue', () => {
    const date = new Date(2027, 0, 5, 9, 7);
    expect(dateTimeLocalToIso(toDateTimeLocalValue(date))).toBe(date.toISOString());
  });
});

describe('defaultScheduleValue', () => {
  it('offers the top of an hour at least 30 minutes ahead', () => {
    expect(defaultScheduleValue(new Date(2026, 9, 2, 14, 10))).toBe('2026-10-02T15:00');
    expect(defaultScheduleValue(new Date(2026, 9, 2, 14, 40))).toBe('2026-10-02T16:00');
    expect(defaultScheduleValue(new Date(2026, 11, 31, 23, 45))).toBe('2027-01-01T01:00');
  });
});
