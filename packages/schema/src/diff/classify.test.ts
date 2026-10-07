import { describe, expect, it } from 'vitest';
import { component, field, id, model, withField } from '../testing/fixtures.js';
import type { FieldDefinition, FieldInput, ModelDefinition } from '../types/definitions.js';
import {
  classifyChanges,
  classifyLocaleChange,
  summarizeChanges,
  type ClassifiedChange,
} from './classify.js';
import { diffDefinitions } from './diffDefinitions.js';

const settings = (value: Record<string, unknown>) => value as FieldInput['settings'];
const FIELD = id(2);

const base = (overrides: Partial<FieldInput> = {}, modelOverrides: Partial<ModelDefinition> = {}) =>
  model({
    id: id(1),
    apiKey: 'page',
    fields: [field({ apiKey: 'title', id: FIELD, ...overrides })],
    ...modelOverrides,
  });

const classify = (before: ModelDefinition | null, after: ModelDefinition | null): ClassifiedChange[] =>
  classifyChanges(diffDefinitions(before, after), { before, after });

const only = (before: ModelDefinition | null, after: ModelDefinition | null) => {
  const changes = classify(before, after);
  expect(changes).toHaveLength(1);
  return changes[0] as ClassifiedChange;
};

const editField = (before: ModelDefinition, update: (f: FieldDefinition) => FieldDefinition) =>
  withField(before, FIELD, update);

const expectClass = (
  change: ClassifiedChange,
  expected: Partial<
    Pick<
      ClassifiedChange,
      'category' | 'breaking' | 'destructive' | 'supported' | 'prerequisites' | 'cleanup'
    >
  >,
) =>
  expect(change).toMatchObject({
    breaking: false,
    destructive: false,
    supported: true,
    prerequisites: [],
    cleanup: [],
    ...expected,
  });

