import { z } from 'zod';

/** Matches the server's limit on `/api/graphql/playground?query=` (constants/graphql.ts). */
export const PLAYGROUND_QUERY_MAX_LENGTH = 8192;

/** `/develop/graphql?query=…`: the operation GraphiQL opens on ("Open in playground" in the API explorer). */
export const graphqlSearchSchema = z.object({
  query: z.string().max(PLAYGROUND_QUERY_MAX_LENGTH).optional().catch(undefined),
});

export type GraphqlSearch = z.infer<typeof graphqlSearchSchema>;
