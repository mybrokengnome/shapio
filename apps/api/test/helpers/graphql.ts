import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

/** GraphQL requests and REST ↔ GraphQL twin comparisons (package J). */

/** Test apps for GraphQL tests turn the endpoint on explicitly (whatever the helper's default). */
export const GRAPHQL_ENV = { GRAPHQL_ENABLED: 'true' } as const;
export type GraphqlError = {
  message: string;
  path?: Array<string | number>;
  extensions?: { code?: string; details?: unknown } & Record<string, unknown>;
};
export type GraphqlBody<T = Record<string, unknown>> = { data?: T | null; errors?: GraphqlError[] };
export type GraphqlResult<T = Record<string, unknown>> = {
  statusCode: number;
  body: GraphqlBody<T>;
  response: LightMyRequestResponse;
};

type GraphqlOptions = {
  variables?: Record<string, unknown>;
  headers?: Record<string, string>;
  method?: 'GET' | 'POST';
  url?: string;
};

export const graphql = async <T = Record<string, unknown>>(
  app: FastifyInstance,
  query: string,
  { variables, headers = {}, method = 'POST', url = '/api/graphql' }: GraphqlOptions = {},
): Promise<GraphqlResult<T>> => {
  const response =
    method === 'GET'
      ? await app.inject({
          method: 'GET',
          url: `${url}?${new URLSearchParams({
            query,
            ...(variables ? { variables: JSON.stringify(variables) } : {}),
          }).toString()}`,
          headers,
        })
      : await app.inject({
          method: 'POST',
          url,
          headers,
          payload: { query, ...(variables ? { variables } : {}) },
        });
  return { statusCode: response.statusCode, body: response.json<GraphqlBody<T>>(), response };
};

/** The data of a response that must have no errors. */
export const dataOf = <T = Record<string, unknown>>(result: GraphqlResult<T>): T => {
  if (result.body.errors?.length || !result.body.data) {
    throw new Error(`GraphQL errors (${result.statusCode}): ${JSON.stringify(result.body.errors)}`);
  }
  return result.body.data;
};

export const errorCodes = (result: GraphqlResult<unknown>): Array<string | undefined> =>
  (result.body.errors ?? []).map((error) => error.extensions?.code);

type Shape = {
  /** Relation fields selected as `{ id }` that REST returns unpopulated (IDs). */
  idRelations?: readonly string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const lowerFirst = (name: string) => name.charAt(0).toLowerCase() + name.slice(1);

/**
 * A GraphQL value in REST's delivery shape: rich text `{ json, html }` → `{ ...json, html }`, dynamic-zone
 * `__typename` → `__component` (API key), relations selected as `{ id }` → IDs.
 */
export const toRestShape = (value: unknown, shape: Shape = {}): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => toRestShape(item, shape));
  }
  if (!isRecord(value)) {
    return value;
  }
  const keys = Object.keys(value);
  if (keys.length === 2 && keys.includes('json') && keys.includes('html') && isRecord(value.json)) {
    return { ...value.json, html: value.html };
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === '__typename') {
      output.__component = lowerFirst(String(item));
    } else if (shape.idRelations?.includes(key)) {
      output[key] = Array.isArray(item)
        ? item.map((target) => (target as { id: string }).id)
        : isRecord(item)
          ? item.id
          : item;
    } else {
      output[key] = toRestShape(item, shape);
    }
  }
  return output;
};

/** Asserts the GraphQL entries equal the REST entries after shape normalisation (order and values). */
export const expectSameEntries = (graphqlEntries: unknown, restEntries: unknown, shape: Shape = {}) => {
  expect(toRestShape(graphqlEntries, shape)).toEqual(restEntries);
};
