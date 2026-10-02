import { classifyChanges, diffDefinitions, summarizeChanges, type ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { bucketOfChange, bucketOfPlan, groupByBucket } from './planBuckets';

const field = {
  id: '00000000-0000-4000-8000-000000000003',
  apiKey: 'title',
  label: 'Title',
  type: 'string' as const,
  required: false,
  localized: false,
  public: true,
  unique: false,
  filterable: false,
  sortable: false,
  deprecated: false,
  settings: {},
  editor: { id: 'textInput', options: {} },
};

const model: ModelDefinition = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  localized: false,
  draftAndPublish: true,
  fields: [field],
  display: {},
};

const plan = (after: ModelDefinition) => {
  const changes = classifyChanges(diffDefinitions(model, after), { before: model, after });
  return { changes, summary: summarizeChanges(changes) };
};

describe('plan buckets', () => {
  it('a label rename is metadata only', () => {
    const { changes, summary } = plan({ ...model, fields: [{ ...field, label: 'Headline' }] });
    expect(changes.map(bucketOfChange)).toEqual(['metadata']);
    expect(bucketOfPlan(summary)).toBe('metadata');
  });

  it('an optional field is live', () => {
    const extra = { ...field, id: '00000000-0000-4000-8000-000000000004', apiKey: 'subtitle' };
    const { summary } = plan({ ...model, fields: [field, extra] });
    expect(bucketOfPlan(summary)).toBe('live');
  });

  it('making a field required needs prerequisites', () => {
    const { summary } = plan({ ...model, fields: [{ ...field, required: true }] });
    expect(bucketOfPlan(summary)).toBe('prerequisites');
  });

  it('an API key rename is breaking and its group comes first', () => {
    const { changes, summary } = plan({
      ...model,
      fields: [{ ...field, apiKey: 'headline', label: 'Headline' }],
    });
    expect(bucketOfPlan(summary)).toBe('breaking');
    expect(groupByBucket(changes).map(({ bucket, changes: inGroup }) => [bucket, inGroup.length])).toEqual([
      ['breaking', 1],
      ['metadata', 1],
    ]);
  });
});
