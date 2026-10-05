import { SEO_COMPONENT_ID, SEO_EDITOR_ID } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { field, model } from '../../../../../../packages/schema/src/testing/fixtures';
import { createSeoField, hasSeoField } from './seoField';

describe('createSeoField', () => {
  it('holds the SEO component once, with the SEO editor and the API ID seo', () => {
    const created = createSeoField(model({ localized: true }));
    expect(created).toMatchObject({
      apiKey: 'seo',
      label: 'SEO',
      type: 'component',
      localized: true,
      settings: { component: SEO_COMPONENT_ID, repeatable: false },
      editor: { id: SEO_EDITOR_ID },
    });
  });

  it('follows a model that is not localized and avoids a taken API ID', () => {
    const created = createSeoField(model({ fields: [field({ apiKey: 'seo', label: 'Search' })] }));
    expect(created.localized).toBe(false);
    expect(created.apiKey).toBe('seo2');
  });
});

describe('hasSeoField', () => {
  it('recognises the SEO component by stable ID, whatever the API ID', () => {
    const withSeo = model({
      fields: [field({ apiKey: 'meta', type: 'component', settings: { component: SEO_COMPONENT_ID } })],
    });
    const lookalike = model({
      fields: [
        field({
          apiKey: 'seo',
          type: 'component',
          settings: { component: '00000000-0000-4000-8000-000000000009' },
        }),
      ],
    });
    expect(hasSeoField(withSeo)).toBe(true);
    expect(hasSeoField(lookalike)).toBe(false);
  });
});
