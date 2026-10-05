/**
 * The built-in SEO component (plan seo-fields). It is ordinary schema data, created through the change planner
 * and always shared with every site; what makes it "the" SEO component is its stable ID, never its API ID, so
 * a renamed or extended copy is still recognised and an unrelated `seo` component (an import) never is.
 */
export const SEO_COMPONENT_ID = 'f3905a00-d2a3-4c62-899a-c894bfd6cb9b';

/** The API ID the built-in is created with (it may be renamed later; detection never relies on it). */
export const SEO_COMPONENT_API_KEY = 'seo';

/** Stable field IDs of the built-in's fields. Resolver and admin look fields up by these. */
export const SEO_FIELD_IDS = {
  title: '3fe294a9-6af9-4019-8b32-43010822e45a',
  description: '6d1917f3-94a2-4391-ba1f-a98d14577b93',
  image: 'd27c9354-4afc-4583-93b4-367214a7714a',
  canonical: '17b374b6-cd85-444e-8403-20c7458ed29e',
  noindex: 'e8346f99-dc3c-4b5c-906f-4854e03c9a57',
} as const;

export type SeoFieldKey = keyof typeof SEO_FIELD_IDS;

/** The built-in editor for a field holding the SEO component (preview and counters in the admin). */
export const SEO_EDITOR_ID = 'seoEditor';

/** Admin-only counters: lengths past which search results usually truncate. Never enforced. */
export const SEO_TITLE_SOFT_MAX = 70;
export const SEO_DESCRIPTION_SOFT_MAX = 160;

/** The placeholder a title template must contain exactly once. */
export const SEO_TITLE_PLACEHOLDER = '%s';

/** A title template holds the placeholder exactly once, e.g. `%s · Acme`. */
export const SEO_TITLE_TEMPLATE_PATTERN = /^(?:(?!%s)[\s\S])*%s(?:(?!%s)[\s\S])*$/;

/** A Twitter/X handle with its `@`. */
export const SEO_TWITTER_HANDLE_PATTERN = /^@[A-Za-z0-9_]{1,15}$/;
