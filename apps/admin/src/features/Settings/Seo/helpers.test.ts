import type { Locale } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { firstLocaleWithErrors, seoSettingsSchema, toSeoDefaults, toSeoSettingsValues } from './helpers';

const locales = [
  { code: 'en', label: 'English', fallbacks: [], isDefault: true },
  { code: 'fr', label: 'French', fallbacks: [], isDefault: false },
] as Locale[];

describe('SEO settings values', () => {
  it('gives every locale all three texts, keeping locales only the defaults still hold', () => {
    const values = toSeoSettingsValues(
      {
        locales: { en: { siteName: 'Acme' }, de: { description: 'Alt' } },
        imageId: null,
        twitterHandle: null,
      },
      locales,
    );
    expect(values).toEqual({
      locales: {
        en: { siteName: 'Acme', titleTemplate: '', description: '' },
        fr: { siteName: '', titleTemplate: '', description: '' },
        de: { siteName: '', titleTemplate: '', description: 'Alt' },
      },
      imageId: null,
      twitterHandle: '',
    });
  });

  it('saves only what is set, trimmed', () => {
    expect(
      toSeoDefaults({
        locales: {
          en: { siteName: ' Acme ', titleTemplate: '%s · Acme', description: '' },
          fr: { siteName: '', titleTemplate: '', description: '' },
        },
        imageId: 'a6c1d7f0-1111-4aaa-8bbb-000000000001',
        twitterHandle: ' ',
      }),
    ).toEqual({
      locales: { en: { siteName: 'Acme', titleTemplate: '%s · Acme' } },
      imageId: 'a6c1d7f0-1111-4aaa-8bbb-000000000001',
      twitterHandle: null,
    });
  });
});

describe('seoSettingsSchema', () => {
  const valid = {
    locales: { en: { siteName: '', titleTemplate: '%s · Acme', description: '' } },
    imageId: null,
    twitterHandle: '@acme',
  };

  it('accepts a template with one %s and an @handle', () => {
    expect(seoSettingsSchema.safeParse(valid).success).toBe(true);
  });

  it('refuses a template without exactly one %s, naming the locale', () => {
    for (const titleTemplate of ['Acme', '%s | %s']) {
      const result = seoSettingsSchema.safeParse({
        ...valid,
        locales: { en: { ...valid.locales.en, titleTemplate } },
      });
      expect(result.error?.issues[0]).toMatchObject({
        path: ['locales', 'en', 'titleTemplate'],
        message: 'validation.titleTemplate',
      });
    }
  });

  it('refuses a handle without @', () => {
    const result = seoSettingsSchema.safeParse({ ...valid, twitterHandle: 'acme' });
    expect(result.error?.issues[0]?.message).toBe('validation.twitterHandle');
  });

  it('finds the first locale with an error', () => {
    expect(firstLocaleWithErrors({ locales: { fr: {} } })).toBe('fr');
    expect(firstLocaleWithErrors({})).toBeUndefined();
  });
});
