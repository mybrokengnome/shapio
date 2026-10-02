import { checkApiKeySyntax } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { deriveApiKey } from './deriveApiKey';

describe('deriveApiKey', () => {
  it.each([
    ['Blog post', 'blogPost'],
    ['Article', 'article'],
    ['SEO title', 'seoTitle'],
    ['heroImage', 'heroImage'],
    ['  hero -- image  ', 'heroImage'],
    ['Café crème', 'cafeCreme'],
    ['3 columns', '_3Columns'],
    ['', ''],
    ['!!!', ''],
  ])('%j → %j', (label, key) => {
    expect(deriveApiKey(label)).toBe(key);
  });

  it('always proposes a syntactically valid key for a label with letters or digits', () => {
    for (const label of ['Hello world', '2026 plans', 'a'.repeat(100), 'Ünïcödé tëxt']) {
      expect(checkApiKeySyntax(deriveApiKey(label))).toBeNull();
    }
  });
});