describe('classifyChange: brief §5 rows', () => {
  it('label, help text and editor layout are metadata', () => {
    const before = base();
    expectClass(
      only(
        before,
        editField(before, (f) => ({ ...f, label: 'Headline' })),
      ),
      { category: 'metadata' },
    );
    expectClass(
      only(
        before,
        editField(before, (f) => ({ ...f, description: 'Shown in lists' })),
      ),
      { category: 'metadata' },
    );
    expectClass(
      only(before, { ...before, display: { groups: [{ id: 'main', label: 'Main', fieldIds: [FIELD] }] } }),
      {
        category: 'metadata',
      },
    );
    expectClass(only(before, { ...before, label: 'Pages' }), { category: 'metadata' });
  });

  it('a compatible editor swap is immediate', () => {
    const before = base();
    expectClass(
      only(
        before,
        editField(before, (f) => ({ ...f, editor: { id: 'textarea', options: {} } })),
      ),
      {
        category: 'editorSwap',
      },
    );
  });

  it('an optional field or a new model is additive', () => {
    const before = base();
    const after = model({ ...before, fields: [...before.fields, field({ apiKey: 'summary' })] });
    expectClass(only(before, after), { category: 'additive' });
    expectClass(only(null, before), { category: 'additive' });
  });

  it('a new required field validates existing entries, or backfills when it has a default', () => {
    const before = base();
    const required = model({
      ...before,
      fields: [...before.fields, field({ apiKey: 'summary', required: true })],
    });
    expectClass(only(before, required), { category: 'requiredField', prerequisites: ['validateRequired'] });
    const defaulted = model({
      ...before,
      fields: [...before.fields, field({ apiKey: 'summary', required: true, defaultValue: 'n/a' })],
    });
    expectClass(only(before, defaulted), { category: 'requiredField', prerequisites: ['backfill'] });
  });

  it('making a field required validates or backfills; making it optional is additive', () => {
    const before = base();
    expectClass(
      only(
        before,
        editField(before, (f) => ({ ...f, required: true })),
      ),
      {
        category: 'requiredField',
        prerequisites: ['validateRequired'],
      },
    );
    const withDefault = base({ defaultValue: 'x' });
    expect(
      classify(
        withDefault,
        editField(withDefault, (f) => ({ ...f, required: true })),
      )[0]?.prerequisites,
    ).toEqual(['backfill']);
    const required = base({ required: true });
    expectClass(
      only(
        required,
        editField(required, (f) => ({ ...f, required: false })),
      ),
      { category: 'additive' },
    );
  });

  it('a cross-family type change is a conversion; unsupported pairs are flagged', () => {
    const number = base({ type: 'number' });
    expectClass(
      only(
        number,
        editField(number, (f) => ({ ...f, type: 'decimal', settings: {} })),
      ),
      {
        category: 'conversion',
        breaking: true,
        prerequisites: ['convert', 'validateValues'],
      },
    );
    const text = base({ type: 'text' });
    expectClass(
      only(
        text,
        editField(text, (f) => ({ ...f, type: 'richtext', settings: { formatVersion: 1 } })),
      ),
      {
        category: 'conversion',
        breaking: true,
        prerequisites: ['convert', 'validateValues'],
      },
    );
    const richtext = base({ type: 'richtext' });
    expectClass(
      only(
        richtext,
        editField(richtext, (f) => ({ ...f, type: 'text', settings: {} })),
      ),
      {
        category: 'conversion',
        breaking: true,
        destructive: true,
        prerequisites: ['convert', 'validateValues'],
      },
    );
    const json = base({ type: 'json' });
    expectClass(
      only(
        json,
        editField(json, (f) => ({ ...f, type: 'boolean', settings: {} })),
      ),
      {
        category: 'conversion',
        breaking: true,
        supported: false,
      },
    );
  });

  it('a type change of a unique field also checks uniqueness under the new type', () => {
    const uniqueString = base({ type: 'string', unique: true });
    expectClass(
      only(
        uniqueString,
        editField(uniqueString, (f) => ({ ...f, type: 'email', settings: {} })),
      ),
      { category: 'validation', prerequisites: ['validateValues', 'checkUnique'] },
    );
    // Even a widening that is otherwise live re-checks (normalization can differ between types).
    const uniqueEmail = base({ type: 'email', unique: true });
    expectClass(
      only(
        uniqueEmail,
        editField(uniqueEmail, (f) => ({ ...f, type: 'string', settings: {} })),
      ),
      { category: 'additive', prerequisites: ['checkUnique'] },
    );
    const uniqueDecimal = base({ type: 'decimal', unique: true });
    expectClass(
      only(
        uniqueDecimal,
        editField(uniqueDecimal, (f) => ({ ...f, type: 'string', settings: {} })),
      ),
      { category: 'conversion', breaking: true, prerequisites: ['convert', 'validateValues', 'checkUnique'] },
    );
  });

  it('a same-family type change validates, or is live when it only widens', () => {
    const email = base({ type: 'email' });
    expectClass(
      only(
        email,
        editField(email, (f) => ({ ...f, type: 'string', settings: {} })),
      ),
      {
        category: 'additive',
      },
    );
    const string = base({ type: 'string' });
    expectClass(
      only(
        string,
        editField(string, (f) => ({ ...f, type: 'email', settings: {} })),
      ),
      {
        category: 'validation',
        prerequisites: ['validateValues'],
      },
    );
    const integer = base({ type: 'integer' });
    expectClass(
      only(
        integer,
        editField(integer, (f) => ({ ...f, type: 'number', settings: {} })),
      ),
      {
        category: 'additive',
        breaking: true,
      },
    );
    const number = base({ type: 'number' });
    expectClass(
      only(
        number,
        editField(number, (f) => ({ ...f, type: 'integer', settings: {} })),
      ),
      {
        category: 'validation',
        breaking: true,
        prerequisites: ['validateValues'],
      },
    );
  });

  it('a rich-text format version change is a conversion', () => {
    const richtext = base({ type: 'richtext' });
    expectClass(
      only(
        richtext,
        editField(richtext, (f) => ({ ...f, settings: { formatVersion: 2 } }) as FieldDefinition),
      ),
      { category: 'conversion', prerequisites: ['convert', 'validateValues'] },
    );
  });

  it('an API key rename is an explicit breaking contract change, for fields and models', () => {
    const before = base();
    expectClass(
      only(
        before,
        editField(before, (f) => ({ ...f, apiKey: 'headline' })),
      ),
      { category: 'contract', breaking: true },
    );
    expectClass(only(before, { ...before, apiKey: 'landingPage' }), { category: 'contract', breaking: true });
    expectClass(only(before, { ...before, pluralApiKey: 'allPages' }), {
      category: 'contract',
      breaking: true,
    });
  });

  it('field removal is breaking but keeps values, and cleans up its index and unique registry', () => {
    const before = base({ unique: true, filterable: true });
    expectClass(only(before, { ...before, fields: [] }), {
      category: 'removal',
      breaking: true,
      cleanup: ['dropIndex', 'releaseUnique'],
    });
    expectClass(only(before, null), { category: 'removal', breaking: true });
  });

  it('adding a unique constraint checks existing values; removing it releases the registry', () => {
    const before = base();
    expectClass(
      only(
        before,
        editField(before, (f) => ({ ...f, unique: true })),
      ),
      {
        category: 'constraint',
        prerequisites: ['checkUnique'],
      },
    );
    const unique = base({ unique: true });
    expectClass(
      only(
        unique,
        editField(unique, (f) => ({ ...f, unique: false })),
      ),
      {
        category: 'additive',
        cleanup: ['releaseUnique'],
      },
    );
  });

  it('filterable/sortable build one index, dropped when neither remains', () => {
    const before = base();
    expectClass(
      only(
        before,
        editField(before, (f) => ({ ...f, filterable: true })),
      ),
      {
        category: 'index',
        prerequisites: ['buildIndex'],
      },
    );
    const filterable = base({ filterable: true });
    expectClass(
      only(
        filterable,
        editField(filterable, (f) => ({ ...f, sortable: true })),
      ),
      { category: 'metadata' },
    );
    expectClass(
      only(
        filterable,
        editField(filterable, (f) => ({ ...f, filterable: false })),
      ),
      {
        category: 'index',
        cleanup: ['dropIndex'],
      },
    );
    const added = model({
      ...before,
      fields: [...before.fields, field({ apiKey: 'rank', type: 'integer', sortable: true, unique: true })],
    });
    expectClass(only(before, added), { category: 'additive', prerequisites: ['checkUnique', 'buildIndex'] });
  });
});

