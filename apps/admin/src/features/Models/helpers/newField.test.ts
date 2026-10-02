import type { SchemaDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { createField } from './draft';
import { uniqueNewFieldName, withFieldType } from './newField';

const empty = {
  kind: 'collection',
  id: 'm1',
  apiKey: 'article',
  label: 'Article',
  fields: [],
  display: {},
} as unknown as SchemaDefinition;

const withField = (definition: SchemaDefinition, label: string, apiKey: string) => {
  const field = createField(definition, { type: 'string', label, apiKey });
  return { definition: { ...definition, fields: [...definition.fields, field] }, field };
};

describe('uniqueNewFieldName', () => {
  it('numbers the label until neither it nor its API ID is taken', () => {
    expect(uniqueNewFieldName(empty, 'New field')).toEqual({ label: 'New field', apiKey: 'newField' });
    const { definition } = withField(empty, 'New field', 'newField');
    expect(uniqueNewFieldName(definition, 'New field')).toEqual({
      label: 'New field 2',
      apiKey: 'newField2',
    });
    const { definition: renamed } = withField(empty, 'Other', 'NEWFIELD');
    expect(uniqueNewFieldName(renamed, 'New field').apiKey).toBe('newField2');
  });
});

describe('withFieldType', () => {
  it('starts the field over as the new type, keeping its ID, position and names', () => {
    const first = withField(empty, 'Title', 'title');
    const second = withField(first.definition, 'Flag', 'flag');
    const next = withFieldType(second.definition, first.field.id, 'boolean');
    expect(next.fields.map((field) => field.id)).toEqual([first.field.id, second.field.id]);
    expect(next.fields[0]).toMatchObject({
      id: first.field.id,
      type: 'boolean',
      label: 'Title',
      apiKey: 'title',
    });
  });

  it('drops the title field when the new type cannot label entries, and sets it when it can', () => {
    const { definition, field } = withField(empty, 'Name', 'name');
    const titled = { ...definition, display: { titleFieldId: field.id } } as SchemaDefinition;
    const boolean = withFieldType(titled, field.id, 'boolean');
    expect(boolean.display.titleFieldId).toBeUndefined();
    expect(withFieldType(boolean, field.id, 'string').display.titleFieldId).toBe(field.id);
  });
});

describe('withFieldType on a field with options', () => {
  it('keeps the options and drops the default value', () => {
    const { definition, field } = withField(empty, 'Body', 'body');
    const edited = {
      ...definition,
      fields: [{ ...field, required: true, defaultValue: 'x' }],
    } as SchemaDefinition;
    const next = withFieldType(edited, field.id, 'richtext').fields[0];
    expect(next).toMatchObject({ type: 'richtext', required: true });
    expect(next).not.toHaveProperty('defaultValue');
  });
});
