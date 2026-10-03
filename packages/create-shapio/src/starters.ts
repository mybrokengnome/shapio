/** The site starters `create-shapio --site` scaffolds (examples/<name> in the repository). */
export const SITE_STARTERS = ['astro', 'next', 'sveltekit'] as const;

export type SiteStarter = (typeof SITE_STARTERS)[number];

export const isSiteStarter = (value: string): value is SiteStarter =>
  (SITE_STARTERS as readonly string[]).includes(value);

/** npm leaves `.gitignore` out of published packages, so templates carry it under this name. */
export const PACKED_GITIGNORE = 'gitignore';
