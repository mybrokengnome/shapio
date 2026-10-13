import type { DefinitionListItem } from '@shapio/client';
import type { ModelDefinition } from '@shapio/schema';
import { describe, expect, it, vi } from 'vitest';
import { familyKindsOf, resolveDefinitions } from './useResolvedDefinitions';

// The API client reads the page's URL on import; these helpers need none of it.
vi.mock('@/api/schema', () => ({ useDefinitions: vi.fn() }));

const model = (id: string, label: string, parent?: string): ModelDefinition => ({
  id,
  kind: 'collection',
  apiKey: id,
  label,
  localized: false,
  draftAndPublish: true,
  display: {},
  fields: [
    { id: `${id}-field`, apiKey: `${id}Field`, label: `${label} field`, type: 'string' },
  ] as unknown as ModelDefinition['fields'],
  ...(parent ? { extends: parent } : {}),
});

const item = (definition: ModelDefinition) =>
  ({ definition, scope: 'site', version: 1, pendingChange: null }) as unknown as DefinitionListItem;

const REGISTRY = [
  model('product', 'Products'),
  model('physical', 'Physical', 'product'),
  model('apparel', 'Apparel', 'physical'),
  model('digital', 'Digital', 'product'),
  model('author', 'Authors'),
].map(item);

describe('resolveDefinitions', () => {
  it('gives every model its effective fields, inherited ones first', () => {
    const { byId } = resolveDefinitions(REGISTRY);
    expect(byId.get('apparel')?.fields.map((field) => [field.apiKey, field.inheritedFrom])).toEqual([
      ['productField', 'product'],
      ['physicalField', 'physical'],
      ['apparelField', undefined],
    ]);
    expect(byId.get('apparel')?.ancestorIds).toEqual(['product', 'physical']);
  });
});

describe('familyKindsOf', () => {
  it('lists a type, then its kinds in tree order by label', () => {
    const { byId, index } = resolveDefinitions(REGISTRY);
    expect(familyKindsOf(byId, index, 'product').map((kind) => kind.id)).toEqual([
      'product',
      'digital',
      'physical',
      'apparel',
    ]);
    expect(familyKindsOf(byId, index, 'physical').map((kind) => kind.id)).toEqual(['physical', 'apparel']);
    expect(familyKindsOf(byId, index, 'author').map((kind) => kind.id)).toEqual(['author']);
    expect(familyKindsOf(byId, index, 'missing')).toEqual([]);
  });
});
