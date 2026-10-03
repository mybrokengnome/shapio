/** The site's locales (they must exist in Shapio: the seed creates `fr`; `en` is Shapio's default). */
export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** The page whose slug is `home` is each locale's front page. */
export const HOME_SLUG = 'home';

export const isLocale = (value: string): value is Locale => (LOCALES as readonly string[]).includes(value);

/** Reads a route's `[locale]` segment; the layout only generates known locales (dynamicParams = false). */
export const toLocale = (value: string): Locale => (isLocale(value) ? value : DEFAULT_LOCALE);

const STRINGS = {
  en: {
    siteName: 'Northwind Studio',
    articles: 'Journal',
    colophon: 'Colophon',
    by: 'By',
    switchTo: 'Français',
    skipToContent: 'Skip to content',
    footer: 'Built with Shapio',
    previewBanner: 'Preview: this is a draft, not the published page.',
    previewLoading: 'Loading the draft…',
    previewFailed: 'The preview could not be loaded',
    previewIncomplete: 'This preview link is incomplete.',
  },
  fr: {
    siteName: 'Studio Northwind',
    articles: 'Journal',
    colophon: 'Colophon',
    by: 'Par',
    switchTo: 'English',
    skipToContent: 'Aller au contenu',
    footer: 'Construit avec Shapio',
    previewBanner: 'Aperçu : ceci est un brouillon, pas la page publiée.',
    previewLoading: 'Chargement du brouillon…',
    previewFailed: "L'aperçu n'a pas pu être chargé",
    previewIncomplete: "Ce lien d'aperçu est incomplet.",
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type Strings = (typeof STRINGS)[Locale];

export const stringsFor = (locale: Locale): Strings => STRINGS[locale];

export const otherLocale = (locale: Locale): Locale => (locale === 'en' ? 'fr' : 'en');

export const formatDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));

export const pagePath = (locale: string, slug: string) =>
  slug === HOME_SLUG ? `/${locale}/` : `/${locale}/${slug}/`;
export const articlesPath = (locale: string) => `/${locale}/articles/`;
export const articlePath = (locale: string, slug: string) => `/${locale}/articles/${slug}/`;
export const colophonPath = (locale: string) => `/${locale}/colophon/`;

/** The same path in another locale (slugs are shared across locales in this starter's models). */
export const switchLocale = (pathname: string, locale: Locale) =>
  pathname.replace(/^\/(en|fr)(?=\/|$)/, `/${locale}`);

/** Links from content: web, mail, phone and site-relative only (a `javascript:` URL becomes `#`). */
export const safeHref = (value: string | null | undefined): string => {
  const href = (value ?? '').trim();
  return /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(href) ? href : '#';
};
