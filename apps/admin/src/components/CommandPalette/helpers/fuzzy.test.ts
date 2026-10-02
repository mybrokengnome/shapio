import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from './fuzzy';

describe('fuzzyScore', () => {
  it('matches substrings, subsequences, accents and keywords', () => {
    expect(fuzzyScore('art', 'Articles')).not.toBeNull();
    expect(fuzzyScore('atcl', 'Articles')).not.toBeNull();
    expect(fuzzyScore('cafe', 'Café menu')).not.toBeNull();
    expect(fuzzyScore('api', 'Tokens', ['API tokens'])).not.toBeNull();
    expect(fuzzyScore('xyz', 'Articles')).toBeNull();
  });

  it('needs every word of the query', () => {
    expect(fuzzyScore('new art', 'New article')).not.toBeNull();
    expect(fuzzyScore('new tag', 'New article')).toBeNull();
  });

  it('is 0 for an empty query', () => {
    expect(fuzzyScore('  ', 'Anything')).toBe(0);
  });
});

describe('fuzzyFilter', () => {
  const items = [
    { label: 'Media' },
    { label: 'Site settings' },
    { label: 'Settings' },
    { label: 'Assignments' },
  ];

  it('ranks a word-start substring above a scattered match', () => {
    expect(fuzzyFilter('set', items).map(({ label }) => label)).toEqual([
      'Settings',
      'Site settings',
      'Assignments',
    ]);
  });

  it('keeps the original order for an empty query', () => {
    expect(fuzzyFilter('', items)).toEqual(items);
  });
});
