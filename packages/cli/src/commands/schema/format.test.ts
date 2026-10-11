import type { DataType, SchemaChange } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { formatChange } from './format.js';

const names = new Map([['f1', 'price']]);
const typeChange = (from: DataType, to: DataType): SchemaChange => ({
  kind: 'field.type',
  definitionId: 'm1',
  fieldId: 'f1',
  from,
  to,
});

describe('formatChange', () => {
  it('says a type change Shapio cannot convert drops the values', () => {
    expect(formatChange(typeChange('media', 'number'), names)).toBe(
      '~ field price type: "media" → "number" (values dropped)',
    );
  });

  it('prints a type change Shapio converts as before', () => {
    expect(formatChange(typeChange('text', 'richtext'), names)).toBe(
      '~ field price type: "text" → "richtext"',
    );
  });
});
