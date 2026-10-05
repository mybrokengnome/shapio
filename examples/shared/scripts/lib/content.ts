import type { Rgb } from './png.js';

/**
 * What the seed creates: placeholder images, one author, the site settings, two pages and three articles in
 * English and French. Two articles are published; the third stays a draft (for trying preview). Media and
 * author IDs are only known at run time, so the entries are functions of them.
 */
export type ImageSpec = { filename: string; alt: string; width: number; height: number; from: Rgb; to: Rgb };

export const IMAGES = {
  hero: {
    filename: 'hero.png',
    alt: 'An abstract blue gradient',
    width: 1600,
    height: 900,
    from: [37, 99, 235],
    to: [165, 180, 252],
  },
  galleryOne: {
    filename: 'gallery-1.png',
    alt: 'Studio desk at dawn',
    width: 1200,
    height: 900,
    from: [15, 23, 42],
    to: [37, 99, 235],
  },
  galleryTwo: {
    filename: 'gallery-2.png',
    alt: 'Workshop wall with sketches',
    width: 1200,
    height: 900,
    from: [165, 180, 252],
    to: [250, 249, 246],
  },
  galleryThree: {
    filename: 'gallery-3.png',
    alt: 'Evening light over the city',
    width: 1200,
    height: 900,
    from: [124, 58, 237],
    to: [37, 99, 235],
  },
  avatar: {
    filename: 'avatar.png',
    alt: 'Portrait of Ada Moreau',
    width: 400,
    height: 400,
    from: [250, 204, 21],
    to: [234, 88, 12],
  },
  coverOne: {
    filename: 'cover-modelling.png',
    alt: 'Blocks arranged into a grid',
    width: 1600,
    height: 900,
    from: [16, 185, 129],
    to: [37, 99, 235],
  },
  coverTwo: {
    filename: 'cover-snapshots.png',
    alt: 'A camera shutter in blue',
    width: 1600,
    height: 900,
    from: [37, 99, 235],
    to: [15, 23, 42],
  },
} as const satisfies Record<string, ImageSpec>;

export type MediaIds = Record<keyof typeof IMAGES, string>;

type Localized<T> = { en: T; fr: T };

const text = (value: string) => ({ type: 'text', text: value });
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
const heading = (level: number, value: string) => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const cell = (type: 'tableHeader' | 'tableCell', value: string) => ({
  type,
  content: [paragraph(text(value))],
});
const richText = (...content: unknown[]) => ({
  format: 'shapio-richtext',
  version: 1,
  doc: { type: 'doc', content },
});

export const AUTHOR = {
  name: 'Ada Moreau',
  bio: 'Editor at Northwind Studio. Writes about content models, publishing and the web.',
};

/** The `siteSettings` singleton: the name, tagline and footer every page shows, and the colophon page. */
export const SITE_SETTINGS: Localized<Record<string, unknown>> = {
  en: {
    siteName: 'Northwind Studio',
    tagline: 'Fast, well-made websites from structured content.',
    footer: 'Built with Shapio',
    colophon: richText(
      paragraph(
        text('This site is built from Shapio content, pinned to one publication snapshot per build.'),
      ),
      paragraph(text('Its name, tagline and footer come from a singleton model: edit them once, rebuild.')),
    ),
  },
  fr: {
    siteName: 'Studio Northwind',
    tagline: 'Des sites rapides et soignés, construits à partir de contenu structuré.',
    footer: 'Construit avec Shapio',
    colophon: richText(
      paragraph(
        text(
          'Ce site est construit à partir du contenu de Shapio, figé sur un instantané de publication par build.',
        ),
      ),
      paragraph(text('Son nom, son slogan et son pied de page viennent d’un modèle singleton.')),
    ),
  },
};

