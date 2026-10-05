import { describe, expect, it } from 'vitest';
import {
  EVERY_PAGE,
  REVALIDATING_EVENTS,
  revalidationTargets,
  SITE_WIDE_EVENTS,
} from './revalidationTargets';

describe('revalidationTargets', () => {
  it('maps a changed article to its page and the locale’s article list', () => {
    expect(revalidationTargets([{ modelKey: 'article', locale: 'fr', slugs: ['hello'] }], false)).toEqual([
      { path: '/fr/articles/' },
      { path: '/fr/articles/hello/' },
    ]);
  });

  it('revalidates both slugs of an article whose slug changed, and its list once', () => {
    expect(
      revalidationTargets(
        [
          { modelKey: 'article', locale: 'en', slugs: ['old', 'new'] },
          { modelKey: 'article', locale: 'en', slugs: ['other'] },
        ],
        false,
      ),
    ).toEqual([
      { path: '/en/articles/' },
      { path: '/en/articles/new/' },
      { path: '/en/articles/old/' },
      { path: '/en/articles/other/' },
    ]);
  });

  it('maps pages by slug, with home as the locale’s front page', () => {
    expect(
      revalidationTargets(
        [
          { modelKey: 'page', locale: 'en', slugs: ['home'] },
          { modelKey: 'page', locale: 'fr', slugs: ['about'] },
        ],
        false,
      ),
    ).toEqual([{ path: '/en/' }, { path: '/fr/about/' }]);
  });

  it('refreshes the article list and every article page for an author', () => {
    expect(revalidationTargets([{ modelKey: 'author', locale: 'en', slugs: [] }], false)).toEqual([
      { path: '/[locale]/articles/[slug]', type: 'page' },
      { path: '/en/articles/' },
    ]);
  });

  it('refreshes every page for the siteSettings singleton or a schema change', () => {
    const page = { modelKey: 'page', locale: 'en', slugs: ['about'] };
    expect(revalidationTargets([page, { modelKey: 'siteSettings', locale: 'en', slugs: [] }], false)).toEqual(
      [EVERY_PAGE],
    );
    expect(revalidationTargets([page], true)).toEqual([EVERY_PAGE]);
  });

  it('ignores models the site does not render and entries without a slug', () => {
    expect(
      revalidationTargets(
        [
          { modelKey: 'product', locale: 'en', slugs: ['x'] },
          { modelKey: 'page', locale: 'en', slugs: [] },
        ],
        false,
      ),
    ).toEqual([]);
  });

  it('treats a change to the site (its SEO defaults) as site-wide, without a snapshot diff', () => {
    expect(REVALIDATING_EVENTS).toContain('site.updated');
    expect(SITE_WIDE_EVENTS).toEqual(['site.updated']);
  });
});
