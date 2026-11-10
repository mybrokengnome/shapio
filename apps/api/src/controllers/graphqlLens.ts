import type { FastifyRequest } from 'fastify';
import type { DocumentNode } from 'graphql';
import { schemaVersionToken } from '../constants/schemaLens.js';
import type { AppError } from '../helpers/appError.js';
import type { GraphqlRuntime } from '../plugins/graphql.js';
import type { UsageLens } from '../plugins/graphqlHooks.js';
import type { FormattedResult } from '../schema/codegen/graphql/errors.js';
import { unavailableRootField } from '../schema/codegen/graphql/lensUnavailable.js';
import { lensVisibility } from '../schema/codegen/graphql/lensVisibility.js';
import type { BuiltSchema } from '../schema/codegen/graphql/schemaBuilder.js';
import type { SchemaVisibility } from '../schema/codegen/graphql/visibility.js';
import { schemaVersionUnavailable } from '../schema/errors.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import {
  activeLens,
  pinnedSchemaVersionOf,
  schemaIdOf,
  type ContentServiceContext,
} from '../services/contentAccess.js';
import { schemaVersionMetaOf } from '../services/contentDeliveryLens.js';
import { contentContextFor } from './contentContext.js';

/**
 * Schema lenses on `/api/graphql` (plan schema-lenses): a request naming a schema version
 * (`Shapio-Schema-Version`, or `?schemaVersion=` on GET; read by plugins/schemaLens.ts) is validated and
 * executed against the GraphQL schema of the workspace at that version; an API token pinned to a version names
 * it when the request names none. One naming the current version, or a version since which nothing in the
 * workspace changed, uses the current schema.
 */

/**
 * The content context of a request naming a schema version (or made with a pinned token), with its lens
 * (built once, before the schema is chosen); undefined when it names none. Every GraphQL response carries the
 * current version's token.
 */
export const graphqlLensOf = async (
  request: FastifyRequest,
  view: SchemaSnapshot,
  /** false: answer as if no version were named (a caller allowed no content); the header is still sent. */
  loadLens = true,
): Promise<ContentServiceContext | undefined> => {
  request.schemaVersionCurrent = schemaVersionToken(await schemaIdOf(request.server.db), view.version);
  // An API token pinned to a schema version names it when the request names none.
  const namesVersion =
    request.schemaVersionToken !== null || pinnedSchemaVersionOf(request.principal) !== null;
  return namesVersion && loadLens ? contentContextFor(request) : undefined;
};

/** The schema a request executes against: the client's version through an active lens, else the current one. */
export const graphqlSchemaFor = (
  runtime: GraphqlRuntime,
  view: SchemaSnapshot,
  visibility: SchemaVisibility,
  lensed: ContentServiceContext | undefined,
  /** The caller's lens build budget, asked only when the lens schema is not cached (429 when spent). */
  admit?: () => boolean,
): Promise<BuiltSchema> => {
  const lens = lensed && activeLens(lensed);
  return lens && lensed
    ? runtime.schemas.getLens(
        lens.view,
        lensVisibility(visibility, lens.view, lensed.snapshot, lens.unavailable),
        admit ? { admit } : {},
      )
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

/**
 * A lensed document that failed validation because it names a definition the client's version cannot be served
 * for (left out of the lens schema): `409 SCHEMA_VERSION_UNAVAILABLE`, as REST answers, rather than a
 * validation error that would read as if the definition never existed.
 */
export const unavailableDefinitionError = (
  lensed: ContentServiceContext | undefined,
  /** The caller's visibility today: only definitions it may use are ever named. */
  visibility: SchemaVisibility,
  document: DocumentNode,
  operationName: string | null | undefined,
): AppError | undefined => {
  const lens = lensed && activeLens(lensed);
  const cause = lens
    ? unavailableRootField(lens.view, lens.unavailable, visibility, document, operationName)
    : undefined;
  return cause ? schemaVersionUnavailable(cause.apiKey, cause.oldestVersion) : undefined;
};
