import { findModelByKey, useContentSchema } from './useContentSchema';

/**
 * Resolves a route's `modelKey` against the live schema (models are data, looked up at render time). A
 * failed refetch keeps the schema already loaded: the error only counts when there is none, so an open
 * editor never unmounts over a background request (e.g. while the session is resumed in place).
 */
export const useModelRoute = (modelKey: string) => {
  const { schema, error: schemaError } = useContentSchema();
  const model = schema ? findModelByKey(schema, modelKey) : undefined;
  const error = schema ? undefined : schemaError;
  return { schema, model, error, pending: !schema && !error };
};
