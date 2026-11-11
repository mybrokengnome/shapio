import type { FieldDefinition, SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import type { ValueResolver } from './types.js';
import { buildData, type BuildContext, type DefinitionView } from './values.js';

const field = (id: string, apiKey: string, type: string, settings: Record<string, unknown> = {}) =>
  ({ id, apiKey, label: apiKey, type, settings, localized: false }) as unknown as FieldDefinition;

const view = (id: string, kind: string, fields: FieldDefinition[]): DefinitionView => ({
  definition: { id, kind, apiKey: id, label: id, fields } as unknown as SchemaDefinition,
  fields: new Map(fields.map((entry) => [entry.apiKey, entry])),
});

const card = view('card', 'component', [field('f-heading', 'heading', 'string')]);
const page = view('page', 'collection', [
  field('f-cards', 'cards', 'component', { component: 'card', repeatable: true }),
  field('f-zone', 'zone', 'dynamiczone', { components: ['card'] }),
]);

const resolver: ValueResolver = { entry: () => undefined, media: () => undefined };
const context: BuildContext = {
  live: {
    byKey: new Map([['card', card]]),
    byId: new Map([
      ['card', card],
      ['page', page],
    ]),
    missing: [],
  },
  resolver,
  warnings: [],
};

describe('buildData', () => {
  it('sends component and zone items without item IDs: the server assigns them', () => {
    const data = buildData(
      {
        cards: { kind: 'component', many: true, items: [{ heading: { kind: 'scalar', value: 'A' } }] },
        zone: {
          kind: 'zone',
          items: [{ component: 'card', fields: { heading: { kind: 'scalar', value: 'B' } } }],
        },
      },
      page,
      context,
    );
    expect(data).toEqual({
      cards: [{ heading: 'A' }],
      zone: [{ __component: 'card', heading: 'B' }],
    });
  });
});
