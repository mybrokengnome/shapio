import { describe, expect, it } from 'vitest';
import { changeTags, siteTags } from './revalidationTags';

describe('changeTags', () => {
  it("tags each changed entry's model and the entry, without duplicates", () => {
    expect(
      changeTags(
        [
          { routeKey: 'articles', id: 'a1' },
          { routeKey: 'articles', id: 'a2' },
          { routeKey: 'siteSettings', id: 's1' },
          { routeKey: 'articles', id: 'a1' },
        ],
        false,
        'marketing',
      ),
    ).toEqual([
      'shapio:articles',
      'shapio:articles:a1',
      'shapio:articles:a2',
      'shapio:siteSettings',
      'shapio:siteSettings:s1',
    ]);
  });

  it('revalidates the site tag (every read) after a schema change', () => {
    expect(changeTags([{ routeKey: 'articles', id: 'a1' }], true, 'marketing')).toEqual([
      'shapio:site:marketing',
    ]);
    expect(changeTags([], true, undefined)).toEqual(['shapio:site']);
  });

  it('has nothing to revalidate when nothing changed', () => {
    expect(changeTags([], false, undefined)).toEqual([]);
  });
});

describe('siteTags', () => {
  it("is the client's site tag: keyed when the site is configured, bare otherwise", () => {
    expect(siteTags('marketing')).toEqual(['shapio:site:marketing']);
    expect(siteTags(undefined)).toEqual(['shapio:site']);
  });
});
