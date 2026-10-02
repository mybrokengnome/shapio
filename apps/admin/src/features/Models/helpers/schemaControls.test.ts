import { EDITOR_CATALOGUE, SETTINGS_SCHEMAS } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { describeProperties } from './schemaControls';

describe('describeProperties', () => {
  it('describes string settings', () => {
    expect(describeProperties(SETTINGS_SCHEMAS.string)).toEqual([
      { key: 'minLength', control: { kind: 'integer', minimum: 0 }, required: false },
      { key: 'maxLength', control: { kind: 'integer', minimum: 1 }, required: false },
      { key: 'pattern', control: { kind: 'text', maxLength: 500 }, required: false },
    ]);
  });

  it('describes enums, arrays of enums and required keys', () => {
    expect(describeProperties(SETTINGS_SCHEMAS.relation)).toContainEqual({
      key: 'cardinality',
      control: { kind: 'choice', options: ['one', 'many'] },
      required: true,
    });
    expect(describeProperties(SETTINGS_SCHEMAS.url)).toEqual([
      {
        key: 'protocols',
        control: { kind: 'choices', options: ['http', 'https', 'mailto', 'tel'] },
        required: false,
      },
    ]);
  });

  it('describes editor options', () => {
    expect(describeProperties(EDITOR_CATALOGUE.get('color')?.optionsSchema)).toEqual([
      { key: 'format', control: { kind: 'choice', options: ['hex', 'rgb'] }, required: false },
      { key: 'presets', control: { kind: 'textList' }, required: false },
    ]);
  });
});
