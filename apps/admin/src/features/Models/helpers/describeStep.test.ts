import type { PlanStep } from '@shapio/client';
import { classifyChange, type SchemaDefinition } from '@shapio/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '@/app/i18n';
import { field, model } from '../../../../../../packages/schema/src/testing/fixtures';
import { describeChange } from './describeChange';
import { describeStep, describeStepImpact, stepsToShow } from './describeStep';

const before = model({ fields: [field({ apiKey: 'price', label: 'Price', type: 'media' })] });
const price = before.fields[0]!;
const after = { ...before, fields: [{ ...price, type: 'number' }] } as SchemaDefinition;
const typeChange = {
  kind: 'field.type',
  definitionId: before.id,
  fieldId: price.id,
  from: 'media',
  to: 'number',
} as const;
/** The plan step carries the classified change, with `dropsValues` decided by the planner. */
const convert: PlanStep = {
  kind: 'convert',
  ownerId: before.id,
  change: classifyChange(typeChange, { before, after }),
  locations: [],
};
const key = `convert:${before.id}:field.type:${price.id}:`;

beforeAll(async () => {
  await initI18n();
});

describe('a type change Shapio cannot convert', () => {
  it('says the field loses its stored values', () => {
    const classified = classifyChange(typeChange, { before, after });
    expect(describeChange(classified, before, after)).toBe(
      'Change the type of Price from Media to Number and drop its stored values',
    );
  });

  it('counts the entries that lose their value, falling back to the entries checked', () => {
    const counted = { key, kind: 'convert', affectedHeads: 5, droppedEntries: 2 };
    expect(describeStep(convert, before, after, counted)).toBe(
      'Price: Media → Number, 2 entries lose their value',
    );
    expect(describeStepImpact(convert, counted)).toBeUndefined();
    const uncounted = { key, kind: 'convert', affectedHeads: 1 };
    expect(describeStep(convert, before, after, uncounted)).toBe(
      'Price: Media → Number, 1 entry loses its value',
    );
  });

  it('a multi-value enum to text drops its values (the planner sees the settings, not just the types)', () => {
    const tagsBefore = model({
      fields: [
        field({
          apiKey: 'tags',
          label: 'Tags',
          type: 'enum',
          settings: { multiple: true, values: [{ value: 'a', label: 'A' }] },
        }),
      ],
    });
    const tags = tagsBefore.fields[0]!;
    const tagsAfter = {
      ...tagsBefore,
      fields: [{ ...tags, type: 'string', settings: {} }],
    } as SchemaDefinition;
    const change = classifyChange(
      { kind: 'field.type', definitionId: tagsBefore.id, fieldId: tags.id, from: 'enum', to: 'string' },
      { before: tagsBefore, after: tagsAfter },
    );
    const step: PlanStep = { kind: 'convert', ownerId: tagsBefore.id, change, locations: [] };
    expect(
      describeStep(step, tagsBefore, tagsAfter, {
        key,
        kind: 'convert',
        affectedHeads: 3,
        droppedEntries: 3,
      }),
    ).toBe('Tags: Choice → Short text, 3 entries lose their value');
  });

  it('keeps the plain wording for a conversion Shapio performs', () => {
    const toText: PlanStep = { ...convert, change: { ...typeChange, from: 'number', to: 'string' } };
    expect(describeStep(toText, before, after)).toBe('Convert stored values');
  });

  it('says how to fix entries a required field would leave empty', () => {
    const required: PlanStep = { kind: 'validateRequired', fieldId: price.id };
    expect(
      describeStepImpact(required, {
        key: 'validateRequired',
        kind: 'validateRequired',
        affectedHeads: 3,
        invalidHeads: 2,
      }),
    ).toBe(
      '3 entry versions to check · 2 entries would be left without a required value; untick Required or set a default',
    );
  });

  it('leaves out the value check on the dropped field, keeping each step with its impact', () => {
    const check = (fieldId: string): PlanStep => ({ kind: 'validateValues', ownerId: before.id, fieldId });
    const impact = (kind: string, affectedHeads: number) => ({ key: kind, kind, affectedHeads });
    const steps = [convert, check(price.id), check('other'), { kind: 'validateValues', ownerId: before.id }];
    const impacts = [
      impact('convert', 2),
      impact('validateValues', 2),
      impact('validateValues', 3),
      impact('x', 4),
    ];
    expect(stepsToShow(steps, impacts)).toEqual([
      { step: convert, impact: impacts[0] },
      { step: steps[2], impact: impacts[2] },
      { step: steps[3], impact: impacts[3] },
    ]);
    // A conversion Shapio performs keeps its value check.
    const toText: PlanStep = { ...convert, change: { ...typeChange, from: 'number', to: 'string' } };
    expect(stepsToShow([toText, check(price.id)])).toHaveLength(2);
  });
});
