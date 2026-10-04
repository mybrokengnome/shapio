import type { DocumentNode, GraphQLSchema } from 'graphql';
import { GRAPHQL_DOCUMENT_CACHE_SIZE } from '../../../constants/graphql.js';

/** A query parsed and validated against one schema (limits included), with what the request gate needs. */
export type PreparedDocument = { document: DocumentNode; selectsIntrospection: boolean };

/**
 * Valid documents per GraphQL schema, by source text (ADR 0006). Keyed by the schema object first, so a
 * query validated for one site's schema (or an older version) is never reused for another; a schema's
 * entries go with it. Each schema keeps its most recently used `maxEntries` documents.
 */
export type DocumentCache = {
  get: (schema: GraphQLSchema, source: string) => PreparedDocument | undefined;
  set: (schema: GraphQLSchema, source: string, prepared: PreparedDocument) => void;
};

export const createDocumentCache = (maxEntries: number = GRAPHQL_DOCUMENT_CACHE_SIZE): DocumentCache => {
  const bySchema = new WeakMap<GraphQLSchema, Map<string, PreparedDocument>>();
  return {
    get: (schema, source) => {
      const documents = bySchema.get(schema);
      const prepared = documents?.get(source);
      if (documents && prepared) {
        // Map order is insertion order: re-inserting marks the entry most recently used.
        documents.delete(source);
        documents.set(source, prepared);
      }
      return prepared;
    },
    set: (schema, source, prepared) => {
      let documents = bySchema.get(schema);
      if (!documents) {
        documents = new Map();
        bySchema.set(schema, documents);
      }
      documents.delete(source);
      documents.set(source, prepared);
      while (documents.size > maxEntries) {
        const oldest = documents.keys().next().value as string;
        documents.delete(oldest);
      }
    },
  };
};
