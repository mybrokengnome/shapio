import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';
import { listCompatibleEditors } from '../editors/catalogue.js';
import { field, model } from '../testing/fixtures.js';
import { validateDefinition } from '../validators/definition.js';
import { parseDefinition } from '../validators/parse.js';
import { SeoDefaultsSchema } from './defaults.js';
import { seoComponentDefinition } from './definition.js';
import { isSeoField } from './field.js';
import { SEO_COMPONENT_ID, SEO_EDITOR_ID, SEO_FIELD_IDS } from './ids.js';
import { applyTitleTemplate, isValidTitleTemplate, seoDefaultsForLocale } from './locale.js';
import { resolveSeo } from './resolve.js';

const seoField = (overrides: { repeatable?: boolean; component?: string } = {}) =>
  model({
    fields: [
      field({
        apiKey: 'seo',
        type: 'component',
        settings: {
          component: overrides.component ?? SEO_COMPONENT_ID,
          repeatable: overrides.repeatable ?? false,
        },
      }),
    ],
  }).fields[0]!;

describe('the built-in SEO component', () => {
  it('is a valid shared component with the fixed IDs and no length limits', () => {
    const definition = seoComponentDefinition();
    expect(validateDefinition(definition)).toEqual([]);
    expect(definition.id).toBe(SEO_COMPONENT_ID);
    expect(definition.fields.map((entry) => entry.id)).toEqual(Object.values(SEO_FIELD_IDS));
    expect(definition.fields.every((entry) => entry.public && !('maxLength' in entry.settings))).toBe(true);
  });

  it('survives a parse round trip unchanged (what the planner stores)', () => {
    const definition = seoComponentDefinition();
    const parsed = parseDefinition(JSON.parse(JSON.stringify(definition)));
    expect(parsed).toEqual({ ok: true, definition });
  });

  it('is recognised by stable ID only, single, and is the only field the SEO editor supports', () => {
    expect(isSeoField(seoField())).toBe(true);
    expect(isSeoField(seoField({ repeatable: true }))).toBe(false);
    const other = seoField({ component: '00000000-0000-4000-8000-000000000009' });
    expect(isSeoField(other)).toBe(false);
    expect(listCompatibleEditors(seoField()).map((entry) => entry.id)).toContain(SEO_EDITOR_ID);
    expect(listCompatibleEditors(other).map((entry) => entry.id)).not.toContain(SEO_EDITOR_ID);
  });

  it('refuses the SEO editor on another component field', () => {
    const definition = model({
      fields: [
        field({
          apiKey: 'hero',
          type: 'component',
          settings: { component: '00000000-0000-4000-8000-000000000009' },
          editor: { id: SEO_EDITOR_ID },
        }),
      ],
    });
    expect(validateDefinition(definition).some((issue) => issue.path.includes('/editor'))).toBe(true);
  });
});

describe('SEO defaults', () => {
  it('accepts a template with exactly one placeholder', () => {
    expect(isValidTitleTemplate('%s · Acme')).toBe(true);
    expect(isValidTitleTemplate('Acme')).toBe(false);
    expect(isValidTitleTemplate('%s | %s')).toBe(false);
  });

  it('validates the stored shape', () => {
    const valid = {
      locales: { en: { siteName: 'Acme', titleTemplate: '%s · Acme' }, 'pt-BR': {} },
      imageId: null,
      twitterHandle: '@acme',
    };
    expect(Value.Check(SeoDefaultsSchema, valid)).toBe(true);
    expect(Value.Check(SeoDefaultsSchema, { ...valid, twitterHandle: 'acme' })).toBe(false);
    expect(Value.Check(SeoDefaultsSchema, { ...valid, locales: { en: { titleTemplate: 'Acme' } } })).toBe(
      false,
    );
    expect(Value.Check(SeoDefaultsSchema, { ...valid, locales: { EN: {} } })).toBe(false);
    expect(Value.Check(SeoDefaultsSchema, { ...valid, extra: 1 })).toBe(false);
    expect(
      Value.Check(SeoDefaultsSchema, { ...valid, imageId: '6d1917f3-94a2-4391-ba1f-a98d14577b93' }),
    ).toBe(true);
    expect(Value.Check(SeoDefaultsSchema, { ...valid, imageId: 'nope' })).toBe(false);
  });

  it('picks each text along the locale chain', () => {
    const defaults = {
      locales: { en: { siteName: 'Acme', description: 'Things' }, fr: { siteName: 'Acmé' } },
    };
    expect(seoDefaultsForLocale(defaults, ['fr', 'en'])).toEqual({ siteName: 'Acmé', description: 'Things' });
    expect(seoDefaultsForLocale(defaults, ['de'])).toEqual({});
  });

  it('replaces the placeholder once, literally', () => {
    expect(applyTitleTemplate('Price $&', '%s · Acme')).toBe('Price $& · Acme');
    expect(applyTitleTemplate('Post', undefined)).toBe('Post');
    expect(applyTitleTemplate('Post', 'broken')).toBe('Post');
  });
});

describe('resolveSeo', () => {
  const defaults = { siteName: 'Acme', titleTemplate: '%s · Acme', description: 'Default' };
  const image = { id: 'img', url: 'https://cdn.test/a.png' };

  it('fills empty values from the defaults and templates the title', () => {
    expect(
      resolveSeo(
        { title: null, description: null, image: null, canonical: null, noindex: null },
        { defaults, image, fallbackTitle: 'Hello' },
      ),
    ).toEqual({ title: 'Hello · Acme', description: 'Default', image, canonical: null, noindex: false });
  });

  it('keeps the entry values and templates its own title', () => {
    const own = { id: 'own' };
    expect(
      resolveSeo(
        { title: 'Custom', description: 'Mine', image: own, canonical: 'https://x.test/', noindex: true },
        { defaults, image, fallbackTitle: 'Hello' },
      ),
    ).toEqual({
      title: 'Custom · Acme',
      description: 'Mine',
      image: own,
      canonical: 'https://x.test/',
      noindex: true,
    });
  });

  it('uses the bare site name when there is no title at all, and null without one', () => {
    expect(resolveSeo(null, { defaults, image: null, fallbackTitle: null }).title).toBe('Acme');
    expect(resolveSeo(null, { defaults: {}, image: null, fallbackTitle: '  ' }).title).toBeNull();
  });

  it('follows renamed keys, skips removed ones and passes other keys through', () => {
    expect(
      resolveSeo(
        { metaTitle: '', extra: 1 },
        { defaults, image: null, fallbackTitle: 'Hi', keys: { title: 'metaTitle', noindex: 'noindex' } },
      ),
    ).toEqual({ metaTitle: 'Hi · Acme', extra: 1, noindex: false });
  });
});
