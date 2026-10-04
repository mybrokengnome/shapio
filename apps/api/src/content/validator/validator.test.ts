import { normalizeDefinition, type ComponentDefinition, type ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import { buildSnapshot } from '../../schema/snapshot.js';
import { resolveModel } from '../model.js';
import { normalizeUniqueValue } from '../unique.js';
import { buildValidator, COMPONENT_KEY } from './index.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const hero = normalizeDefinition({
  id: id(100),
  kind: 'component',
  apiKey: 'hero',
  label: 'Hero',
  fields: [{ id: id(101), apiKey: 'heading', label: 'Heading', type: 'string', required: true }],
}) as ComponentDefinition;

const page = normalizeDefinition({
  id: id(1),
  kind: 'collection',
  apiKey: 'page',
  label: 'Page',
  fields: [
    {
      id: id(2),
      apiKey: 'title',
      label: 'Title',
      type: 'string',
      required: true,
      settings: { maxLength: 5 },
    },
    { id: id(3), apiKey: 'when', label: 'When', type: 'datetime' },
    { id: id(4), apiKey: 'at', label: 'At', type: 'time' },
    { id: id(5), apiKey: 'amount', label: 'Amount', type: 'decimal', settings: { scale: 2 } },
    { id: id(6), apiKey: 'big', label: 'Big', type: 'biginteger', settings: { max: '100' } },
    {
      id: id(7),
      apiKey: 'kinds',
      label: 'Kinds',
      type: 'enum',
      settings: {
        values: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
        multiple: true,
      },
    },
    {
      id: id(8),
      apiKey: 'sections',
      label: 'Sections',
      type: 'dynamiczone',
      settings: { components: [hero.id], max: 2 },
    },
    { id: id(9), apiKey: 'site', label: 'Site', type: 'url', settings: { protocols: ['https'] } },
    { id: id(10), apiKey: 'on', label: 'On', type: 'date' },
    { id: id(11), apiKey: 'old', label: 'Old', type: 'string', deprecated: true },
  ],
}) as ModelDefinition;

const snapshot = buildSnapshot(
  1,
  [page, hero].map((definition, index) => ({
    definition,
    version: 1,
    revisionId: id(900 + index),
    hash: 'x',
    activatedAt: new Date(),
    siteId: null,
  })),
  [{ code: 'en', label: 'English', isDefault: true, fallbacks: [] }],
);
const validator = buildValidator(snapshot, resolveModel(snapshot, 'page'));

describe('content validator', () => {
  it('maps API keys to field IDs, through dynamic zones', () => {
    const { patch, issues } = validator.fromInput({
      title: 'Hi',
      sections: [{ [COMPONENT_KEY]: 'hero', heading: 'H' }],
    });
    expect(issues).toEqual([]);
    expect(patch).toEqual({ [id(2)]: 'Hi', [id(8)]: [{ [COMPONENT_KEY]: hero.id, [id(101)]: 'H' }] });
    expect(validator.fromInput({ old: 'x', nope: 1 }).issues.map((issue) => issue.path)).toEqual([
      '/old',
      '/nope',
    ]);
  });

  it('canonicalizes dates, times and decimals', () => {
    const { data, issues } = validator.validate({
      [id(2)]: 'Hi',
      [id(3)]: '2026-10-01T10:00:00+02:00',
      [id(4)]: '09:30',
      [id(5)]: 12.5,
      [id(6)]: 42,
    });
    expect(issues).toEqual([]);
    expect(data).toMatchObject({
      [id(3)]: '2026-10-01T08:00:00.000Z',
      [id(4)]: '09:30:00.000',
      [id(5)]: '12.5',
      [id(6)]: '42',
    });
  });

  it('reports every rule with an API-key path', () => {
    const { issues } = validator.validate({
      [id(2)]: 'Too long',
      [id(5)]: '1.234',
      [id(6)]: '101',
      [id(7)]: ['a', 'a'],
      [id(8)]: [
        { [COMPONENT_KEY]: hero.id },
        { [COMPONENT_KEY]: id(999) },
        { [COMPONENT_KEY]: hero.id, [id(101)]: 'x' },
      ],
      [id(9)]: 'http://insecure.example',
      [id(10)]: '2026-02-30',
    });
    expect(issues.map((issue) => [issue.path, issue.code])).toEqual([
      ['/title', 'TOO_LONG'],
      ['/amount', 'INVALID_FORMAT'],
      ['/big', 'TOO_LARGE'],
      ['/kinds', 'DUPLICATE'],
      ['/sections', 'TOO_MANY'],
      ['/sections/0/heading', 'REQUIRED'],
      ['/sections/1/__component', 'UNKNOWN_COMPONENT'],
      ['/site', 'INVALID_FORMAT'],
      ['/on', 'INVALID_TYPE'],
    ]);
  });

  it('keeps values of removed and deprecated fields untouched and drops empty values', () => {
    const stored = {
      [id(2)]: 'Hi',
      [id(11)]: 'kept',
      'a0a0a0a0-0000-4000-8000-000000000000': 'removed field',
      [id(3)]: '',
    };
    expect(validator.validate(stored).data).toEqual({
      [id(2)]: 'Hi',
      [id(11)]: 'kept',
      'a0a0a0a0-0000-4000-8000-000000000000': 'removed field',
    });
  });

  it('skips required checks for autosaves only', () => {
    expect(validator.validate({}).issues.map((issue) => issue.code)).toEqual(['REQUIRED']);
    expect(validator.validate({}, { skipRequired: true }).issues).toEqual([]);
  });

  it('is cached per schema revision', () => {
    expect(buildValidator(snapshot, resolveModel(snapshot, 'page'))).toBe(validator);
  });
});

describe('unique normalization', () => {
  const field = (type: string) => ({ type }) as never;
  it.each([
    ['email', ' Ada@Example.COM ', 'ada@example.com'],
    ['decimal', '12.500', '12.5'],
    ['decimal', '-0.0', '0'],
    ['decimal', '007.10', '7.1'],
    ['biginteger', '0012', '12'],
    ['number', 1.0, '1'],
    ['string', ' x ', 'x'],
  ])('%s %j normalizes to %j', (type, value, expected) => {
    expect(normalizeUniqueValue(field(type), value)).toBe(expected);
  });
});
