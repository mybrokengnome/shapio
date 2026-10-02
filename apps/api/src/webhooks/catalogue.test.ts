import { describe, expect, it } from 'vitest';
import { isValidEventPattern, matchesEvent } from './catalogue.js';

describe('webhook event catalogue', () => {
  it('accepts catalogue events and group wildcards only', () => {
    expect(isValidEventPattern('entry.published')).toBe(true);
    expect(isValidEventPattern('media.*')).toBe(true);
    expect(isValidEventPattern('deployment.deployed')).toBe(true);
    expect(isValidEventPattern('change_set.*')).toBe(true);
    expect(isValidEventPattern('*')).toBe(false);
    expect(isValidEventPattern('entry.nope')).toBe(false);
    expect(isValidEventPattern('nope.*')).toBe(false);
  });

  it('matches exact names and group patterns', () => {
    expect(matchesEvent(['entry.*'], 'entry.published')).toBe(true);
    expect(matchesEvent(['entry.published'], 'entry.unpublished')).toBe(false);
    expect(matchesEvent(['schema.*', 'media.created'], 'media.created')).toBe(true);
    expect(matchesEvent(['entry.*'], 'entryx.published')).toBe(false);
  });
});