describe('classifyChange: localization, publishing and model kind', () => {
  it('field localized false→true is additive; true→false is a destructive conversion (localized models only)', () => {
    const before = base({}, { localized: true });
    expectClass(
      only(
        before,
        editField(before, (f) => ({ ...f, localized: true })),
      ),
      { category: 'additive' },
    );
    const localized = base({ localized: true }, { localized: true });
    expectClass(
      only(
        localized,
        editField(localized, (f) => ({ ...f, localized: false })),
      ),
      {
        category: 'conversion',
        destructive: true,
        prerequisites: ['convert'],
      },
    );
    const plain = base();
    expectClass(
      only(
        plain,
        editField(plain, (f) => ({ ...f, localized: true })),
      ),
      { category: 'metadata' },
    );
  });

  it('model localized true→false and draftAndPublish true→false are destructive conversions', () => {
    const before = base();
    expectClass(only(before, { ...before, localized: true }), { category: 'additive' });
    expectClass(only({ ...before, localized: true }, before), {
      category: 'conversion',
      destructive: true,
      prerequisites: ['convert'],
    });
    expectClass(only(before, { ...before, draftAndPublish: false }), {
      category: 'conversion',
      destructive: true,
      prerequisites: ['convert'],
    });
    expectClass(only({ ...before, draftAndPublish: false }, before), { category: 'additive' });
  });

  it('collection→singleton validates (at most one entry); singleton→collection is a contract change', () => {
    const before = base();
    expectClass(only(before, { ...before, kind: 'singleton' }), {
      category: 'validation',
      breaking: true,
      prerequisites: ['validateValues'],
    });
    expectClass(only({ ...before, kind: 'singleton' }, before), { category: 'contract', breaking: true });
  });

  it('hiding a field (public false, deprecated) is a breaking metadata change', () => {
    const before = base();
    expectClass(
      only(
        before,
        editField(before, (f) => ({ ...f, public: false })),
      ),
      { category: 'metadata', breaking: true },
    );
    expectClass(
      only(
        before,
        editField(before, (f) => ({ ...f, deprecated: true })),
      ),
      { category: 'metadata', breaking: true },
    );
    const hidden = base({ public: false });
    expectClass(
      only(
        hidden,
        editField(hidden, (f) => ({ ...f, public: true })),
      ),
      { category: 'metadata' },
    );
  });

  it('reordering fields and changing defaults are metadata', () => {
    const before = model({
      id: id(1),
      fields: [field({ apiKey: 'a', id: id(10) }), field({ apiKey: 'b', id: id(11) })],
    });
    expectClass(only(before, { ...before, fields: [...before.fields].reverse() }), { category: 'metadata' });
    expectClass(
      only(
        before,
        withField(before, id(10), (f) => ({ ...f, defaultValue: 'x' })),
      ),
      { category: 'metadata' },
    );
  });
});

