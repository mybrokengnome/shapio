import { describe, expect, it } from 'vitest';
import { createDefinitionIndex } from '../inheritance/resolve.js';
import { component, field, id, model, withField } from '../testing/fixtures.js';
import type { FieldDefinition, FieldInput, SchemaDefinition } from '../types/definitions.js';
import { compileLens } from './compile.js';
import type { DefinitionLens, FieldLens } from './types.js';

const settings = (value: Record<string, unknown>) => value as FieldInput['settings'];
const side = (...definitions: SchemaDefinition[]) => createDefinitionIndex(definitions);

const MODEL = id(1);
const TITLE = id(2);
const PRICE = id(3);
const BLOCKS = id(4);
const HERO = id(5);
const QUOTE = id(6);
const HEADING = id(7);
const NEW_PRICE = id(8);
const CTA = id(9);

type ModelInput = NonNullable<Parameters<typeof model>[0]>;
const page = (fields: ModelInput['fields'], extra: Partial<ModelInput> = {}) =>
  model({ id: MODEL, apiKey: 'page', pluralApiKey: 'pages', fields, ...extra });

const lensOf = (stored: SchemaDefinition[], client: SchemaDefinition[], definitionId = MODEL) =>
  compileLens(side(...stored), side(...client), definitionId) as DefinitionLens;

const fieldOf = (lens: DefinitionLens, fieldId: string) =>
  lens.fields.find((candidate) => candidate.fieldId === fieldId) as FieldLens;

const retype =
  (type: FieldDefinition['type'], extra: Record<string, unknown> = {}) =>
  (current: FieldDefinition) =>
    ({ ...current, type, settings: extra }) as FieldDefinition;

