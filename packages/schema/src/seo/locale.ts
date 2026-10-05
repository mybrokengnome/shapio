import type { SeoDefaults, SeoLocaleDefaults } from './defaults.js';
import { SEO_TITLE_PLACEHOLDER, SEO_TITLE_TEMPLATE_PATTERN } from './ids.js';

/** No defaults saved yet. */
export const EMPTY_SEO_DEFAULTS: SeoDefaults = { locales: {}, imageId: null, twitterHandle: null };

export const isValidTitleTemplate = (template: string): boolean => SEO_TITLE_TEMPLATE_PATTERN.test(template);

/**
 * One locale's effective default texts: each key from the first locale of the chain that sets it (the
 * requested locale, then its fallbacks, then the default locale).
 */
export const seoDefaultsForLocale = (
  defaults: Pick<SeoDefaults, 'locales'>,
  localeChain: readonly string[],
): SeoLocaleDefaults => {
  const pick = (key: keyof SeoLocaleDefaults) =>
    localeChain.map((code) => defaults.locales[code]?.[key]).find((value) => value !== undefined);
  const siteName = pick('siteName');
  const titleTemplate = pick('titleTemplate');
  const description = pick('description');
  return {
    ...(siteName !== undefined ? { siteName } : {}),
    ...(titleTemplate !== undefined ? { titleTemplate } : {}),
    ...(description !== undefined ? { description } : {}),
  };
};

/** Applies a title template (`%s` replaced once); an invalid template leaves the title as is. */
export const applyTitleTemplate = (title: string, template: string | undefined): string =>
  template !== undefined && isValidTitleTemplate(template)
    ? template.replace(SEO_TITLE_PLACEHOLDER, () => title)
    : title;
