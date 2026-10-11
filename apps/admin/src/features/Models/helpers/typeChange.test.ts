import type { SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { createField } from './draft';
import { classifyFieldTypeChange } from './typeChange';

const base = { kind: 'collection', id: 'm1', apiKey: 'article', label: 'Article', fields: [], display: {} };

const savedWith = (type: 'text' | 'richtext') => {
  const field = createField(base as unknown as SchemaDefinition, { type, label: 'Body', apiKey: 'body' });
  return { saved: { ...base, fields: [field] } as unknown as SchemaDefinition, field };
};

describe('classifyFieldTypeChange', () => {
  it('agrees with the planner on breaking, destructive and value-dropping conversions', () => {
    const text = savedWith('text');
    expect(classifyFieldTypeChange(text.saved, text.field, 'text')).toBeNull();
    expect(classifyFieldTypeChange(text.saved, text.field, 'richtext')).toMatchObject({
      category: 'conversion',
      supported: true,
      breaking: true,
      destructive: false,
    });
    expect(classifyFieldTypeChange(text.saved, text.field, 'richtext')?.dropsValues).toBe(false);
    // Shapio can't convert text to media: the change is allowed and drops every stored value.
    expect(classifyFieldTypeChange(text.saved, text.field, 'media')).toMatchObject({
      category: 'conversion',
      supported: true,
      destructive: true,
      dropsValues: true,
    });
    const rich = savedWith('richtext');
    expect(classifyFieldTypeChange(rich.saved, rich.field, 'text')).toMatchObject({ destructive: true });
  });
});
