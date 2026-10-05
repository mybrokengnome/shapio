import { createContentHooks, type ContentHooks } from '../content/hooks.js';
import type { Database } from '../db/index.js';
import type { PermissionEvaluator, Principal } from '../permissions/types.js';
import type { NetworkSchema } from '../schema/snapshot.js';
import type { SiteRef } from './actorContext.js';
import type { ContentServiceContext } from './contentAccess.js';

/** What every caller of the content services has: an HTTP request, an extension service, an in-process read. */
export type ContentContextInput = {
  db: Database;
  /** The full schema the caller is pinned to; the context sees the site's view of it. */
  network: NetworkSchema;
  /** The caller's evaluator (memoized and version-bound for a request: `permissions/scoped.ts`). */
  permissions: PermissionEvaluator;
  actor: Principal;
  site: SiteRef;
  /** Lifecycle hooks for writes. Omitted: none (reads never reach a hook point). */
  hooks?: ContentHooks;
  media?: ContentServiceContext['media'];
  requestId?: string;
  ip?: string;
};

/**
 * The content service context for one call, the same however the call arrived: the site's view of the pinned
 * schema (plan site-schema: shared definitions and the site's own), scoped to the site.
 */
export const buildContentContext = ({
  network,
  hooks,
  media,
  requestId,
  ip,
  ...rest
}: ContentContextInput): ContentServiceContext => ({
  ...rest,
  snapshot: network.forSite(rest.site.id),
  hooks: hooks ?? createContentHooks(),
  ...(media ? { media } : {}),
  ...(requestId !== undefined ? { requestId } : {}),
  ...(ip !== undefined ? { ip } : {}),
});
