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
    expect(formatChange(typeChange('media', 'number'), names)).toEqual([
      '~ field price type: "media" → "number" (values dropped)',
    ]);
  });

  it("follows the server's classification: a multi-value enum to text drops its values", () => {
    expect(formatChange({ ...typeChange('enum', 'string'), dropsValues: true }, names)).toBe(
      '~ field price type: "enum" → "string" (values dropped)',
    );
    expect(formatChange({ ...typeChange('media', 'number'), dropsValues: false }, names)).toBe(
      '~ field price type: "media" → "number"',
    );
  });

  it('prints a type change Shapio converts as before', () => {
    expect(formatChange(typeChange('text', 'richtext'), names)).toEqual([
      '~ field price type: "text" → "richtext"',
    ]);
  });

  it('prints only the parts of a layout that changed, in full and in a stable key order', () => {
    const id = (n: number) => `ec3be599-671a-4ba9-9904-${String(n).padStart(12, '0')}`;
    const group = (gid: string, label: string, fieldIds: string[]) => ({ id: gid, label, fieldIds });
    const display: SchemaChange = {
      kind: 'definition.metadata',
      definitionId: 'm1',
      property: 'display',
      from: { layout: 'form', groups: [group('g1', 'Main', [id(1), id(2), id(3)])] },
      // Keys in another order, as a file sorted by key would have them.
      to: {
        groups: [group('g1', 'Main', [id(1), id(2), id(3)]), group('g2', 'Details', [id(4)])],
        layout: 'form',
      },
    };
    expect(formatChange(display, names)).toEqual([
      `~ display.groups[1]: (unset) → {"fieldIds":["${id(4)}"],"id":"g2","label":"Details"}`,
    ]);
    const relabel = {
      ...display,
      to: { layout: 'document', groups: [group('g1', 'Basics', [id(1), id(2), id(3)])] },
    };
    expect(formatChange(relabel, names)).toEqual([
      '~ display.groups[0].label: "Main" → "Basics"',
      '~ display.layout: "form" → "document"',
    ]);
  });

  it('prints a changed list of IDs whole, and long values without cutting them', () => {
    const long = 'x'.repeat(200);
    const change: SchemaChange = {
      kind: 'field.settings',
      definitionId: 'm1',
      fieldId: 'f1',
      property: 'canvasFieldIds',
      from: ['a', 'b'],
      to: ['b', 'a', long],
    };
    expect(formatChange(change, names)).toEqual([
      `~ field price canvasFieldIds: ["a","b"] → ["b","a","${long}"]`,
    ]);
  });
});