describe('compileLens', () => {
  const base = page([
    field({ id: TITLE, apiKey: 'title' }),
    field({ id: PRICE, apiKey: 'price', type: 'number' }),
  ]);

  it('is an identity when nothing changed', () => {
    expect(lensOf([base], [base]).status).toBe('identity');
  });

  it('maps a renamed field by ID and is no longer an identity', () => {
    const renamed = withField(base, TITLE, (current) => ({ ...current, apiKey: 'headline' }));
    const lens = lensOf([renamed], [base]);
    expect(lens.status).toBe('lensed');
    expect(fieldOf(lens, TITLE)).toMatchObject({ kind: 'same', apiKey: 'title' });
    expect(fieldOf(lens, TITLE).kind === 'same' && fieldOf(lens, TITLE)).toMatchObject({
      stored: { apiKey: 'headline' },
    });
    expect(lens.apiKeyToFieldId.get('title')).toBe(TITLE);
  });

  it('is not an identity when the route changed', () => {
    const moved = { ...base, pluralApiKey: 'articles' };
    expect(lensOf([moved], [base]).status).toBe('lensed');
  });

  it('reads a removed field as null', () => {
    const removed = { ...base, fields: base.fields.filter((candidate) => candidate.id !== PRICE) };
    expect(fieldOf(lensOf([removed], [base]), PRICE)).toMatchObject({ kind: 'null', reason: 'removed' });
  });

  it('never matches by API ID: a field removed and re-added under the same API ID is a different field', () => {
    const readded = page([
      field({ id: TITLE, apiKey: 'title' }),
      field({ id: NEW_PRICE, apiKey: 'price', type: 'string' }),
    ]);
    const lens = lensOf([readded], [base]);
    expect(lens.apiKeyToFieldId.get('price')).toBe(PRICE);
    expect(fieldOf(lens, PRICE)).toMatchObject({ kind: 'null', reason: 'removed', list: false });
  });

  it('converts a type change and sees text → number → text as unchanged', () => {
    const asText = withField(base, PRICE, retype('string'));
    expect(fieldOf(lensOf([asText], [base]), PRICE).kind).toBe('convert');
    expect(fieldOf(lensOf([base], [asText]), PRICE).kind).toBe('convert');
    // text (client) → number → text (stored): one stored value, same type on both sides.
    expect(fieldOf(lensOf([asText], [asText]), PRICE).kind).toBe('same');
  });

  it('reads a storage Shapio has no converter back from as null', () => {
    const asJson = withField(base, TITLE, retype('json'));
    expect(fieldOf(lensOf([asJson], [base]), TITLE)).toMatchObject({ kind: 'null', reason: 'dropped' });
  });

  it('treats a type change with a settings change in between by the two ends only', () => {
    const tags = (values: string[], multiple: boolean) =>
      page([
        field({
          id: TITLE,
          apiKey: 'tags',
          type: 'enum',
          settings: settings({ values: values.map((value) => ({ value, label: value })), multiple }),
        }),
      ]);
    // enum [a,b] → multiple → values add c: the client reads a converted (first item, checked) value.
    expect(fieldOf(lensOf([tags(['a', 'b', 'c'], true)], [tags(['a', 'b'], false)]), TITLE).kind).toBe(
      'convert',
    );
    // Values only removed since: every stored value is one the client knows.
    expect(fieldOf(lensOf([tags(['a'], false)], [tags(['a', 'b'], false)]), TITLE).kind).toBe('same');
  });

  describe('components', () => {
    const hero = component({ id: HERO, apiKey: 'hero', fields: [field({ id: HEADING, apiKey: 'heading' })] });
    const quote = component({ id: QUOTE, apiKey: 'quote', fields: [field({ id: CTA, apiKey: 'text' })] });
    const holder = (componentId: string) =>
      page([
        field({
          id: BLOCKS,
          apiKey: 'hero',
          type: 'component',
          settings: settings({ component: componentId }),
        }),
      ]);

    it('reads a component field whose component was swapped as null', () => {
      expect(
        fieldOf(lensOf([holder(QUOTE), hero, quote], [holder(HERO), hero, quote]), BLOCKS),
      ).toMatchObject({
        kind: 'null',
        reason: 'componentChanged',
      });
    });

    it('reads a component swapped and swapped back as the same field', () => {
      const lens = lensOf([holder(HERO), hero, quote], [holder(HERO), hero, quote]);
      expect(lens.status).toBe('identity');
    });

    it('follows a component changed on its own, under an unchanged model field', () => {
      const heroNumber = withField(hero, HEADING, retype('number'));
      const lens = lensOf([holder(HERO), heroNumber], [holder(HERO), hero]);
      const blocks = fieldOf(lens, BLOCKS);
      expect(blocks.kind).toBe('same');
      expect(lens.status).toBe('lensed');
      const nested = blocks.kind === 'same' ? blocks.nested?.components.get(HERO) : undefined;
      expect(nested && fieldOf(nested, HEADING).kind).toBe('convert');
    });

    it('lenses each component of a dynamic zone, and converts when today allows more components', () => {
      const zone = (components: string[]) =>
        page([
          field({ id: BLOCKS, apiKey: 'blocks', type: 'dynamiczone', settings: settings({ components }) }),
        ]);
      const narrower = lensOf([zone([HERO]), hero, quote], [zone([HERO, QUOTE]), hero, quote]);
      expect(fieldOf(narrower, BLOCKS).kind).toBe('same');
      const wider = lensOf([zone([HERO, QUOTE]), hero, quote], [zone([HERO]), hero, quote]);
      expect(fieldOf(wider, BLOCKS)).toMatchObject({ kind: 'convert' });
      const removedComponent = lensOf([zone([HERO]), hero], [zone([HERO, QUOTE]), hero, quote]);
      const blocks = fieldOf(removedComponent, BLOCKS);
      expect(blocks.kind === 'same' && blocks.nested?.components.get(QUOTE)?.status).toBe('gone');
    });
  });

  it('marks a deleted definition gone, every field null', () => {
    const lens = lensOf([], [base]);
    expect(lens.status).toBe('gone');
    expect(lens.storedApiKey).toBeNull();
    expect(lens.fields.every((candidate) => candidate.kind === 'null')).toBe(true);
  });

  it('is null for a definition the client does not know', () => {
    expect(compileLens(side(base), side(), MODEL)).toBeNull();
  });

  it('marks a kind change uncovered', () => {
    expect(lensOf([{ ...base, kind: 'singleton' }], [base]).status).toBe('uncovered');
  });

  it('resolves inherited fields, and a field lost with a parent reads null', () => {
    const parentA = model({ id: id(20), apiKey: 'product', fields: [field({ id: id(21), apiKey: 'sku' })] });
    const parentB = model({ id: id(22), apiKey: 'item', fields: [field({ id: id(23), apiKey: 'code' })] });
    const child = (parent: string) =>
      model({
        id: id(24),
        apiKey: 'shirt',
        extends: parent,
        fields: [field({ id: id(25), apiKey: 'size' })],
      });
    const lens = lensOf([parentA, parentB, child(id(22))], [parentA, parentB, child(id(20))], id(24));
    expect(fieldOf(lens, id(21))).toMatchObject({ kind: 'null', reason: 'removed' });
    expect(fieldOf(lens, id(25)).kind).toBe('same');
  });

  it('reads a list field that is gone as []', () => {
    const withTags = page([
      field({
        id: TITLE,
        apiKey: 'tags',
        type: 'enum',
        settings: settings({ values: [{ value: 'a', label: 'A' }], multiple: true }),
      }),
    ]);
    expect(fieldOf(lensOf([page([])], [withTags]), TITLE)).toMatchObject({ kind: 'null', list: true });
  });
});
