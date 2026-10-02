import { describe, expect, it } from 'vitest';
import { auditTargetName } from './auditTargetName';

describe('auditTargetName', () => {
  it('reads the first naming field the server recorded', () => {
    expect(auditTargetName({ name: 'Spring launch', email: 'x@example.com' })).toBe('Spring launch');
    expect(auditTargetName({ apiKey: 'article', fromVersion: 1 })).toBe('article');
    expect(auditTargetName({ email: 'grace@example.com' })).toBe('grace@example.com');
  });

  it('is undefined without a usable name', () => {
    expect(auditTargetName({})).toBeUndefined();
    expect(auditTargetName({ name: '  ' })).toBeUndefined();
    expect(auditTargetName(null)).toBeUndefined();
    expect(auditTargetName('text')).toBeUndefined();
  });
});
