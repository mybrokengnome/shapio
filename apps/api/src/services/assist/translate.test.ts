import { normalizeDefinition, type ComponentDefinition, type ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { resolveModel } from '../../content/model.js';
import { buildSnapshot } from '../../schema/snapshot.js';
import { toInputFormat } from './translate.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const card = normalizeDefinition({
  id: id(100),
  kind: 'component',
  apiKey: 'card',
  label: 'Card',
  fields: [{ id: id(101), apiKey: 'heading', label: 'Heading', type: 'string' }],
}) as ComponentDefinition;

const page = normalizeDefinition({
  id: id(1),
  kind: 'collection',
  apiKey: 'page',
  label: 'Page',
  localized: true,
  fields: [
    {
      id: id(2),
      apiKey: 'hero',
      label: 'Hero',
      type: 'component',
      localized: true,
      settings: { component: id(100) },
    },
    {
      id: id(3),
      apiKey: 'cards',
      label: 'Cards',
      type: 'component',
      localized: true,
      settings: { component: id(100), repeatable: true },
    },
    {
      id: id(4),
      apiKey: 'zone',
      label: 'Zone',
      type: 'dynamiczone',
      localized: true,
      settings: { components: [id(100)] },
    },
  ],
}) as ModelDefinition;

const snapshot = buildSnapshot(
  1,
  [page, card].map((definition, index) => ({
    definition,
    version: 1,
    revisionId: id(900 + index),
    hash: 'x',
    activatedAt: new Date('2026-11-11T12:00:00.000Z'),
    siteId: null,
  })),
  [
    { code: 'en', label: 'English', isDefault: true, fallbacks: [] },
    { code: 'fr', label: 'French', isDefault: false, fallbacks: [] },
  ],
);
const model = resolveModel(snapshot, 'page');

describe('toInputFormat', () => {
  it('leaves out the source locale item IDs, so the translated items are new in the target locale', () => {
    const translated = {
      [id(2)]: { __id: 'i-hero', [id(101)]: 'Bienvenue' },
      [id(3)]: [{ __id: 'i-card', [id(101)]: 'Carte' }],
      [id(4)]: [{ __component: id(100), __id: 'i-zone', [id(101)]: 'Zone' }],
    };
    expect(toInputFormat(model, model.definition.fields, translated)).toEqual({
      hero: { heading: 'Bienvenue' },
      cards: [{ heading: 'Carte' }],
      zone: [{ __component: 'card', heading: 'Zone' }],
    });
  });
});
