import { normalizeDefinition, type ComponentDefinition, type ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../schema/snapshot.js';
import { resolveModel } from './model.js';
import { dropForeignTypedValues, validateRevisionData } from './revisionData.js';
import { buildValidator, COMPONENT_KEY } from './validator/index.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const hero = normalizeDefinition({
  id: id(100),
  kind: 'component',
  apiKey: 'hero',
  label: 'Hero',
  fields: [{ id: id(101), apiKey: 'count', label: 'Count', type: 'integer' }],
}) as ComponentDefinition;

const page = normalizeDefinition({
  id: id(1),
  kind: 'collection',
  apiKey: 'page',
  label: 'Page',
  fields: [
    { id: id(2), apiKey: 'title', label: 'Title', type: 'string', required: true },
    { id: id(3), apiKey: 'size', label: 'Size', type: 'number' },
    {
      id: id(4),
      apiKey: 'sections',
      label: 'Sections',
      type: 'dynamiczone',
      settings: { components: [hero.id] },
    },
    { id: id(5), apiKey: 'old', label: 'Old', type: 'integer', deprecated: true },
  ],
}) as ModelDefinition;

const snapshot = buildSnapshot(
  1,
  [page, hero].map((definition, index) => ({
    definition,
    version: 1,
    revisionId: id(900 + index),
    hash: 'x',
    activatedAt: new Date(),
    siteId: null,
  })),
  [{ code: 'en', label: 'English', isDefault: true, fallbacks: [] }],
);
const model = resolveModel(snapshot, 'page');

describe('revision data under the current schema', () => {
  it('leaves out values of another type, nested ones too, and keeps removed and deprecated values', () => {
    const removed = id(77);
    const { data, dropped } = dropForeignTypedValues(model, {
      [id(2)]: 'Hi',
      [id(3)]: 'twelve',
      [id(4)]: [
        { [COMPONENT_KEY]: hero.id, [id(101)]: 3 },
        { [COMPONENT_KEY]: hero.id, [id(101)]: 'three' },
      ],
      [id(5)]: 'kept',
      [removed]: 'kept too',
    });
    expect(data).toEqual({
      [id(2)]: 'Hi',
      [id(4)]: [{ [COMPONENT_KEY]: hero.id, [id(101)]: 3 }, { [COMPONENT_KEY]: hero.id }],
      [id(5)]: 'kept',
      [removed]: 'kept too',
    });
    expect(dropped).toEqual([
      { path: '/size', type: 'number' },
      { path: '/sections/1/count', type: 'integer' },
    ]);
  });

  it('names the type change on an issue a dropped value causes', () => {
    const outcome = validateRevisionData(buildValidator(snapshot, model), { [id(2)]: 42 });
    expect(outcome.issues).toEqual([
      {
        path: '/title',
        code: 'REQUIRED',
        message: expect.stringContaining("before the field's type changed to string") as unknown,
      },
    ]);
  });
});
