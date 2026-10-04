import type { GraphqlConfig } from '../config/graphql.js';
import { SHAPIO_VERSION } from '../constants/version.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import { renderDocsPage } from '../schema/codegen/docsPage.js';
import { generateOpenApi } from '../schema/codegen/openapi.js';
import { generateTypeScript } from '../schema/codegen/typescript.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';

/**
 * Generated API contracts (OpenAPI, TypeScript) of one site's view, rebuilt in memory when the schema version
 * changes and cached per site and version: a model change is reflected on the next request, with no restart
 * (CONTRIBUTING.md rule 1). Entries of older versions are dropped, so the cache holds at most one per site.
 */
type Cached = { version: number; openApi: Record<string, unknown>; html?: string; typescript?: string };
const cache = new Map<string | null, Cached>();

const forSnapshot = (snapshot: SchemaSnapshot, urls: UrlBuilder): Cached => {
  let cached = cache.get(snapshot.siteId);
  if (!cached || cached.version !== snapshot.version) {
    cached = {
      version: snapshot.version,
      openApi: generateOpenApi(snapshot, { serverUrl: urls.absoluteUrl('/'), version: SHAPIO_VERSION }),
    };
    for (const [key, entry] of cache) {
      if (entry.version < snapshot.version) {
        cache.delete(key);
      }
    }
    cache.set(snapshot.siteId, cached);
  }
  return cached;
};

export const getOpenApiDocument = (snapshot: SchemaSnapshot, urls: UrlBuilder) =>
  forSnapshot(snapshot, urls).openApi;

export const getDocsPage = (snapshot: SchemaSnapshot, urls: UrlBuilder, graphql: GraphqlConfig) => {
  const entry = forSnapshot(snapshot, urls);
  entry.html ??= renderDocsPage(
    entry.openApi as Parameters<typeof renderDocsPage>[0],
    urls.withBasePath('/api/docs/openapi.json'),
    graphql.enabled
      ? {
          endpoint: urls.withBasePath('/api/graphql'),
          playground: graphql.playgroundEnabled ? urls.withBasePath('/api/graphql/playground') : undefined,
        }
      : undefined,
  );
  return entry.html;
};

export const getTypeScript = (snapshot: SchemaSnapshot, urls: UrlBuilder) => {
  const entry = forSnapshot(snapshot, urls);
  entry.typescript ??= generateTypeScript(snapshot);
  return { schemaVersion: snapshot.version, source: entry.typescript };
};
