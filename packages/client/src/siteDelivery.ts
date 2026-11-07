import {
  nextFetchInit,
  shapioTags,
  type DeliveryCacheContext,
  type DeliveryReadOptions,
} from './nextCache.js';
import type { RequestFn } from './request.js';
import type { DeliverySite } from './seoTypes.js';

/** The workspace as delivery sees it. Every server version serves this path, so the client reads it. */
export const DELIVERY_SITE_PATH = '/api/site';

/** The newer path of the same read (server 0.8.2 or later); a raw GET there names its workspace like `/api/site`. */
export const DELIVERY_WORKSPACE_PATH = '/api/workspace';

/**
 * The request's workspace as delivery sees it (key, name, SEO defaults), with the client's token and
 * workspace. Under Next.js the read carries the workspace tag (nextCache.ts); in drafts mode it is `no-store`
 * and untagged instead (the workspace has no draft state, so no `publicationState` is sent).
 */
export const createSiteApi = (request: RequestFn, cacheContext: DeliveryCacheContext) => ({
  get: ({ next }: DeliveryReadOptions = {}) =>
    request<DeliverySite>(
      DELIVERY_SITE_PATH,
      nextFetchInit({
        client: cacheContext.next,
        read: next,
        tags: [shapioTags.site(cacheContext.site)],
        pinned: false,
        drafts: cacheContext.drafts,
      }),
    ),
});

export type SiteApi = ReturnType<typeof createSiteApi>;

/** The workspace delivery API (`client.workspace`); the same as `SiteApi`. */
export type WorkspaceApi = SiteApi;
