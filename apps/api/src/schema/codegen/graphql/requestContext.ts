import type { PermissionEvaluator } from '../../../permissions/types.js';
import type { SiteRef } from '../../../services/actorContext.js';
import type { ContentServiceContext } from '../../../services/contentAccess.js';
import type { SchemaSnapshot } from '../../snapshot.js';
import type { GraphqlRequestContext } from './context.js';
import { createLoaders } from './loaders.js';

type GraphqlContextInput = {
  site: SiteRef;
  /** The operation's evaluator, memoized per (model, action). */
  permissions: PermissionEvaluator;
  /** The content service context, built on first use; the snapshot is the one the schema was built from. */
  content: (snapshot: SchemaSnapshot) => Promise<ContentServiceContext>;
};

/**
 * The context every resolver of one operation receives, with its own DataLoaders. Carries no HTTP objects, so
 * an operation can run outside a request.
 */
export const createGraphqlContext = ({
  site,
  permissions,
  content,
}: GraphqlContextInput): GraphqlRequestContext => {
  let base: Promise<ContentServiceContext> | undefined;
  let drafts = false;
  const contentAt = async (snapshot: SchemaSnapshot): Promise<ContentServiceContext> => {
    base ??= content(snapshot);
    return { ...(await base), snapshot, permissions };
  };
  return {
    permissions,
    markDrafts: () => {
      drafts = true;
    },
    readDrafts: () => drafts,
    site,
    loaders: createLoaders(() => site.id, contentAt),
    content: contentAt,
  };
};
