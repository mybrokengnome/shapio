import type { SchemaChange } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import type { ScannedHead } from '../../repositories/entryHeads.js';
import type { ContentStep } from '../../schema/planner/steps.js';
import { convertValue } from './convert.js';
import { proposeEntry } from './propose.js';

const MODEL = '00000000-0000-4000-8000-000000000001';
const FIELD = '00000000-0000-4000-8000-000000000002';
const OTHER = '00000000-0000-4000-8000-000000000003';

const retype = (from: string, to: string): SchemaChange => ({
  kind: 'field.type',
  definitionId: MODEL,
  fieldId: FIELD,
  from,
  to,
});

const head = (state: 'draft' | 'published', data: ScannedHead['data']): ScannedHead => ({
  entry_id: 'entry-1',
  site_id: 'site-1',
  model_id: MODEL,
  locale: 'en',
  state,
  revision_id: 'revision-1',
  data,
  autosaved_at: null,
  change_seq: '1',
});

const convertStep = (change: SchemaChange): Extract<ContentStep, { kind: 'convert' }> => ({
  kind: 'convert',
  ownerId: MODEL,
  change,
  locations: [{ modelId: MODEL, path: [] }],
});

describe('convertValue: type changes', () => {
  it('clears every value of a pair Shapio cannot convert', () => {
    expect(convertValue(retype('media', 'number'), ['asset-1', 'asset-2'])).toEqual({ kind: 'clear' });
    expect(convertValue(retype('relation', 'boolean'), 'entry-2')).toEqual({ kind: 'clear' });
    expect(convertValue(retype('date', 'media'), '2026-10-10')).toEqual({ kind: 'clear' });
    // Even a value that happens to fit the new type: the rule is per pair, never per value.
    expect(convertValue(retype('json', 'boolean'), true)).toEqual({ kind: 'clear' });
  });

  it('leaves the known conversions as they were', () => {
    expect(convertValue(retype('number', 'decimal'), 12.5)).toEqual({ kind: 'set', value: '12.5' });
    expect(convertValue(retype('decimal', 'number'), '3')).toEqual({ kind: 'set', value: 3 });
    expect(convertValue(retype('boolean', 'text'), true)).toEqual({ kind: 'set', value: 'true' });
    expect(convertValue(retype('string', 'email'), 'a@b.c')).toEqual({ kind: 'keep' });
  });
});

describe('proposeEntry: a dropped field', () => {
  it('removes the value from every head and keeps the other fields', () => {
    const stored = [
      head('draft', { [FIELD]: ['asset-1'], [OTHER]: 'kept' }),
      head('published', { [FIELD]: ['asset-1'], [OTHER]: 'kept' }),
    ];
    const proposal = proposeEntry(stored, [convertStep(retype('media', 'number'))], 'en');
    expect(proposal.heads.map((proposed) => proposed.data)).toEqual([
      { [OTHER]: 'kept' },
      { [OTHER]: 'kept' },
    ]);
    expect(proposal.heads.every((proposed) => proposed.changed)).toBe(true);
    expect(proposal.failedSteps.size).toBe(0);
  });

  it('is idempotent: heads already without the value are unchanged', () => {
    const proposal = proposeEntry(
      [head('draft', { [OTHER]: 'kept' })],
      [convertStep(retype('media', 'number'))],
      'en',
    );
    expect(proposal.heads[0]?.changed).toBe(false);
  });
});