describe('classifyChange: validation settings', () => {
  const setting = (type: FieldInput['type'], from: Record<string, unknown>, to: Record<string, unknown>) => {
    const before = base({ type, settings: settings(from) });
    return only(
      before,
      editField(before, (f) => ({ ...f, settings: { ...f.settings, ...to } }) as FieldDefinition),
    );
  };

  it.each([
    ['maxLength lowered', 'string', { maxLength: 100 }, { maxLength: 50 }, true],
    ['maxLength raised', 'string', { maxLength: 50 }, { maxLength: 100 }, false],
    ['maxLength added', 'string', {}, { maxLength: 100 }, true],
    ['minLength raised', 'string', { minLength: 1 }, { minLength: 3 }, true],
    ['min raised', 'number', { min: 0 }, { min: 1 }, true],
    ['max raised', 'number', { max: 1 }, { max: 2 }, false],
    ['decimal max lowered', 'decimal', { max: '10.5' }, { max: '9.99' }, true],
    [
      'biginteger min raised beyond 2^53',
      'biginteger',
      { min: '9007199254740992' },
      { min: '9007199254740993' },
      true,
    ],
    ['date min moved later', 'date', { min: '2026-01-01' }, { min: '2026-02-01' }, true],
    ['pattern added', 'string', {}, { pattern: '^a' }, true],
    ['precision lowered', 'decimal', { precision: 10 }, { precision: 5 }, true],
  ] as const)('%s', (_name, type, from, to, tightened) => {
    expectClass(
      setting(type, from, to),
      tightened ? { category: 'validation', prerequisites: ['validateValues'] } : { category: 'additive' },
    );
  });

  it('removing an enum value validates; adding or relabelling is additive', () => {
    const values = [
      { value: 'a', label: 'A' },
      { value: 'b', label: 'B' },
    ];
    expectClass(setting('enum', { values }, { values: [values[0]] }), {
      category: 'validation',
      prerequisites: ['validateValues'],
    });
    expectClass(setting('enum', { values }, { values: [...values, { value: 'c', label: 'C' }] }), {
      category: 'additive',
    });
    expectClass(setting('enum', { values }, { values: [{ value: 'a', label: 'Alpha' }, values[1]] }), {
      category: 'additive',
    });
  });

  it('narrowing allowed media kinds or dynamic-zone components validates', () => {
    expectClass(setting('media', {}, { allowedKinds: ['image'] }), {
      category: 'validation',
      prerequisites: ['validateValues'],
    });
    expectClass(setting('media', { allowedKinds: ['image'] }, { allowedKinds: ['image', 'video'] }), {
      category: 'additive',
    });
    const hero = component({ id: id(40) });
    const cta = component({ id: id(41), apiKey: 'cta' });
    expectClass(setting('dynamiczone', { components: [hero.id, cta.id] }, { components: [hero.id] }), {
      category: 'validation',
      prerequisites: ['validateValues'],
    });
  });

  it('cardinality, multiplicity and repeatability changes are conversions; to-single is destructive', () => {
    expectClass(setting('relation', { target: id(50), cardinality: 'one' }, { cardinality: 'many' }), {
      category: 'conversion',
      breaking: true,
      prerequisites: ['convert', 'validateValues'],
    });
    expectClass(setting('media', { multiple: true }, { multiple: false }), {
      category: 'conversion',
      breaking: true,
      destructive: true,
      prerequisites: ['convert', 'validateValues'],
    });
    expectClass(setting('component', { component: id(51) }, { repeatable: true }), {
      category: 'conversion',
      breaking: true,
      prerequisites: ['convert', 'validateValues'],
    });
  });

  it('retargeting a relation or component clears values (destructive conversion)', () => {
    expectClass(setting('relation', { target: id(50), cardinality: 'one' }, { target: id(52) }), {
      category: 'conversion',
      breaking: true,
      destructive: true,
      prerequisites: ['convert'],
    });
  });

  it('changing the slug source is metadata', () => {
    expectClass(setting('slug', {}, { sourceFieldId: id(60) }), { category: 'metadata' });
  });
});

