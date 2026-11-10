import type { FastifyRequest } from 'fastify';
import { getOperationAST, OperationTypeNode, type DocumentNode } from 'graphql';
import { schemaVersionToken } from '../constants/schemaLens.js';
import type { GraphqlRuntime } from '../plugins/graphql.js';
import type { UsageLens } from '../plugins/graphqlHooks.js';
import type { FormattedResult } from '../schema/codegen/graphql/errors.js';
import { lensVisibility } from '../schema/codegen/graphql/lensVisibility.js';
import type { BuiltSchema } from '../schema/codegen/graphql/schemaBuilder.js';
import type { SchemaVisibility } from '../schema/codegen/graphql/visibility.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import { activeLens, schemaIdOf, type ContentServiceContext } from '../services/contentAccess.js';
import { schemaVersionMetaOf } from '../services/contentDeliveryLens.js';
import { contentContextFor } from './contentContext.js';

/**
 * Schema lenses on `/api/graphql` (plan schema-lenses): a request naming a schema version
 * (`Shapio-Schema-Version`, or `?schemaVersion=` on GET; read by plugins/schemaLens.ts) is validated and
 * executed against the GraphQL schema of the workspace at that version, reads only. One naming the current
 * version, or a version since which nothing in the workspace changed, uses the current schema.
 */

/**
 * The content context of a request naming a schema version, with its lens (built once, before the schema is
 * chosen); undefined when it names none. Every GraphQL response carries the current version's token.
 */
export const graphqlLensOf = async (
  request: FastifyRequest,
  view: SchemaSnapshot,
): Promise<ContentServiceContext | undefined> => {
  request.schemaVersionCurrent = schemaVersionToken(await schemaIdOf(request.server.db), view.version);
  return request.schemaVersionToken === null ? undefined : contentContextFor(request);
};

/** The schema a request executes against: the client's version through an active lens, else the current one. */
export const graphqlSchemaFor = (
  runtime: GraphqlRuntime,
  view: SchemaSnapshot,
  visibility: SchemaVisibility,
  lensed: ContentServiceContext | undefined,
): Promise<BuiltSchema> => {
  const lens = lensed && activeLens(lensed);
  return lens && lensed
    ? runtime.schemas.getLens(lens.view, lensVisibility(visibility, lens.view, lensed.snapshot))
    : runtime.schemas.get(view, visibility);
};

/** Usage of an operation run through an active lens is counted under today's live fields only. */
export const usageLensOf = (
  lensed: ContentServiceContext | undefined,
  visibility: SchemaVisibility,
): UsageLens | undefined => {
  const lens = lensed && activeLens(lensed);
  return lens && lensed ? { lens, current: lensed.snapshot, visibility } : undefined;
};

/** Whether the operation a document runs is a mutation (or a subscription): never served through a lens. */
export const runsWrite = (document: DocumentNode, operationName: string | null | undefined): boolean => {
  const operation = getOperationAST(document, operationName ?? undefined)?.operation;
  return operation !== undefined && operation !== OperationTypeNode.QUERY;
};

/** `extensions.schemaVersion: { requested, current }` (tokens) on the response of a request naming a version. */
export const withSchemaVersion = (
  result: FormattedResult,
  lensed: ContentServiceContext | undefined,
): FormattedResult => {
  const { schemaVersion } = lensed ? schemaVersionMetaOf(lensed) : {};
  return schemaVersion
    ? { ...result, body: { ...result.body, extensions: { ...result.body.extensions, schemaVersion } } }
    : result;
};
