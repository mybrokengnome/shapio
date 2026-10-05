/**
 * `@shapio/schema/seo`: the SEO resolver and its helpers for sites and clients (plan seo-fields). A separate
 * entry with no validator or TypeBox code, so a site bundle that resolves SEO stays small.
 */
export * from './seo/ids.js';
export * from './seo/locale.js';
export * from './seo/resolve.js';
export type { SeoDefaults, SeoLocaleDefaults } from './seo/defaults.js';
