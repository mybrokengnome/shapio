import { describe, expect, it } from 'vitest';
import type { ClassifiedChange } from '../diff/classify.js';
import { CHANGE_KINDS } from '../diff/types.js';
import { createDefinitionIndex } from '../inheritance/resolve.js';
import { component, field, id, model, withField } from '../testing/fixtures.js';
import type { FieldDefinition, FieldInput, SchemaDefinition } from '../types/definitions.js';
import { compileLens } from './compile.js';
import { lensDefinitionEffect, lensEffectOfChange, lensEffects } from './effects.js';
import { LENS_EFFECTS, type DefinitionLens } from './types.js';

const change = (kind: ClassifiedChange['kind'], extra: Partial<ClassifiedChange> = {}): ClassifiedChange => ({
  kind,
  definitionId: id(1),
  fieldId: id(2),
  category: 'metadata',
  breaking: false,
  destructive: false,
  supported: true,
  dropsValues: false,
  prerequisites: [],
  cleanup: [],
  ...extra,
});

describe('lensEffectOfChange', () => {
  it('maps every change kind to an effect', () => {
    for (const kind of CHANGE_KINDS) {
      expect(LENS_EFFECTS).toContain(lensEffectOfChange(change(kind, { from: 'string', to: 'text' })));
    }
  });

  it.each([
    ['definition.removed', {}, 'gone'],
    ['definition.apiKey', {}, 'transparent'],
    ['field.apiKey', {}, 'transparent'],
    ['field.removed', {}, 'nulled'],
    ['model.kind', {}, 'uncovered'],
    ['field.localized', {}, 'uncovered'],
    ['field.public', { to: false }, 'nulled'],
    ['field.public', { to: true }, 'transparent'],
    ['field.filterable', { to: false }, 'uncovered'],
    ['field.type', { from: 'string', to: 'number' }, 'converted'],
    ['field.type', { from: 'number', to: 'string' }, 'lossy'],
    ['field.type', { from: 'number', to: 'integer' }, 'converted'],
    ['field.type', { from: 'string', to: 'richtext' }, 'lossy'],
    ['field.type', { from: 'string', to: 'json', dropsValues: true }, 'nulled'],
    ['field.settings', { property: 'cardinality', to: 'one' }, 'converted'],
    ['field.settings', { property: 'cardinality', to: 'many' }, 'lossy'],
    ['field.settings', { property: 'values', from: ['a'], to: ['a', 'b'] }, 'lossy'],
    ['field.settings', { property: 'values', from: ['a', 'b'], to: ['a'] }, 'transparent'],
    ['field.settings', { property: 'component' }, 'nulled'],
    ['field.settings', { property: 'maxLength', to: 3 }, 'transparent'],
  ] as const)('%s %j is %s', (kind, extra, expected) => {
    expect(lensEffectOfChange(change(kind, extra as Partial<ClassifiedChange>))).toBe(expected);
  });
});

describe('lensEffects', () => {
  const settings = (value: Record<string, unknown>) => value as FieldInput['settings'];
  const side = (...definitions: SchemaDefinition[]) => createDefinitionIndex(definitions);
  const hero = component({ id: id(5), apiKey: 'hero', fields: [field({ id: id(6), apiKey: 'heading' })] });
  const page = model({
    id: id(1),
    apiKey: 'page',
    fields: [
      field({ id: id(2), apiKey: 'title' }),
      field({ id: id(3), apiKey: 'count', type: 'integer' }),
      field({ id: id(4), apiKey: 'hero', type: 'component', settings: settings({ component: id(5) }) }),
    ],
  });
  const lens = (stored: SchemaDefinition[], client: SchemaDefinition[]) =>
    compileLens(side(...stored), side(...client), id(1)) as DefinitionLens;
  const effectOf = (value: DefinitionLens, fieldId: string) =>
    lensEffects(value).find((entry) => entry.fieldId === fieldId)?.effect;
  const retype = (type: FieldDefinition['type']) => (current: FieldDefinition) =>
    ({ ...current, type, settings: {} }) as FieldDefinition;

  it('reports a rename as transparent and a widening read back as lossy', () => {
    const changed = withField(
      withField(page, id(2), (current) => ({ ...current, apiKey: 'headline' })),
      id(3),
      retype('number'),
    );
    const value = lens([changed, hero], [page, hero]);
    expect(effectOf(value, id(2))).toBe('transparent');
    // integer (client) reading number (stored): 12.5 does not fit.
    expect(effectOf(value, id(3))).toBe('lossy');
    expect(lensDefinitionEffect(value)).toBe('lossy');
  });

  it('takes the worst effect inside a component changed on its own', () => {
    const heroNumber = withField(hero, id(6), retype('number'));
    expect(effectOf(lens([page, heroNumber], [page, hero]), id(4))).toBe('converted');
    const heroJson = withField(hero, id(6), retype('json'));
    expect(effectOf(lens([page, heroJson], [page, hero]), id(4))).toBe('nulled');
  });

  it('marks every field of a gone or uncovered definition', () => {
    expect(lensEffects(lens([hero], [page, hero])).every((entry) => entry.effect === 'gone')).toBe(true);
    expect(
      lensEffects(lens([{ ...page, kind: 'singleton' }, hero], [page, hero])).every(
        (entry) => entry.effect === 'uncovered',
      ),
    ).toBe(true);
  });
});