const home = (media: MediaIds): Localized<Record<string, unknown>> => ({
  en: {
    title: 'Home',
    slug: 'home',
    description: 'Northwind Studio builds fast, well-made websites from structured content.',
    sections: [
      {
        __component: 'hero',
        heading: 'Content that changes as fast as your product',
        subheading: 'Model it live, edit it in two languages, publish it through to a static site.',
        image: media.hero,
        ctaLabel: 'Read the journal',
        ctaUrl: '/en/articles/',
      },
      {
        __component: 'featureGrid',
        heading: 'What we do',
        features: [
          {
            title: 'Content models',
            description: 'Pages, articles and reusable sections, changed without a deploy.',
          },
          {
            title: 'Two languages',
            description: 'Every page in English and French, published per language.',
          },
          {
            title: 'Static delivery',
            description: 'Each build reads one pinned snapshot, then ships plain HTML.',
          },
        ],
      },
      {
        __component: 'gallery',
        heading: 'From the studio',
        images: [media.galleryOne, media.galleryTwo, media.galleryThree],
      },
      {
        __component: 'callToAction',
        heading: 'Start a project with us',
        text: 'Tell us what you are building.',
        buttonLabel: 'Get in touch',
        buttonUrl: 'mailto:hello@example.com',
      },
    ],
  },
  fr: {
    title: 'Accueil',
    description: 'Le Studio Northwind construit des sites rapides et soignés à partir de contenu structuré.',
    sections: [
      {
        __component: 'hero',
        heading: 'Un contenu qui évolue aussi vite que votre produit',
        subheading: 'Modélisez-le en direct, rédigez-le en deux langues, publiez-le jusqu’au site statique.',
        image: media.hero,
        ctaLabel: 'Lire le journal',
        ctaUrl: '/fr/articles/',
      },
      {
        __component: 'featureGrid',
        heading: 'Ce que nous faisons',
        features: [
          {
            title: 'Modèles de contenu',
            description: 'Pages, articles et sections réutilisables, modifiés sans déploiement.',
          },
          {
            title: 'Deux langues',
            description: 'Chaque page en anglais et en français, publiée langue par langue.',
          },
          {
            title: 'Diffusion statique',
            description: 'Chaque build lit un instantané figé, puis livre du HTML simple.',
          },
        ],
      },
      {
        __component: 'gallery',
        heading: 'Au studio',
        images: [media.galleryOne, media.galleryTwo, media.galleryThree],
      },
      {
        __component: 'callToAction',
        heading: 'Lancez un projet avec nous',
        text: 'Dites-nous ce que vous construisez.',
        buttonLabel: 'Nous écrire',
        buttonUrl: 'mailto:hello@example.com',
      },
    ],
  },
});

const about = (): Localized<Record<string, unknown>> => ({
  en: {
    title: 'About the studio',
    slug: 'about',
    description: 'Who we are and how we work.',
    sections: [
      {
        __component: 'featureGrid',
        heading: 'How we work',
        features: [
          { title: 'Small team', description: 'Three people, one shared content model.' },
          { title: 'Open tools', description: 'Self-hosted, open-source, no vendor lock-in.' },
        ],
      },
      {
        __component: 'callToAction',
        heading: 'Read our journal',
        text: 'Notes on modelling, publishing and building.',
        buttonLabel: 'Open the journal',
        buttonUrl: '/en/articles/',
      },
    ],
  },
  fr: {
    title: 'À propos du studio',
    description: 'Qui nous sommes et comment nous travaillons.',
    sections: [
      {
        __component: 'featureGrid',
        heading: 'Notre façon de travailler',
        features: [
          { title: 'Petite équipe', description: 'Trois personnes, un seul modèle de contenu partagé.' },
          {
            title: 'Outils ouverts',
            description: 'Auto-hébergé, open source, sans dépendance à un fournisseur.',
          },
        ],
      },
      {
        __component: 'callToAction',
        heading: 'Lisez notre journal',
        text: 'Des notes sur la modélisation, la publication et la construction.',
        buttonLabel: 'Ouvrir le journal',
        buttonUrl: '/fr/articles/',
      },
    ],
  },
});

