import { describe, expect, it } from 'vitest';
import { playgroundUrl } from './playgroundUrl';

const BASE = 'https://cms.example.com/cms/api/graphql/playground';

describe('playgroundUrl', () => {
  it('names the theme, and the site only when it is not the primary one', () => {
    expect(playgroundUrl(BASE, { theme: 'dark' })).toBe(`${BASE}?theme=dark`);
    expect(playgroundUrl(BASE, { siteKey: 'blog', theme: 'light' })).toBe(`${BASE}?site=blog&theme=light`);
  });

  it('carries a query, encoded, and leaves out a blank one', () => {
    const url = new URL(
      playgroundUrl(BASE, { query: 'query {\n  pages { totalCount }\n}\n', theme: 'dark' }),
    );
    expect(url.searchParams.get('query')).toBe('query {\n  pages { totalCount }\n}\n');
    expect(playgroundUrl(BASE, { query: '  ', theme: 'dark' })).toBe(`${BASE}?theme=dark`);
  });
});
