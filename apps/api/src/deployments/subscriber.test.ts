import { describe, expect, it } from 'vitest';
import { policyFor } from './subscriber.js';

describe('deployment trigger policy', () => {
  it('builds on a kind change only when a published head moved', () => {
    expect(policyFor({ type: 'entry.kind_changed', payload: { published: true } })).toBe('publish');
    expect(policyFor({ type: 'entry.kind_changed', payload: { published: false } })).toBeUndefined();
    expect(policyFor({ type: 'entry.kind_changed', payload: null })).toBeUndefined();
  });

  it('keeps the existing triggers', () => {
    expect(policyFor({ type: 'entry.published', payload: {} })).toBe('publish');
    expect(policyFor({ type: 'entry.deleted', payload: { wasPublished: false } })).toBeUndefined();
    expect(policyFor({ type: 'schema.activated', payload: {} })).toBe('schema');
  });
});
