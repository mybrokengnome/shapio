import { isStableId, type ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import {
  createField,
  isDraftDirty,
  moveItem,
  pruneLayout,
  removeField,
  withCompatibleEditor,
  withSetting,
} from './draft';

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

describe('createField', () => {
  it('creates a public, optional field with the default editor and normalized settings', () => {
    const field = createField(model, { type: 'richtext', label: 'Body', apiKey: 'body' });
    expect(isStableId(field.id)).toBe(true);
    expect(field).toMatchObject({
      apiKey: 'body',
      label: 'Body',
      type: 'richtext',
      required: false,
      public: true,
      localized: false,
      settings: { formatVersion: 1 },
      editor: { id: 'richText', options: {} },
    });
  });

  it('starts relations with one-to-one cardinality and no target', () => {
    const field = createField(model, { type: 'relation', label: 'Author', apiKey: 'author' });
    expect(field.settings).toEqual({ target: '', cardinality: 'one' });
  });
});

describe('isDraftDirty', () => {
  it('ignores differences normalization removes', () => {
    expect(isDraftDirty({ ...model, description: '' }, model)).toBe(false);
    expect(isDraftDirty({ ...model, label: 'Post' }, model)).toBe(true);
  });

  it('sees removed settings', () => {
    const field = createField(model, { type: 'string', label: 'Title', apiKey: 'title' });
    const base = { ...model, fields: [withSetting(field, 'maxLength', 80)] };
    const draft = { ...model, fields: [withSetting(base.fields[0] ?? field, 'maxLength', undefined)] };
    expect(isDraftDirty(draft, base)).toBe(true);
    expect(draft.fields[0]?.settings).toEqual({});
  });
});

describe('moveItem', () => {
  it('moves items and ignores out-of-range moves', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(moveItem(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});

describe('removeField', () => {
  it('drops the field and the display references to it', () => {
    const title = createField(model, { type: 'string', label: 'Title', apiKey: 'title' });
    const slug = withSetting(
      createField(model, { type: 'slug', label: 'Slug', apiKey: 'slug' }),
      'sourceFieldId',
      title.id,
    );
    const definition: ModelDefinition = {
      ...model,
      fields: [title, slug],
      display: {
        titleFieldId: title.id,
        listFieldIds: [title.id, slug.id],
        defaultSort: { fieldId: title.id, direction: 'asc' },
      },
    };
    const next = removeField(definition, title.id) as ModelDefinition;
    expect(next.fields.map((field) => field.apiKey)).toEqual(['slug']);
    expect(next.fields[0]?.settings).toEqual({});
    expect(next.display).toEqual({ listFieldIds: [slug.id] });
  });
});

describe('withCompatibleEditor', () => {
  it('replaces an editor that cannot edit the field any more', () => {
    const field = createField(model, { type: 'enum', label: 'Tags', apiKey: 'tags' });
    const radio = { ...field, editor: { id: 'radio', options: { layout: 'horizontal' } } };
    expect(withCompatibleEditor(radio).editor).toEqual(radio.editor);
    const multiple = withSetting(radio, 'multiple', true);
    expect(withCompatibleEditor(multiple).editor).toEqual({ id: 'select', options: {} });
  });
});

describe('pruneLayout', () => {
  const body = createField(model, { type: 'richtext', label: 'Body', apiKey: 'body' });
  const cover = createField(model, { type: 'media', label: 'Cover', apiKey: 'cover' });
  const gallery = withSetting(
    createField(model, { type: 'media', label: 'Gallery', apiKey: 'gallery' }),
    'multiple',
    true,
  );
  const title = createField(model, { type: 'string', label: 'Title', apiKey: 'title' });
  const definition: ModelDefinition = {
    ...model,
    fields: [title, body, cover, gallery],
    display: {
      canvasFieldIds: [body.id, gallery.id],
      coverFieldId: cover.id,
      stripFieldIds: [title.id],
    },
  };

  it('keeps references that are still eligible', () => {
    expect(pruneLayout(definition)).toEqual(definition);
  });

  it('drops a field from the canvas when it stops being eligible', () => {
    const changed = {
      ...definition,
      fields: definition.fields.map((field) =>
        field.id === gallery.id ? withSetting(field, 'multiple', false) : field,
      ),
    };
    expect((pruneLayout(changed) as ModelDefinition).display.canvasFieldIds).toEqual([body.id]);
  });

  it('drops a cover that changed type', () => {
    const changed = {
      ...definition,
      fields: definition.fields.map((field) => (field.id === cover.id ? { ...title, id: cover.id } : field)),
    };
    expect((pruneLayout(changed) as ModelDefinition).display).not.toHaveProperty('coverFieldId');
  });

  it('runs on field removal', () => {
    const next = removeField(definition, body.id) as ModelDefinition;
    expect(next.display.canvasFieldIds).toEqual([gallery.id]);
    expect(removeField(definition, title.id).display).toMatchObject({ stripFieldIds: [] });
    expect(removeField(definition, cover.id).display).not.toHaveProperty('coverFieldId');
  });
});
