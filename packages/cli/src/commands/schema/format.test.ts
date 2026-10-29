import { ShapioApiError, type SchemaSyncResult } from '@shapio/client';
import type { DataType, SchemaChange } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { formatApiError, formatChange, formatItem, formatRequiredGaps } from './format.js';

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
    expect(formatChange({ ...typeChange('enum', 'string'), dropsValues: true }, names)).toEqual([
      '~ field price type: "enum" → "string" (values dropped)',
    ]);
    expect(formatChange({ ...typeChange('media', 'number'), dropsValues: false }, names)).toEqual([
      '~ field price type: "media" → "number"',
    ]);
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

describe('types that extend a type', () => {
  // As collectNames reads them from the files: the parent's file names the inherited field.
  const familyNames = new Map([
    ['post-id', 'post'],
    ['guide-id', 'guide'],
    ['article-id', 'article'],
    ['f-summary', 'summary'],
  ]);
  const parents = new Map([['guide-id', 'post-id']]);
  const item = (changes: SchemaChange[]): SchemaSyncResult => ({
    definitionId: 'guide-id',
    apiKey: 'guide',
    kind: 'collection',
    decision: { action: 'update', expectedVersion: 3 },
    changes,
    plan: { summary: { breaking: true } },
  });

  it('names the parent in the header, by API ID', () => {
    expect(formatItem(item([]), familyNames, parents)).toBe('model guide (extends post): update [BREAKING]');
    expect(formatItem({ ...item([]), definitionId: 'post-id', apiKey: 'post' }, familyNames, parents)).toBe(
      'model post: update [BREAKING]',
    );
  });

  it('prints a re-parent with both parents by name, and gaining or losing a parent as (none)', () => {
    const reparent: SchemaChange = {
      kind: 'model.extends',
      definitionId: 'guide-id',
      from: 'post-id',
      to: 'article-id',
    };
    expect(formatChange(reparent, familyNames)).toEqual(['~ extends: post → article']);
    expect(formatChange({ ...reparent, from: null }, familyNames)).toEqual(['~ extends: (none) → article']);
    expect(formatChange({ ...reparent, to: null }, familyNames)).toEqual(['~ extends: post → (none)']);
    // A parent the files do not hold (only on the instance) falls back to its ID.
    expect(formatChange({ ...reparent, to: 'remote-id' }, familyNames)).toEqual([
      '~ extends: post → remote-id',
    ]);
  });

  it('names inherited fields, and the kind a change lands on when it is not the item itself', () => {
    const gained: SchemaChange = { kind: 'field.removed', definitionId: 'guide-id', fieldId: 'f-summary' };
    const onChild: SchemaChange = {
      kind: 'field.required',
      definitionId: 'guide-id',
      fieldId: 'f-summary',
      from: false,
      to: true,
    };
    expect(
      formatItem({ ...item([gained]), definitionId: 'post-id', apiKey: 'post' }, familyNames, parents),
    ).toBe('model post: update [BREAKING]\n    - field summary (on guide)');
    expect(formatItem(item([onChild]), familyNames, parents)).toBe(
      'model guide (extends post): update [BREAKING]\n    ~ field summary required: false → true',
    );
  });

  it('adds a hint for each inheritance problem in the refused files', () => {
    const error = new ShapioApiError(422, {
      error: {
        code: 'SCHEMA_INVALID',
        message: 'The schema files are invalid',
        details: {
          issues: [
            {
              path: '/definitions/1/extends',
              code: 'UNKNOWN_PARENT',
              message: 'extends a type that does not exist',
            },
            {
              path: '/definitions/1/localized',
              code: 'INHERITED_FLAG_MISMATCH',
              message: 'must equal the parent\'s: set "localized" to true, as "post" has it',
            },
          ],
        },
      },
    });
    const text = formatApiError(error, ['schema/models/post.json', 'schema/models/guide.json'], familyNames);
    expect(text).toContain('  schema/models/guide.json /extends: extends a type that does not exist');
    expect(text).toContain('"extends" holds the stable ID of the parent type');
    expect(text).toContain('must agree on "localized" and "draftAndPublish"');
  });

  it('explains how to delete a type that others extend', () => {
    const error = new ShapioApiError(422, {
      error: {
        code: 'SCHEMA_INVALID',
        message: 'Invalid',
        details: { issues: [{ path: '', code: 'HAS_CHILDREN', message: '"guide" extends "post"' }] },
      },
    });
    expect(formatApiError(error, [], familyNames)).toContain('Delete the types that extend it first');
  });
});

