import type { PlanStep } from '@shapio/client';
import { classifyChange, type SchemaDefinition } from '@shapio/schema';
import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '@/app/i18n';
import { field, model } from '../../../../../../packages/schema/src/testing/fixtures';
import { describeChange } from './describeChange';
import {
  describeRequiredGaps,
  describeStep,
  describeStepImpact,
  hasFailingCheck,
  requiredGapNotices,
  stepsToShow,
} from './describeStep';

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

  it('counts the entries a required field leaves without a value, without calling it a failure', () => {
    const required: PlanStep = { kind: 'validateRequired', fieldId: price.id };
    expect(
      describeStepImpact(required, {
        key: 'validateRequired',
        kind: 'validateRequired',
        affectedHeads: 4,
        missingHeads: 4,
        missingEntries: 3,
      }),
    ).toBe('4 entry versions to check · 3 entries (4 versions) without a value');
    expect(hasFailingCheck([{ key: 'r', kind: 'validateRequired', affectedHeads: 4, missingHeads: 4 }])).toBe(
      false,
    );
  });

  it('says what happens to entries without a value for a field made required', () => {
    const required: PlanStep = { kind: 'validateRequired', ownerId: before.id, fieldId: price.id };
    const impact = (missingHeads?: number) => ({
      key: 'r',
      kind: 'validateRequired',
      affectedHeads: 4,
      ...(missingHeads === undefined ? {} : { missingHeads, missingEntries: 3 }),
    });
    expect(requiredGapNotices([required], [impact(4)], before, after)).toEqual([
      "3 entries (4 versions) have no value for Price. They stay as they are, are listed in the Inbox under Required fields left empty, and can't be published again until Price is filled in.",
    ]);
    // Inside a component the preview has no count: the same notice without a number.
    expect(requiredGapNotices([required], [impact()], before, after)).toEqual([
      "Entries without a value for Price stay as they are. They're listed in the Inbox under Required fields left empty and can't be published again until it's filled in.",
    ]);
    // Every entry has a value: nothing to say.
    expect(requiredGapNotices([required], [impact(0)], before, after)).toEqual([]);
  });

  it('reports what a change that went live left to fill in', () => {
    const gap = (entries: number, versions: number) => ({
      step: 'r',
      ownerId: before.id,
      fieldId: price.id,
      fieldApiKey: 'price',
      versions,
      entries,
      sampleEntryIds: [],
    });
    expect(describeRequiredGaps({ requiredGaps: [gap(3, 4), gap(1, 1)] }, after)).toEqual([
      "3 entries (4 versions) have no value for Price; they're listed in the Inbox.",
      "1 entry (1 version) has no value for Price; it's listed in the Inbox.",
    ]);
    expect(describeRequiredGaps(null, after)).toEqual([]);
  });

  it('knows a plan with a failing check can not ship', () => {
    const impact = (invalidHeads?: number) => ({
      key: 'k',
      kind: 'validateRequired',
      affectedHeads: 2,
      invalidHeads,
    });
    expect(hasFailingCheck([impact(), impact(0)])).toBe(false);
    expect(hasFailingCheck([impact(), impact(1)])).toBe(true);
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

describe('a family of types', () => {
  const names: Record<string, string> = { [before.id]: 'Products', digital: 'Digital', media: 'Media' };
  const context = { definitionName: (id: string) => names[id] };
  const extendsChange = (from: string | null, to: string | null) =>
    classifyChange({ kind: 'model.extends', definitionId: 'digital', from, to }, { before, after });

  it('names the parents of a re-parent, never their IDs', () => {
    expect(describeChange(extendsChange(null, before.id), before, after, context)).toBe(
      'Make this a kind of Products',
    );
    expect(describeChange(extendsChange(before.id, 'media'), before, after, context)).toBe(
      'Move this from Products to Media',
    );
    expect(describeChange(extendsChange(before.id, null), before, after, context)).toBe(
      'Stop being a kind of Products: it becomes a type of its own',
    );
    expect(describeChange(extendsChange(before.id, 'unknown'), before, after, context)).toBe(
      'Change the type this extends',
    );
    expect(describeChange(extendsChange(null, before.id), before, after)).toBe(
      'Change the type this extends',
    );
  });

  it('names the kind a step of the family runs on', () => {
    const index: PlanStep = { kind: 'buildIndex', modelId: 'digital', fieldId: price.id };
    expect(describeStep(index, before, after, undefined, context)).toBe(
      'Digital: Build the filter and sort index for Price',
    );
    const own: PlanStep = { kind: 'buildIndex', modelId: before.id, fieldId: price.id };
    expect(describeStep(own, before, after, undefined, context)).toBe(
      'Build the filter and sort index for Price',
    );
  });
});
