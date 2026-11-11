import type { GraphqlConfig } from '../config/graphql.js';
import { WORKSPACE_QUERY_PARAMETER } from '../constants/sites.js';
import { SHAPIO_VERSION } from '../constants/version.js';
import type { Database } from '../db/index.js';
import type { UrlBuilder } from '../helpers/publicUrl.js';
import type { Principal } from '../permissions/types.js';
import { renderDocsPage } from '../schema/codegen/docsPage.js';
import { generateOpenApi } from '../schema/codegen/openapi.js';
import { generateTypeScript } from '../schema/codegen/typescript.js';
import { lensBudgetKeyOf } from '../schema/lens/budget.js';
import { createLru } from '../schema/lens/lru.js';
import { lensViewGeneration, loadRequestLens, parseSchemaVersionToken } from '../schema/lens/views.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import { schemaIdOf } from './contentAccess.js';

/**
 * Generated API contracts (OpenAPI, TypeScript) of one workspace's view, rebuilt in memory when the schema
 * version changes: a model change is reflected on the next request, with no restart (CONTRIBUTING.md rule 1).
 * The current contract is kept per workspace, as many as there are workspaces, and replaced when the version
 * moves. Older versions' contracts (`?schemaVersion=`, plan schema-lenses) are kept apart in a small LRU, so
 * walking versions never evicts a workspace's current contract.
 */
type Cached = { version: number; openApi: Record<string, unknown>; html?: string; typescript?: string };

const current = new Map<string | null, Cached>();

/** Older versions' contracts kept, across workspaces. */
export const API_DOCS_CACHE_SIZE = 16;
const older = createLru<string, Cached>(API_DOCS_CACHE_SIZE);

const build = (snapshot: SchemaSnapshot, urls: UrlBuilder): Cached => ({
  version: snapshot.version,
  openApi: generateOpenApi(snapshot, { serverUrl: urls.absoluteUrl('/'), version: SHAPIO_VERSION }),
});

const forSnapshot = (snapshot: SchemaSnapshot, urls: UrlBuilder): Cached => {
  const generation = lensViewGeneration(snapshot);
  if (generation === 0) {
    let cached = current.get(snapshot.siteId);
    if (!cached || cached.version !== snapshot.version) {
      cached = build(snapshot, urls);
      current.set(snapshot.siteId, cached);
    }
    return cached;
  }
  // A lens view's generation: contracts rendered from it go when its caches do (the history backfill).
  const key = `${snapshot.siteId ?? ''}|${snapshot.version}|${generation}`;
  let cached = older.get(key);
  if (!cached) {
    cached = build(snapshot, urls);
    older.set(key, cached);
  }
  return cached;
};

/**
 * The view a contract request renders: the workspace's current one, or the one of the schema version the
 * request names (`<schemaId>:<version>`; `SCHEMA_VERSION_FOREIGN`, `SCHEMA_VERSION_AHEAD`, and
 * `SCHEMA_VERSION_UNAVAILABLE` when the history of a definition does not reach it), with the instance's
 * schema ID for `SCHEMA_VERSION`.
 */
export const contractViewFor = async (
  db: Database,
  current: SchemaSnapshot,
  token: string | null,
  /** The caller: pays for building an older version's view (schema/lens/budget.ts). */
  principal: Principal,
): Promise<{ view: SchemaSnapshot; schemaId: string }> => {
  const schemaId = await schemaIdOf(db);
  if (token === null) {
    return { view: current, schemaId };
  }
  const lens = await loadRequestLens(
    db,
    current,
    parseSchemaVersionToken(token, schemaId),
    lensBudgetKeyOf(principal, current.siteId),
  );
  if (!lens) {
    return { view: current, schemaId };
  }
  // A contract shows every definition: refuse one whose history does not reach the version.
  for (const active of lens.view.definitions) {
    lens.lensFor(active.definition.id);
  }
  return { view: lens.view, schemaId };
};

export const getOpenApiDocument = (snapshot: SchemaSnapshot, urls: UrlBuilder) =>
  forSnapshot(snapshot, urls).openApi;

/**
 * The page is one workspace's (cached per workspace): its links name that workspace with `?workspace=`, so they
 * open the same view.
 */
export const getDocsPage = (
  snapshot: SchemaSnapshot,
  urls: UrlBuilder,
  graphql: GraphqlConfig,
  siteKey: string,
) => {
  const entry = forSnapshot(snapshot, urls);
  const forSite = (path: string) =>
    `${urls.withBasePath(path)}?${WORKSPACE_QUERY_PARAMETER}=${encodeURIComponent(siteKey)}`;
  entry.html ??= renderDocsPage(
    entry.openApi as Parameters<typeof renderDocsPage>[0],
    forSite('/api/docs/openapi.json'),
    graphql.enabled
      ? {
          endpoint: forSite('/api/graphql'),
          playground: graphql.playgroundEnabled ? forSite('/api/graphql/playground') : undefined,
        }
      : undefined,
  );
  return entry.html;
};

export const getTypeScript = (snapshot: SchemaSnapshot, urls: UrlBuilder, schemaId?: string) => {
  const entry = forSnapshot(snapshot, urls);
  entry.typescript ??= generateTypeScript(snapshot, schemaId === undefined ? {} : { schemaId });
  return { schemaVersion: snapshot.version, source: entry.typescript };
};
