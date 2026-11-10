import type { PermissionEvaluator } from '../../../permissions/types.js';
import type { SiteRef } from '../../../services/actorContext.js';
import { activeLens, type ContentServiceContext } from '../../../services/contentAccess.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { GraphqlRequestContext } from './context.js';
import { createLoaders } from './loaders.js';

type GraphqlContextInput = {
  site: SiteRef;
  /** The operation's evaluator, memoized per (model, action). */
  permissions: PermissionEvaluator;
  /** The content service context, built on first use; the snapshot is the one the schema was built from. */
  content: (snapshot: SchemaSnapshot) => Promise<ContentServiceContext>;
  /**
   * A request naming a schema version (plan schema-lenses): its content context, built before the schema was
   * chosen, with the lens. Reads through an active lens keep its snapshot (today's view, which the lens was
   * compiled against) whatever schema they were built from: the lens schema is the client's version.
   */
  lensed?: ContentServiceContext;
};

/**
 * The context every resolver of one operation receives, with its own DataLoaders. Carries no HTTP objects, so
 * an operation can run outside a request.
 */
export const createGraphqlContext = ({
  site,
  permissions,
  content,
  lensed,
}: GraphqlContextInput): GraphqlRequestContext => {
  let base: Promise<ContentServiceContext> | undefined = lensed ? Promise.resolve(lensed) : undefined;
  const throughLens = lensed !== undefined && activeLens(lensed) !== undefined;
  let drafts = false;
  const contentAt = async (snapshot: SchemaSnapshot): Promise<ContentServiceContext> => {
    base ??= content(snapshot);
    const context = await base;
    return throughLens ? { ...context, permissions } : { ...context, snapshot, permissions };
  };
  return {
    permissions,
    markDrafts: () => {
      drafts = true;
    },
    readDrafts: () => drafts,
    site,
    loaders: createLoaders(() => site.id, contentAt, lensed?.lens?.requested ?? null),
    ...(lensed?.lens ? { schemaVersion: lensed.lens.requested } : {}),
    content: contentAt,
  };
};