describe('interfaces', () => {
  const interfaceNames = new Map([
    ['featurable-id', 'featurable'],
    ['listable-id', 'listable'],
    ['post-id', 'post'],
    ['f-title', 'title'],
    ['f-image', 'image'],
  ]);
  const implemented = new Map([['post-id', ['featurable-id', 'listable-id']]]);
  const postItem = (changes: SchemaChange[]): SchemaSyncResult => ({
    definitionId: 'post-id',
    apiKey: 'post',
    kind: 'collection',
    decision: { action: 'update', expectedVersion: 2 },
    changes,
  });
  const interfaceItem = (changes: SchemaChange[]): SchemaSyncResult => ({
    definitionId: 'featurable-id',
    apiKey: 'featurable',
    kind: 'interface',
    decision: { action: 'update', expectedVersion: 4 },
    changes,
  });

  it('names what a type implements in its header, by API ID', () => {
    expect(formatItem(postItem([]), interfaceNames, new Map(), implemented)).toBe(
      'model post (implements featurable, listable): update',
    );
    // An interface the files do not hold falls back to its ID.
    expect(formatItem(postItem([]), interfaceNames, new Map(), new Map([['post-id', ['remote-id']]]))).toBe(
      'model post (implements remote-id): update',
    );
  });

  it('prints an interface as an interface, its fields as contract fields', () => {
    const added: SchemaChange = { kind: 'field.added', definitionId: 'featurable-id', fieldId: 'f-image' };
    const required: SchemaChange = {
      kind: 'field.required',
      definitionId: 'featurable-id',
      fieldId: 'f-title',
      from: false,
      to: true,
    };
    expect(formatItem(interfaceItem([added, required]), interfaceNames)).toBe(
      'interface featurable: update\n' +
        '    + contract field image\n' +
        '    ~ contract field title required: false → true',
    );
  });

  it('prints a type starting or stopping to implement an interface', () => {
    const change: SchemaChange = {
      kind: 'model.implements',
      definitionId: 'post-id',
      property: 'featurable-id',
      from: null,
      to: 'featurable-id',
    };
    expect(formatChange(change, interfaceNames)).toEqual(['+ implements featurable']);
    expect(formatChange({ ...change, from: 'featurable-id', to: null }, interfaceNames)).toEqual([
      '- implements featurable',
    ]);
  });

  it('names both sides of a relation target change: a type, an interface, or any entry', () => {
    const names = new Map([...interfaceNames, ['f-featured', 'featured']]);
    const retarget: SchemaChange = {
      kind: 'field.settings',
      definitionId: 'home-id',
      fieldId: 'f-featured',
      property: 'target',
      from: 'post-id',
      to: 'featurable-id',
    };
    expect(formatChange(retarget, names)).toEqual(['~ field featured target: post → featurable']);
    expect(formatChange({ ...retarget, from: 'featurable-id', to: '*' }, names)).toEqual([
      '~ field featured target: featurable → any entry',
    ]);
    // A target the files do not hold falls back to its ID.
    expect(formatChange({ ...retarget, to: 'remote-id' }, names)).toEqual([
      '~ field featured target: post → remote-id',
    ]);
    // Other settings still print their values.
    expect(formatChange({ ...retarget, property: 'cardinality', from: 'one', to: 'many' }, names)).toEqual([
      '~ field featured cardinality: "one" → "many"',
    ]);
  });

  it('adds a hint for each interface problem in the refused files', () => {
    const issue = (code: string) => ({ path: '/definitions/0/implements/0', code, message: code });
    const error = new ShapioApiError(422, {
      error: {
        code: 'SCHEMA_INVALID',
        message: 'Invalid',
        details: {
          issues: [
            'UNKNOWN_INTERFACE',
            'INVALID_INTERFACE',
            'INTERFACE_FIELD_MISSING',
            'INTERFACE_FIELD_MISMATCH',
            'INVALID_INTERFACE_FIELD',
            'HAS_MEMBERS',
            'RELATION_VALUES_EXIST',
          ].map(issue),
        },
      },
    });
    const text = formatApiError(error, ['schema/models/post.json'], interfaceNames);
    expect(text).toContain('  schema/models/post.json /implements/0: UNKNOWN_INTERFACE');
    expect(text).toContain('"implements" holds the stable IDs of interfaces');
    expect(text).toContain('Only a collection or a single type can implement an interface');
    expect(text).toContain('Give the type the field the message names');
    expect(text).toContain('Make the type’s field match the interface’s');
    expect(text).toContain('An interface’s field can’t be a component or a dynamic zone');
    expect(text).toContain('Remove the interface from "implements" on every type that names it');
    expect(text).toContain('Remove the references the message counts');
  });
});

describe('formatRequiredGaps', () => {
  const gap = (entries: number, versions: number) => ({
    step: 'validateRequired:m1:f1',
    ownerId: 'm1',
    fieldId: 'f1',
    fieldApiKey: 'keywords',
    versions,
    entries,
    sampleEntryIds: [],
  });

  it('says how many entries a field made required has no value in, and where they are listed', () => {
    expect(formatRequiredGaps('article', { requiredGaps: [gap(3, 4), gap(1, 1)] })).toEqual([
      'article: 3 entries (4 versions) have no value for "keywords"; they\'re listed in the Inbox.',
      'article: 1 entry (1 version) has no value for "keywords"; it\'s listed in the Inbox.',
    ]);
  });

  it('says nothing when the change left nothing to do', () => {
    expect(formatRequiredGaps('article', null)).toEqual([]);
  });
});
