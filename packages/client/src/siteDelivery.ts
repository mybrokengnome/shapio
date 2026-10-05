import {
  nextFetchInit,
  shapioTags,
  type DeliveryCacheContext,
  type DeliveryReadOptions,
} from './nextCache.js';
import type { RequestFn } from './request.js';
import type { DeliverySite } from './seoTypes.js';

export const DELIVERY_SITE_PATH = '/api/site';

/**
 * The request's site as delivery sees it (key, name, SEO defaults), with the client's token and site. Under
 * Next.js the read carries the site tag (nextCache.ts).
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
      }),
    ),
});

export type SiteApi = ReturnType<typeof createSiteApi>;
