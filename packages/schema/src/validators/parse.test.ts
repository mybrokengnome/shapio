import { describe, expect, it } from 'vitest';
import { id, model, field } from '../testing/fixtures.js';
import { parseDefinition } from './parse.js';

const sequence = () => {
  let n = 500;
  return () => id((n += 1));
};

describe('parseDefinition', () => {
  it('rejects non-objects and structural errors with JSON pointers', () => {
    expect(parseDefinition([])).toMatchObject({
      ok: false,
      issues: [{ code: 'INVALID_STRUCTURE', path: '' }],
    });
    const result = parseDefinition({ kind: 'collection', apiKey: 'page', label: '', fields: [], extra: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.map((found) => found.path)).toEqual(expect.arrayContaining(['', '/label']));
    }
  });

  it('rejects unknown settings keys per data type', () => {
    const result = parseDefinition({
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'title', label: 'Title', type: 'string', settings: { maxLenght: 5 } }],
    });
    expect(result).toMatchObject({
      ok: false,
      issues: [{ path: '/fields/0/settings', code: 'INVALID_SETTINGS' }],
    });
  });

  it('defaults a code field to plain and refuses an unknown language', () => {
    const parse = (codeSettings: Record<string, unknown>) =>
      parseDefinition({
        kind: 'collection',
        apiKey: 'page',
        label: 'Page',
        fields: [{ apiKey: 'snippet', label: 'Snippet', type: 'code', settings: codeSettings }],
      });
    const parsed = parse({});
    expect(parsed.ok && parsed.definition.fields[0]).toMatchObject({
      type: 'code',
      settings: { language: 'plain' },
      editor: { id: 'codeEditor' },
    });
    expect(parse({ language: 'php' })).toMatchObject({
      ok: false,
      issues: [{ path: '/fields/0/settings/language', code: 'INVALID_SETTINGS' }],
    });
  });

  it('assigns IDs and applies defaults', () => {
    const result = parseDefinition(
      {
        kind: 'collection',
        apiKey: 'page',
        label: 'Page',
        fields: [{ apiKey: 'title', label: 'Title', type: 'string' }],
      },
      { createId: sequence() },
    );
    expect(result).toEqual({
      ok: true,
      definition: {
        id: id(502),
        kind: 'collection',
        apiKey: 'page',
        pluralApiKey: 'pages',
        label: 'Page',
        localized: false,
        draftAndPublish: true,
        display: {},
        fields: [
          {
            id: id(501),
            apiKey: 'title',
            label: 'Title',
            type: 'string',
            required: false,
            localized: false,
            public: true,
            unique: false,
            filterable: false,
            sortable: false,
            deprecated: false,
            settings: {},
            editor: { id: 'textInput', options: {} },
          },
        ],
      },
    });
  });

  it('keeps the IDs of existing fields matched by API key when the input omits them', () => {
    const previous = model({
      id: id(1),
      fields: [field({ apiKey: 'title', id: id(2) }), field({ apiKey: 'body', id: id(3) })],
    });
    const result = parseDefinition(
      {
        kind: 'collection',
        apiKey: 'page',
        label: 'Page',
        fields: [
          { apiKey: 'Title', label: 'Title', type: 'string' },
          { apiKey: 'summary', label: 'Summary', type: 'text' },
        ],
      },
      { previous, createId: sequence() },
    );
    expect(result.ok && result.definition.id).toBe(id(1));
    expect(result.ok && result.definition.fields.map((entry) => entry.id)).toEqual([id(2), id(501)]);
  });

  it('runs the semantic checks', () => {
    const result = parseDefinition({
      kind: 'collection',
      apiKey: 'page',
      label: 'Page',
      fields: [{ apiKey: 'id', label: 'ID', type: 'string' }],
    });
    expect(result).toMatchObject({ ok: false, issues: [{ code: 'API_KEY_RESERVED' }] });
  });
});
