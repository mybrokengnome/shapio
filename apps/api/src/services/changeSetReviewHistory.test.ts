import { normalizeDefinition, type DefinitionInputWithIds, type SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { fieldHistoryOf, stepFieldEffects } from './changeSetReviewHistory.js';

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const FIELD = uuid(0x10);
const TARGET = uuid(2);

const pageOf = (field: Record<string, unknown>): SchemaDefinition =>
  normalizeDefinition({
    id: uuid(1),
    kind: 'collection',
    apiKey: 'page',
    label: 'Page',
    fields: [{ id: FIELD, label: 'Field', ...field }],
  } as DefinitionInputWithIds);

const links = (cardinality: 'one' | 'many') =>
  pageOf({ apiKey: 'links', type: 'relation', settings: { target: TARGET, cardinality } });

describe('what activations did to stored values', () => {
  it('a type change with no converter empties the field; one that converts every value keeps it', () => {
    const text = pageOf({ apiKey: 'price', type: 'string' });
    expect(stepFieldEffects(text, pageOf({ apiKey: 'price', type: 'number' })).get(FIELD)).toBe('nulled');
    const integer = pageOf({ apiKey: 'count', type: 'integer' });
    expect(stepFieldEffects(integer, pageOf({ apiKey: 'count', type: 'string' })).get(FIELD)).toBe(
      'converted',
    );
  });

  it('a list made single keeps one item (lossy); made a list again it brings nothing back', () => {
    const history = fieldHistoryOf({
      client: links('many'),
      steps: [
        { schemaVersion: 7, definition: links('one') },
        { schemaVersion: 9, definition: links('many') },
      ],
      current: links('many'),
      proposed: links('many'),
    });
    expect(history.get(FIELD)).toEqual({ past: 'lossy', pastSince: 7, proposed: 'transparent' });
  });

  it('a rename changes no value', () => {
    expect(
      stepFieldEffects(links('many'), {
        ...links('many'),
        fields: [{ ...links('many').fields[0]!, apiKey: 'refs' }],
      }).get(FIELD),
    ).toBe('transparent');
  });
});