describe('classifyChange: code fields', () => {
  const EDITORS: Partial<Record<FieldInput['type'], string>> = {
    code: 'codeEditor',
    text: 'textarea',
    string: 'textInput',
    richtext: 'richText',
    number: 'numberInput',
  };
  /** The type change alone (a type change also swaps the editor, which is a separate editorSwap). */
  const retype = (
    from: FieldInput['type'],
    to: FieldInput['type'],
    fromSettings: Record<string, unknown> = {},
    toSettings: Record<string, unknown> = {},
  ) => {
    const before = base({ type: from, settings: settings(fromSettings) });
    const after = editField(
      before,
      (f) =>
        ({
          ...f,
          type: to,
          settings: toSettings,
          editor: { id: EDITORS[to] ?? f.editor.id, options: {} },
        }) as FieldDefinition,
    );
    const change = classify(before, after).find((found) => found.kind === 'field.type');
    expect(change).toBeDefined();
    return change as ClassifiedChange;
  };

  it('text or string to code keeps the stored string but is breaking: code fields have no filters', () => {
    expectClass(retype('text', 'code', {}, { language: 'html' }), { category: 'additive', breaking: true });
    expectClass(retype('string', 'code', { pattern: '^a' }, { language: 'plain' }), {
      category: 'additive',
      breaking: true,
    });
  });

  it('code to text or string is not breaking', () => {
    expectClass(retype('code', 'text', { language: 'html' }), { category: 'additive' });
    expectClass(retype('code', 'string', { language: 'json', validate: true }), { category: 'additive' });
  });

  it('constraints on the target re-validate existing values instead of widening', () => {
    const validates = { category: 'validation' as const, prerequisites: ['validateValues' as const] };
    expectClass(retype('text', 'code', {}, { language: 'plain', maxLength: 100 }), {
      ...validates,
      breaking: true,
    });
    expectClass(retype('text', 'code', {}, { language: 'json', validate: true }), {
      ...validates,
      breaking: true,
    });
    expectClass(retype('code', 'text', { language: 'html' }, { minLength: 3 }), validates);
  });

  it('rich text and code do not convert into each other; neither does a number into code', () => {
    expectClass(retype('code', 'richtext', { language: 'html' }, { formatVersion: 1 }), {
      category: 'conversion',
      breaking: true,
      supported: false,
    });
    expectClass(retype('richtext', 'code', { formatVersion: 1 }, { language: 'html' }), {
      category: 'conversion',
      breaking: true,
      supported: false,
    });
    expectClass(retype('number', 'code', {}, { language: 'plain' }), {
      category: 'conversion',
      breaking: true,
      supported: false,
    });
  });

  const setting = (from: Record<string, unknown>, to: Record<string, unknown>) => {
    const before = base({ type: 'code', settings: settings(from) });
    return only(
      before,
      editField(before, (f) => ({ ...f, settings: { ...f.settings, ...to } }) as FieldDefinition),
    );
  };

  it('a language change is metadata', () => {
    expectClass(setting({ language: 'html' }, { language: 'css' }), { category: 'metadata' });
  });

  it('turning JSON validation on validates existing values; turning it off is metadata', () => {
    expectClass(setting({ language: 'json' }, { validate: true }), {
      category: 'validation',
      prerequisites: ['validateValues'],
    });
    expectClass(setting({ language: 'json', validate: true }, { validate: false }), { category: 'metadata' });
  });
});

describe('summarizeChanges', () => {
  it('orders prerequisites and reports breaking/destructive/metadata-only', () => {
    const before = base();
    const after = editField(before, (f) => ({
      ...f,
      apiKey: 'headline',
      required: true,
      filterable: true,
      unique: true,
    }));
    const summary = summarizeChanges(classify(before, after));
    expect(summary).toEqual({
      breaking: true,
      destructive: false,
      supported: true,
      prerequisites: ['validateRequired', 'checkUnique', 'buildIndex'],
      cleanup: [],
      metadataOnly: false,
    });
    const labelOnly = summarizeChanges(
      classify(
        before,
        editField(before, (f) => ({ ...f, label: 'x' })),
      ),
    );
    expect(labelOnly.metadataOnly).toBe(true);
  });
});

describe('classifyLocaleChange', () => {
  it.each([
    ['locale.added', 'additive', false, false],
    ['locale.removed', 'removal', true, true],
    ['locale.defaultChanged', 'contract', true, false],
    ['locale.metadata', 'metadata', false, false],
  ] as const)('%s → %s', (kind, category, breaking, destructive) => {
    expect(classifyLocaleChange(kind, 'fr')).toEqual({ kind, code: 'fr', category, breaking, destructive });
  });
});