const modelling = (media: MediaIds, authorId: string): Localized<Record<string, unknown>> => ({
  en: {
    title: 'Modelling content without a deploy',
    slug: 'modelling-without-a-deploy',
    excerpt: 'We added a field to our article model on a Tuesday afternoon. Nothing restarted.',
    publishedOn: '2026-09-01',
    cover: media.coverOne,
    author: authorId,
    body: richText(
      paragraph(text('Our article model needed a new field. In Shapio that is a form, not a migration.')),
      heading(2, 'What changed'),
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              paragraph(
                text('The model got an optional '),
                { type: 'text', text: 'excerpt', marks: [{ type: 'code' }] },
                text(' field.'),
              ),
            ],
          },
          { type: 'listItem', content: [paragraph(text('The API served it at once, in REST and GraphQL.'))] },
        ],
      },
      { type: 'image', attrs: { mediaId: media.galleryOne, alt: 'Studio desk at dawn' } },
      heading(2, 'Before and after'),
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              cell('tableHeader', 'Step'),
              cell('tableHeader', 'Before'),
              cell('tableHeader', 'With Shapio'),
            ],
          },
          {
            type: 'tableRow',
            content: [
              cell('tableCell', 'Add a field'),
              cell('tableCell', 'Pull request, deploy'),
              cell('tableCell', 'Save the model'),
            ],
          },
          {
            type: 'tableRow',
            content: [cell('tableCell', 'Restart'), cell('tableCell', 'Yes'), cell('tableCell', 'No')],
          },
        ],
      },
      paragraph(
        text('Read more in the '),
        {
          type: 'text',
          text: 'Shapio docs',
          marks: [{ type: 'link', attrs: { href: 'https://github.com/mybrokengnome/shapio' } }],
        },
        text('.'),
      ),
    ),
  },
  fr: {
    title: 'Modéliser du contenu sans déploiement',
    excerpt: 'Nous avons ajouté un champ à notre modèle d’article un mardi après-midi. Rien n’a redémarré.',
    body: richText(
      paragraph(
        text(
          'Notre modèle d’article avait besoin d’un nouveau champ. Dans Shapio, c’est un formulaire, pas une migration.',
        ),
      ),
      heading(2, 'Ce qui a changé'),
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              paragraph(
                text('Le modèle a reçu un champ facultatif '),
                { type: 'text', text: 'excerpt', marks: [{ type: 'code' }] },
                text('.'),
              ),
            ],
          },
          {
            type: 'listItem',
            content: [paragraph(text('L’API l’a servi aussitôt, en REST et en GraphQL.'))],
          },
        ],
      },
      { type: 'image', attrs: { mediaId: media.galleryOne, alt: 'Un bureau à l’aube' } },
      heading(2, 'Avant et après'),
      {
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              cell('tableHeader', 'Étape'),
              cell('tableHeader', 'Avant'),
              cell('tableHeader', 'Avec Shapio'),
            ],
          },
          {
            type: 'tableRow',
            content: [
              cell('tableCell', 'Ajouter un champ'),
              cell('tableCell', 'Pull request, déploiement'),
              cell('tableCell', 'Enregistrer le modèle'),
            ],
          },
          {
            type: 'tableRow',
            content: [cell('tableCell', 'Redémarrer'), cell('tableCell', 'Oui'), cell('tableCell', 'Non')],
          },
        ],
      },
    ),
  },
});

