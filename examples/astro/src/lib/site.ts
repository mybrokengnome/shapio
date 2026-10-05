/** The site's locales (they must exist in Shapio: the seed creates `fr`; `en` is Shapio's default). */
export const LOCALES = ['en', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';

/** The page whose slug is `home` is each locale's front page. */
export const HOME_SLUG = 'home';

export const isLocale = (value: string): value is Locale => (LOCALES as readonly string[]).includes(value);

const STRINGS = {
  en: {
    siteName: 'Northwind Studio',
    articles: 'Journal',
    readMore: 'Read the article',
    by: 'By',
    publishedOn: 'Published',
    switchTo: 'Français',
    allArticles: 'All articles',
    colophon: 'Colophon',
    previewBanner: 'Preview: this is a draft, not the published page.',
    previewLoading: 'Loading the draft…',
    previewFailed: 'The preview could not be loaded',
    skipToContent: 'Skip to content',
    drafts: 'Drafts',
    draftsNote: 'Drafts mode: this server shows saved drafts, not the published site.',
  },
  fr: {
    siteName: 'Studio Northwind',
    articles: 'Journal',
    readMore: "Lire l'article",
    by: 'Par',
    publishedOn: 'Publié le',
    switchTo: 'English',
    allArticles: 'Tous les articles',
    colophon: 'Colophon',
    previewBanner: 'Aperçu : ceci est un brouillon, pas la page publiée.',
    previewLoading: 'Chargement du brouillon…',
    previewFailed: "L'aperçu n'a pas pu être chargé",
    skipToContent: 'Aller au contenu',
    drafts: 'Brouillons',
    draftsNote: 'Mode brouillons : ce serveur montre les brouillons enregistrés, pas le site publié.',
  },
} as const satisfies Record<Locale, Record<string, string>>;

export type Strings = (typeof STRINGS)[Locale];

export const stringsFor = (locale: string): Strings => STRINGS[isLocale(locale) ? locale : DEFAULT_LOCALE];

export const otherLocale = (locale: Locale): Locale => (locale === 'en' ? 'fr' : 'en');

export const formatDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(iso));

export const pagePath = (locale: string, slug: string) =>
  slug === HOME_SLUG ? `/${locale}/` : `/${locale}/${slug}/`;
export const articlesPath = (locale: string) => `/${locale}/articles/`;
export const articlePath = (locale: string, slug: string) => `/${locale}/articles/${slug}/`;
export const colophonPath = (locale: string) => `/${locale}/colophon/`;
