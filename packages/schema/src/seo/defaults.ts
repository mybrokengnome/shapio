import { Type, type Static } from 'typebox';
import { LOCALE_CODE_PATTERN } from '../types/locales.js';
import { SEO_TITLE_TEMPLATE_PATTERN, SEO_TWITTER_HANDLE_PATTERN } from './ids.js';

const closed = { additionalProperties: false } as const;

/** Media asset IDs are UUIDs. */
const ASSET_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** One locale's default texts. Every key is optional: a missing one falls back along the locale chain. */
export const SeoLocaleDefaultsSchema = Type.Object(
  {
    siteName: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
    titleTemplate: Type.Optional(
      Type.String({ minLength: 2, maxLength: 200, pattern: SEO_TITLE_TEMPLATE_PATTERN.source }),
    ),
    description: Type.Optional(Type.String({ minLength: 1, maxLength: 1000 })),
  },
  closed,
);

/**
 * A site's SEO defaults (`sites.seo_defaults`): texts per locale code, the default social image (a public
 * image asset of the same site) and the Twitter handle for the whole site.
 */
export const SeoDefaultsSchema = Type.Object(
  {
    locales: Type.Record(Type.String({ pattern: LOCALE_CODE_PATTERN.source }), SeoLocaleDefaultsSchema, {
      additionalProperties: false,
    }),
    imageId: Type.Union([Type.String({ pattern: ASSET_ID_PATTERN.source }), Type.Null()]),
    twitterHandle: Type.Union([Type.String({ pattern: SEO_TWITTER_HANDLE_PATTERN.source }), Type.Null()]),
  },
  closed,
);

export type SeoLocaleDefaults = Static<typeof SeoLocaleDefaultsSchema>;
export type SeoDefaults = Static<typeof SeoDefaultsSchema>;
