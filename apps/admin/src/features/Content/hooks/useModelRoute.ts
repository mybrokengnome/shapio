import { findModelByKey, useContentSchema } from './useContentSchema';

/** Resolves a route's `modelKey` against the live schema (models are data, looked up at render time). */
export const useModelRoute = (modelKey: string) => {
  const { schema, error } = useContentSchema();
  const model = schema ? findModelByKey(schema, modelKey) : undefined;
  return { schema, model, error, pending: !schema && !error };
};
