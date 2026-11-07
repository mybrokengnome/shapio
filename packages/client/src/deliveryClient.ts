import { createDeliveryApi } from './delivery.js';
import type { NextCacheOptions } from './nextCache.js';
import type { RequestFn } from './request.js';
import { resolveWorkspaceOption } from './site.js';
import { createSiteApi } from './siteDelivery.js';
import { createSnapshotsApi } from './snapshots.js';

export type DeliveryClientOptions = {
  /**
   * The workspace key the reads are tagged with (`shapioTags.workspace`); the transport names the workspace
   * itself. Same as `site`; both set to different keys throws.
   */
  workspace?: string;
  /** The older name of `workspace`. */
  site?: string;
  /** Next.js data-cache options, as `createClient`'s `next` option. */
  next?: NextCacheOptions | false;
  /** Drafts mode, as `createClient`'s `drafts` option. */
  drafts?: boolean;
};

/**
 * The read side of the client over any transport: published content (`delivery`), the workspace (`workspace`,
 * also as `site`) and publication snapshots (`snapshots`). `createClient` builds it over HTTP; `@shapio/local`
 * over the delivery API running in the same process. The transport receives exactly the paths the HTTP client
 * sends.
 */
export const createDeliveryClient = (
  request: RequestFn,
  { workspace, site, next, drafts = false }: DeliveryClientOptions = {},
) => {
  const cacheContext = {
    site: resolveWorkspaceOption({ workspace, site }, 'createDeliveryClient'),
    next,
    drafts,
  };
  const workspaceApi = createSiteApi(request, cacheContext);
  return {
    /** Published content (the delivery API; drafts in drafts mode), typed by the caller. */
    delivery: createDeliveryApi(request, cacheContext),
    /** The workspace as delivery sees it: key, name and SEO defaults (`GET /api/site`). */
    workspace: workspaceApi,
    /** The older name of `workspace`. */
    site: workspaceApi,
    /** Publication snapshots and the diff between two (incremental builds). */
    snapshots: createSnapshotsApi(request),
  };
};

export type ShapioDeliveryClient = ReturnType<typeof createDeliveryClient>;
