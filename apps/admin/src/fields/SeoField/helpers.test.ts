import { EMPTY_SEO_DEFAULTS, seoComponentDefinition, SEO_FIELD_IDS } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { localeChainOf, seoCounterOf, seoKeysOf, seoPreviewOf } from './helpers';

const seo = seoComponentDefinition();

const locale = (code: string, fallbacks: string[] = [], isDefault = false) => ({
  code,
  label: code,
  fallbacks,
  isDefault,
});

describe('seoCounterOf', () => {
  it('stays hidden until the text is within 10 characters of the soft maximum', () => {
    expect(seoCounterOf(SEO_FIELD_IDS.title, 'a'.repeat(59))).toBeNull();
    expect(seoCounterOf(SEO_FIELD_IDS.title, 'a'.repeat(60))).toEqual({ count: 60, max: 70, over: false });
    expect(seoCounterOf(SEO_FIELD_IDS.title, 'a'.repeat(71))).toEqual({ count: 71, max: 70, over: true });
    expect(seoCounterOf(SEO_FIELD_IDS.description, 'a'.repeat(150))).toEqual({
      count: 150,
      max: 160,
      over: false,
    });
  });

  it('counts characters, not UTF-16 units, and has no counter on other fields', () => {
    expect(seoCounterOf(SEO_FIELD_IDS.title, '😀'.repeat(65))?.count).toBe(65);
    expect(seoCounterOf(SEO_FIELD_IDS.title, null)).toBeNull();
    expect(seoCounterOf(SEO_FIELD_IDS.canonical, 'x'.repeat(500))).toBeNull();
  });
});

describe('seoKeysOf', () => {
  it('follows renamed API IDs and skips removed or retyped fields', () => {
    const edited = {
      ...seo,
      fields: seo.fields
        .filter((field) => field.id !== SEO_FIELD_IDS.canonical)
        .map((field) => {
          if (field.id === SEO_FIELD_IDS.title) {
            return { ...field, apiKey: 'metaTitle' };
          }
          return field.id === SEO_FIELD_IDS.noindex ? { ...field, type: 'string' as const } : field;
        }),
    } as typeof seo;
    expect(seoKeysOf(edited)).toEqual({ title: 'metaTitle', description: 'description', image: 'image' });
  });
});

describe('localeChainOf', () => {
  const locales = [locale('en', [], true), locale('fr'), locale('fr-CA', ['fr'])];

  it('is the locale, its fallbacks, then the default locale, once each', () => {
    expect(localeChainOf(locales, 'fr-CA')).toEqual(['fr-CA', 'fr', 'en']);
    expect(localeChainOf(locales, 'en')).toEqual(['en']);
  });

  it('starts from the default locale for a model that is not localized', () => {
    expect(localeChainOf(locales, null)).toEqual(['en']);
  });
});

describe('seoPreviewOf', () => {
  const defaults = {
    ...EMPTY_SEO_DEFAULTS,
    locales: {
      en: { siteName: 'Acme', titleTemplate: '%s · Acme', description: 'We make things.' },
      fr: { titleTemplate: '%s · Acmé' },
    },
  };

  it('templates the entry title and falls back to the site description', () => {
    expect(
      seoPreviewOf({
        value: null,
        component: seo,
        defaults,
        localeChain: ['fr', 'en'],
        fallbackTitle: 'Bonjour',
      }),
    ).toEqual({ title: 'Bonjour · Acmé', description: 'We make things.', siteName: 'Acme' });
  });

  it("prefers the SEO group's own title and description", () => {
    expect(
      seoPreviewOf({
        value: { title: 'Custom', description: 'Mine' },
        component: seo,
        defaults,
        localeChain: ['en'],
        fallbackTitle: 'Ignored',
      }),
    ).toEqual({ title: 'Custom · Acme', description: 'Mine', siteName: 'Acme' });
  });

  it('has no title when neither the entry nor the site has one', () => {
    expect(
      seoPreviewOf({
        value: {},
        component: seo,
        defaults: EMPTY_SEO_DEFAULTS,
        localeChain: ['en'],
        fallbackTitle: 42,
      }),
    ).toEqual({ title: null, description: null, siteName: null });
  });
});