const snapshots = (media: MediaIds, authorId: string): Localized<Record<string, unknown>> => ({
  en: {
    title: 'Why our builds pin a snapshot',
    slug: 'why-builds-pin-a-snapshot',
    excerpt: 'A build that reads content for two minutes must not show two different moments.',
    publishedOn: '2026-09-15',
    cover: media.coverTwo,
    author: authorId,
    body: richText(
      paragraph(
        text(
          'Every build of this site asks Shapio for the current publication snapshot once, then reads every page at that snapshot.',
        ),
      ),
      {
        type: 'blockquote',
        content: [paragraph(text('A publish during the build waits for the next build.'))],
      },
    ),
  },
  fr: {
    title: 'Pourquoi nos builds figent un instantané',
    excerpt: 'Un build qui lit du contenu pendant deux minutes ne doit pas montrer deux moments différents.',
    body: richText(
      paragraph(
        text(
          'Chaque build de ce site demande une fois l’instantané de publication courant à Shapio, puis lit chaque page à cet instantané.',
        ),
      ),
      {
        type: 'blockquote',
        content: [paragraph(text('Une publication pendant le build attend le build suivant.'))],
      },
    ),
  },
});

/** Never published: open it in the admin and use Preview. */
const draft = (media: MediaIds, authorId: string): Localized<Record<string, unknown>> => ({
  en: {
    title: 'Coming soon: our winter projects',
    slug: 'winter-projects',
    excerpt: 'A draft that only preview can show.',
    publishedOn: '2026-12-01',
    cover: media.coverOne,
    author: authorId,
    body: richText(paragraph(text('This article is still a draft.'))),
  },
  fr: {
    title: 'Bientôt : nos projets d’hiver',
    excerpt: 'Un brouillon que seul l’aperçu peut montrer.',
    body: richText(paragraph(text('Cet article est encore un brouillon.'))),
  },
});

export type EntrySpec = {
  model: 'page' | 'article';
  slug: string;
  content: Localized<Record<string, unknown>>;
  publish: boolean;
};

/**
 * The SEO fields of one locale (the built-in `seo` component, per locale): a page describes itself with its
 * description, an article with its excerpt and its cover (a shared field, so it comes from the English data).
 * The title stays empty: `?seo=resolved` falls back to the entry's own title, through the site's template.
 */
const seoOf = (data: Record<string, unknown>, shared: Record<string, unknown>) => ({
  description: data.excerpt ?? data.description ?? null,
  image: shared.cover ?? null,
});

const withSeo = (content: Localized<Record<string, unknown>>): Localized<Record<string, unknown>> => ({
  en: { ...content.en, seo: seoOf(content.en, content.en) },
  fr: { ...content.fr, seo: seoOf(content.fr, content.en) },
});

export const entries = (media: MediaIds, authorId: string): EntrySpec[] => [
  { model: 'page', slug: 'home', content: withSeo(home(media)), publish: true },
  { model: 'page', slug: 'about', content: withSeo(about()), publish: true },
  {
    model: 'article',
    slug: 'modelling-without-a-deploy',
    content: withSeo(modelling(media, authorId)),
    publish: true,
  },
  {
    model: 'article',
    slug: 'why-builds-pin-a-snapshot',
    content: withSeo(snapshots(media, authorId)),
    publish: true,
  },
  { model: 'article', slug: 'winter-projects', content: withSeo(draft(media, authorId)), publish: false },
];

/**
 * The site's SEO defaults (Settings → SEO; `PUT /api/admin/site/seo`): the name and template match the
 * siteSettings singleton's site name, the description its tagline; the hero image is the default social image.
 */
export const seoDefaults = (media: MediaIds) => ({
  locales: {
    en: {
      siteName: String(SITE_SETTINGS.en.siteName),
      titleTemplate: `%s · ${String(SITE_SETTINGS.en.siteName)}`,
      description: String(SITE_SETTINGS.en.tagline),
    },
    fr: {
      siteName: String(SITE_SETTINGS.fr.siteName),
      titleTemplate: `%s · ${String(SITE_SETTINGS.fr.siteName)}`,
      description: String(SITE_SETTINGS.fr.tagline),
    },
  },
  imageId: media.hero,
  twitterHandle: '@northwindstudio',
});
