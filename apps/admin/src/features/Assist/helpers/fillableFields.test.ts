import { describe, expect, it } from 'vitest';
import { component, field, model } from '../../../../../../packages/schema/src/testing/fixtures';
import { fillableFieldsOf } from './fillableFields';

const seo = component({
  apiKey: 'seo',
  fields: [
    field({ apiKey: 'title', label: 'Title' }),
    field({ apiKey: 'description', label: 'Description', type: 'text' }),
    field({ apiKey: 'noindex', label: 'Hide', type: 'boolean' }),
  ],
});
const section = component({ apiKey: 'section', fields: [field({ apiKey: 'heading', label: 'Heading' })] });
const article = model({
  fields: [
    field({ apiKey: 'title', label: 'Title' }),
    field({ apiKey: 'views', label: 'Views', type: 'integer' }),
    field({ apiKey: 'seo', label: 'SEO', type: 'component', settings: { component: seo.id } }),
    field({
      apiKey: 'sections',
      label: 'Sections',
      type: 'component',
      settings: { component: section.id, repeatable: true },
    }),
  ],
});

describe('fillableFieldsOf', () => {
  it("lists suggestible fields and a single component's suggestible fields, not repeatable ones", () => {
    const components = new Map([
      [seo.id, seo],
      [section.id, section],
    ]);
    expect(fillableFieldsOf(article, components)).toEqual([
      { path: '/title', label: 'Title' },
      { path: '/seo/title', label: 'SEO › Title' },
      { path: '/seo/description', label: 'SEO › Description' },
    ]);
  });
});
