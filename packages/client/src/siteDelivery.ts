import type { RequestFn } from './request.js';
import type { DeliverySite } from './seoTypes.js';

export const DELIVERY_SITE_PATH = '/api/site';

/** The request's site as delivery sees it (key, name, SEO defaults), with the client's token and site. */
export const createSiteApi = (request: RequestFn) => ({
  get: () => request<DeliverySite>(DELIVERY_SITE_PATH),
});

export type SiteApi = ReturnType<typeof createSiteApi>;
