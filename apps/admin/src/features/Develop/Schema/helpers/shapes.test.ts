import { ANY_TARGET, normalizeDefinition, type ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { effectiveDefinition, graphqlSdl, restEndpoints, restResponseSample } from './shapes';
import { ARTICLE, AUTHOR, SEO, uuid } from './testDefinitions';

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
    expect(sdl).toContain('type Article implements Entry {');
    expect(sdl).toContain('author: Author');
    expect(sdl).toContain('seo: Seo');
    expect(sdl).toContain('stage: ArticleStageEnum');
    expect(sdl).toContain('articles(filter: ArticleFilter');
    expect(sdl).toContain('createArticle');
  });

  it('previews a kind with its inherited fields, its nested path and the interfaces it implements', () => {
    const digital = {
      ...ARTICLE,
      id: 'digital',
      apiKey: 'digitalArticle',
      pluralApiKey: 'digital',
      label: 'Digital',
      extends: ARTICLE.id,
      fields: [{ ...ARTICLE.fields[0], id: 'download', apiKey: 'downloadUrl', label: 'Download' }],
      display: {},
    } as typeof ARTICLE;
    const family = new Map([...lookup, [digital.id, digital]]);
    const paths = restEndpoints(digital, family).map((endpoint) => endpoint.path);
    expect(paths).toContain('/api/content/articles/digital');
    const sample = JSON.parse(restResponseSample(digital, family)) as {
      data: Array<Record<string, unknown>>;
    };
    expect(sample.data[0]).toMatchObject({
      __model: 'digitalArticle',
      title: '<string>',
      downloadUrl: '<string>',
    });
    const sdl = graphqlSdl(digital, family);
    expect(sdl).toContain('type DigitalArticle implements Entry & ArticleInterface {');
    // The inherited enum keeps the declaring model's type name.
    expect(sdl).toContain('stage: ArticleStageEnum');
  });

  it('resolves a kind once: an already resolved definition keeps its field list', () => {
    const digital = {
      ...ARTICLE,
      id: 'digital',
      apiKey: 'digitalArticle',
      label: 'Digital',
      extends: ARTICLE.id,
      fields: [{ ...ARTICLE.fields[0], id: 'download', apiKey: 'downloadUrl', label: 'Download' }],
      display: {},
    } as typeof ARTICLE;
    const family = new Map([...lookup, [digital.id, digital]]);
    const once = effectiveDefinition(digital, family);
    const twice = effectiveDefinition(once, family);
    expect(twice.fields.map((field) => field.id)).toEqual(once.fields.map((field) => field.id));
    expect(graphqlSdl(once, family)).toBe(graphqlSdl(digital, family));
  });

  describe('interfaces', () => {
    const FEATURABLE = normalizeDefinition({
      id: uuid(4),
      kind: 'interface',
      apiKey: 'featurable',
      label: 'Featurable',
      fields: [{ id: uuid(41), apiKey: 'title', label: 'Title', type: 'string', required: true }],
    });
    const POST = normalizeDefinition({
      id: uuid(5),
      kind: 'collection',
      apiKey: 'post',
      label: 'Post',
      implements: [uuid(4)],
      fields: [
        { id: uuid(51), apiKey: 'title', label: 'Title', type: 'string', required: true },
        {
          id: uuid(52),
          apiKey: 'subject',
          label: 'Subject',
          type: 'relation',
          settings: { target: ANY_TARGET, cardinality: 'one' },
        },
        {
          id: uuid(53),
          apiKey: 'featured',
          label: 'Featured',
          type: 'relation',
          settings: { target: uuid(4), cardinality: 'many' },
        },
      ],
    }) as ModelDefinition;
    const withContracts = new Map([...lookup, [FEATURABLE.id, FEATURABLE], [POST.id, POST]]);

    it('lists an interface’s read routes under its plural, never writes', () => {
      expect(restEndpoints(FEATURABLE).map((endpoint) => `${endpoint.method} ${endpoint.path}`)).toEqual([
        'GET /api/content/featurables',
        'GET /api/content/featurables/{id}',
      ]);
    });

    it('writes an interface as a GraphQL interface with its queries, and members implementing it', () => {
      const contract = graphqlSdl(FEATURABLE, withContracts);
      expect(contract).toContain('interface Featurable implements Entry {');
      expect(contract).toContain('featurables(filter: FeaturableFilter');
      const member = graphqlSdl(POST, withContracts);
      expect(member).toContain('type Post implements Entry & Featurable {');
      expect(member).toContain('subject: Entry');
      expect(member).toContain('featured: [Featurable!]');
    });
  });
});
