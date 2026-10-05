import { createDeliveryApi } from './delivery.js';
import type { NextCacheOptions } from './nextCache.js';
import type { RequestFn } from './request.js';
import { createSiteApi } from './siteDelivery.js';
import { createSnapshotsApi } from './snapshots.js';

export type DeliveryClientOptions = {
  /** The site key the reads are tagged with (`shapioTags.site`); the transport names the site itself. */
  site?: string;
  /** Next.js data-cache options, as `createClient`'s `next` option. */
  next?: NextCacheOptions | false;
};

/**
 * The read side of the client over any transport: published content (`delivery`), the site (`site`) and
 * publication snapshots (`snapshots`). `createClient` builds it over HTTP; `@shapio/local` over the delivery
 * API running in the same process. The transport receives exactly the paths the HTTP client sends.
 */
export const createDeliveryClient = (request: RequestFn, { site, next }: DeliveryClientOptions = {}) => {
  const cacheContext = { site, next };
  return {
    /** Published content (the delivery API), typed by the caller. */
    delivery: createDeliveryApi(request, cacheContext),
    /** The site as delivery sees it: key, name and SEO defaults (`GET /api/site`). */
    site: createSiteApi(request, cacheContext),
    /** Publication snapshots and the diff between two (incremental builds). */
    snapshots: createSnapshotsApi(request),
  };
};

export type ShapioDeliveryClient = ReturnType<typeof createDeliveryClient>;
