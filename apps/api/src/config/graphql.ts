import type { RawConfig } from './schema.js';

/** The GraphQL endpoint (package J, ADR 0006). */
export type GraphqlConfig = {
  /** Serve `/api/graphql`. */
  enabled: boolean;
  /** Deepest field nesting a query may have. */
  maxDepth: number;
  /** Highest estimated cost a query may have (schema/codegen/graphql/complexity.ts). */
  maxComplexity: number;
  /** Serve GraphiQL at `/api/graphql/playground` (admin principals only). */
  playgroundEnabled: boolean;
  /** Allow schema introspection for anonymous callers and app users (admins and API tokens always may). */
  publicIntrospection: boolean;
};

export const toGraphqlConfig = (raw: RawConfig): GraphqlConfig => ({
  enabled: raw.GRAPHQL_ENABLED,
  maxDepth: raw.GRAPHQL_MAX_DEPTH,
  maxComplexity: raw.GRAPHQL_MAX_COMPLEXITY,
  playgroundEnabled: raw.GRAPHQL_PLAYGROUND_ENABLED,
  publicIntrospection: raw.GRAPHQL_PUBLIC_INTROSPECTION,
});
