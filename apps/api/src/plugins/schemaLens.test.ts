import { describe, expect, it } from 'vitest';
import { isSchemaLensPath } from './schemaLens.js';

describe('isSchemaLensPath', () => {
  it('takes delivery, preview, snapshot, docs and GraphQL requests', () => {
    for (const path of [
      '/api/content/articles',
      '/api/preview/articles/1',
      '/api/snapshots/changes',
      '/api/docs/typescript',
      '/api/graphql',
      '/api/graphql/',
    ]) {
      expect(isSchemaLensPath(path, '/api/'), path).toBe(true);
    }
  });

  it('leaves the GraphQL playground and every other route alone', () => {
    for (const path of [
      '/api/graphql/playground',
      '/api/graphql/playground/playground.js',
      '/api/graphqlx',
      '/api/admin/content/article',
      '/content/articles',
    ]) {
      expect(isSchemaLensPath(path, '/api/'), path).toBe(false);
    }
  });

  it('reads paths below a base path', () => {
    expect(isSchemaLensPath('/cms/api/graphql', '/cms/api/')).toBe(true);
    expect(isSchemaLensPath('/cms/api/graphql/playground', '/cms/api/')).toBe(false);
  });
});
