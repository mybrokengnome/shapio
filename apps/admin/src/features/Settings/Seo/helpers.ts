import type { Locale } from '@shapio/client';
import {
  isValidTitleTemplate,
  SEO_TWITTER_HANDLE_PATTERN,
  type SeoDefaults,
  type SeoLocaleDefaults,
} from '@shapio/schema';
import { z } from 'zod';

/** Lengths from `SeoLocaleDefaultsSchema` (the server checks them too). */
const SHORT_MAX = 200;
const DESCRIPTION_MAX = 1000;

const optionalText = (max: number) => z.string().trim().max(max, 'validation.tooLong');

const localeTextsSchema = z.object({
  siteName: optionalText(SHORT_MAX),
  titleTemplate: optionalText(SHORT_MAX).refine(
    (value) => value === '' || isValidTitleTemplate(value),
    'validation.titleTemplate',
  ),
  description: optionalText(DESCRIPTION_MAX),
});

export const seoSettingsSchema = z.object({
  locales: z.record(z.string(), localeTextsSchema),
  imageId: z.string().nullable(),
  twitterHandle: z
    .string()
    .trim()
    .refine((value) => value === '' || SEO_TWITTER_HANDLE_PATTERN.test(value), 'validation.twitterHandle'),
});

export type SeoLocaleTexts = z.infer<typeof localeTextsSchema>;
export type SeoSettingsValues = z.infer<typeof seoSettingsSchema>;

const EMPTY_TEXTS: SeoLocaleTexts = { siteName: '', titleTemplate: '', description: '' };

/**
 * The form's values: every locale of the instance (and any other locale the defaults still hold) with all
 * three texts, empty strings for unset ones, so switching locale never loses an edit.
 */
export const toSeoSettingsValues = (seo: SeoDefaults, locales: readonly Locale[]): SeoSettingsValues => {
  const codes = [...new Set([...locales.map((locale) => locale.code), ...Object.keys(seo.locales)])];
  return {
    locales: Object.fromEntries(codes.map((code) => [code, { ...EMPTY_TEXTS, ...seo.locales[code] }])),
    imageId: seo.imageId,
    twitterHandle: seo.twitterHandle ?? '',
  };
};

/** What is saved: unset texts and locales without any text are left out. */
export const toSeoDefaults = (values: SeoSettingsValues): SeoDefaults => {
  const locales: Record<string, SeoLocaleDefaults> = {};
  for (const [code, texts] of Object.entries(values.locales)) {
    const kept = Object.fromEntries(
      Object.entries(texts)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value !== ''),
    ) as SeoLocaleDefaults;
    if (Object.keys(kept).length > 0) {
      locales[code] = kept;
    }
  }
  const handle = values.twitterHandle.trim();
  return { locales, imageId: values.imageId, twitterHandle: handle === '' ? null : handle };
};

/** The first locale with an invalid text, so a refused save can show it. */
export const firstLocaleWithErrors = (errors: { locales?: Record<string, unknown> }): string | undefined =>
  Object.keys(errors.locales ?? {})[0];
