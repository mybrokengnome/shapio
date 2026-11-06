import { copyServices } from './copyServices.js';
import type { ExtensionServices, ExtensionSite } from './public.js';

/**
 * The services a hook gets: Shapio's bound to the hook's site, the project's custom services as they are
 * (constructed once; they read the site they are given). Always bound, even on the primary site: the
 * top-level services follow the primary, which may move to another site while the hook runs.
 */
export const servicesForSite = (services: ExtensionServices, site: ExtensionSite): ExtensionServices => {
  const bound = services.forSite(site);
  return Object.freeze(
    copyServices(services, {
      site: bound.site,
      forSite: bound.forSite,
      content: bound.content,
      media: bound.media,
    }),
  );
};
