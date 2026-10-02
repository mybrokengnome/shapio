import { describe, expect, it } from 'vitest';
import { graphqlSdl, restEndpoints, restResponseSample } from './shapes';
import { ARTICLE, AUTHOR, SEO } from './testDefinitions';

const lookup = new Map([ARTICLE, AUTHOR, SEO].map((definition) => [definition.id, definition]));

describe('API shapes from the naming helpers', () => {
  it('lists the delivery and admin endpoints by route key and API ID', () => {
    const paths = restEndpoints(ARTICLE).map((endpoint) => `${endpoint.method} ${endpoint.path}`);
    expect(paths).toContain('GET /api/content/articles');
    expect(paths).toContain('GET /api/content/articles/{id}');
    expect(paths).toContain('PUT /api/admin/content/article/{id}');
    expect(restEndpoints(SEO)).toEqual([]);
  });

  it('builds an example delivery response with nested components', () => {
    const sample = JSON.parse(restResponseSample(ARTICLE, lookup)) as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };
    expect(sample.data[0]).toMatchObject({
      title: '<string>',
      author: '<entry id>',
      stage: 'draft',
      seo: { metaTitle: '<string>' },
    });
    expect(sample.meta).toHaveProperty('pagination');
  });

  it('writes the GraphQL type and root fields with the registry’s names', () => {
    const sdl = graphqlSdl(ARTICLE, lookup);
    expect(sdl).toContain('type Article {');
    expect(sdl).toContain('author: Author');
    expect(sdl).toContain('seo: Seo');
    expect(sdl).toContain('stage: ArticleStageEnum');
    expect(sdl).toContain('articles(filter: ArticleFilter');
    expect(sdl).toContain('createArticle');
  });
});
