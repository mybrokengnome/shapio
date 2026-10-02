import type { ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { createField } from './draft';
import { merge3, rebaseDraft } from './rebase';

const model: ModelDefinition = {
  id: '00000000-0000-4000-8000-000000000001',
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  localized: false,
  draftAndPublish: true,
  fields: [],
  display: {},
};
const title = createField(model, { type: 'string', label: 'Title', apiKey: 'title' });
const body = createField(model, { type: 'text', label: 'Body', apiKey: 'body' });
const base: ModelDefinition = { ...model, fields: [title, body] };

describe('merge3', () => {
  it('takes the side that changed and merges objects key by key', () => {
    expect(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 })).toEqual({ a: 2, b: 3 });
    expect(merge3(1, 2, 3)).toBe(2);
    expect(merge3({ a: 1 }, {}, { a: 1 })).toEqual({});
  });
});

describe('rebaseDraft', () => {
  it("keeps the other session's edits to things this session did not touch", () => {
    const draft = { ...base, fields: [{ ...title, label: 'Headline' }, body] };
    const latest = { ...base, fields: [title, { ...body, description: 'The text' }] };
    const rebased = rebaseDraft(base, draft, latest);
    expect(rebased.fields.map((field) => [field.label, field.description])).toEqual([
      ['Headline', undefined],
      ['Body', 'The text'],
    ]);
  });

  it('keeps additions and removals from both sides', () => {
    const mine = createField(model, { type: 'boolean', label: 'Featured', apiKey: 'featured' });
    const theirs = createField(model, { type: 'date', label: 'Date', apiKey: 'date' });
    const draft = { ...base, fields: [title, mine] };
    const latest = { ...base, label: 'Post', fields: [title, body, theirs] };
    const rebased = rebaseDraft(base, draft, latest);
    expect(rebased.label).toBe('Post');
    expect(rebased.fields.map((field) => field.apiKey)).toEqual(['title', 'date', 'featured']);
  });

  it("follows this session's order when it reordered fields", () => {
    const draft = { ...base, fields: [body, title] };
    const latest = { ...base, fields: [title, { ...body, label: 'Text' }] };
    expect(rebaseDraft(base, draft, latest).fields.map((field) => field.label)).toEqual(['Text', 'Title']);
  });
});
