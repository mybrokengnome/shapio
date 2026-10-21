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

  it("revalidates a child kind's entry under its own route key and every ancestor's", () => {
    expect(
      changeTags(
        [
          { routeKey: 'posts/guides', id: 'g1' },
          { routeKey: 'posts', id: 'p1' },
        ],
        false,
        undefined,
      ),
    ).toEqual([
      'shapio:posts',
      'shapio:posts/guides',
      'shapio:posts/guides:g1',
      'shapio:posts:g1',
      'shapio:posts:p1',
    ]);
  });

  it("revalidates the lists of the interfaces an entry's type implements", () => {
    expect(
      changeTags(
        [
          { routeKey: 'posts', id: 'p1', interfaces: ['featurables'] },
          { routeKey: 'roadmapItems', id: 'r1', interfaces: ['featurables'] },
        ],
        false,
        undefined,
      ),
    ).toEqual([
      'shapio:featurables',
      'shapio:featurables:p1',
      'shapio:featurables:r1',
      'shapio:posts',
      'shapio:posts:p1',
      'shapio:roadmapItems',
      'shapio:roadmapItems:r1',
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
