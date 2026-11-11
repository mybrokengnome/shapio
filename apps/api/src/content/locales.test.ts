import type { ComponentDefinition, FieldDefinition, ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { outdatedSharedLocales } from './locales.js';

const field = (id: string, type: string, localized: boolean, settings: Record<string, unknown> = {}) =>
  ({ id, apiKey: id, label: id, type, localized, settings }) as unknown as FieldDefinition;

const link = {
  id: 'c-link',
  kind: 'component',
  fields: [field('text', 'string', false)],
} as unknown as ComponentDefinition;
const componentOf = (id: string) => (id === link.id ? link : undefined);

const model = {
  id: 'm',
  kind: 'collection',
  apiKey: 'page',
  localized: true,
  fields: [
    field('title', 'string', true),
    field('links', 'component', false, { component: 'c-link', repeatable: true }),
  ],
} as unknown as ModelDefinition;

describe('outdatedSharedLocales', () => {
  it('does not count an item ID as a shared change', () => {
    const published = { title: 'T', links: [{ text: 'a' }] };
    const draft = { title: 'T2', links: [{ __id: 'i-1', text: 'a' }] };
    expect(outdatedSharedLocales(model, [{ locale: 'fr', draft, published }], componentOf)).toEqual([]);
  });

  it('still reports shared content that changed', () => {
    const published = { links: [{ __id: 'i-1', text: 'a' }] };
    const draft = { links: [{ __id: 'i-1', text: 'b' }] };
    expect(outdatedSharedLocales(model, [{ locale: 'fr', draft, published }], componentOf)).toEqual(['fr']);
  });
});
