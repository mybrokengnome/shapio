import { effectiveLayout, SEO_COMPONENT_ID } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { field, model } from '../../../../../../../packages/schema/src/testing/fixtures';
import { stripFieldsFor } from './stripFields';

// The owner's singleton (2026-10-05): two required properties, then an SEO field added from the builder.
const home = model({
  kind: 'singleton',
  fields: [
    field({ apiKey: 'headline', type: 'string', required: true }),
    field({ apiKey: 'intro', type: 'text', required: true }),
    field({ apiKey: 'note', type: 'string' }),
    field({ apiKey: 'seo', type: 'component', settings: { component: SEO_COMPONENT_ID } }),
  ],
});

describe('stripFieldsFor', () => {
  it('shows an empty SEO group in the strip instead of behind "+N more"', () => {
    const shown = stripFieldsFor(effectiveLayout(home), {});
    expect(shown.map((entry) => entry.apiKey)).toEqual(['intro', 'seo']);
  });

  it('still leaves other empty optional properties to the drawer', () => {
    const shown = stripFieldsFor(effectiveLayout(home), { note: 'x' });
    expect(shown.map((entry) => entry.apiKey)).toEqual(['intro', 'note', 'seo']);
  });
});
