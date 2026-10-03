import type { ExtensionServices, ExtensionSite } from './public.js';

/**
 * The services a hook gets: Shapio's bound to the hook's site, the project's custom services as they are
 * (constructed once; they read the site they are given).
 */
export const servicesForSite = (services: ExtensionServices, site: ExtensionSite): ExtensionServices => {
  if (services.site.id === site.id) {
    return services;
  }
  const bound = services.forSite(site);
  return Object.freeze({
    ...services,
    site: bound.site,
    forSite: bound.forSite,
    content: bound.content,
    media: bound.media,
  });
};
