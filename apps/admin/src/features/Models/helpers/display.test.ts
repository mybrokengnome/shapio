import type { FieldDefinition, ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import {
  documentLayoutChoices,
  documentPlacementOf,
  titleFieldCandidates,
  withAddedField,
  withDocumentPlacement,
} from './display';
import { createField, withSetting } from './draft';

describe('titleFieldCandidates', () => {
  it('offers text-like fields only', () => {
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
    const title = createField(model, { type: 'string', label: 'Title', apiKey: 'title' });
    const flag = createField(model, { type: 'boolean', label: 'Featured', apiKey: 'featured' });
    const body = createField(model, { type: 'richtext', label: 'Body', apiKey: 'body' });
    expect(titleFieldCandidates({ ...model, fields: [title, flag, body] })).toEqual([title]);
  });
});

describe('withAddedField', () => {
  const model: ModelDefinition = {
    id: '00000000-0000-4000-8000-000000000002',
    kind: 'collection',
    apiKey: 'page',
    label: 'Page',
    localized: false,
    draftAndPublish: true,
    fields: [],
    display: {},
  };

  it('makes the first text-like field the title field', () => {
    const flag = createField(model, { type: 'boolean', label: 'Featured', apiKey: 'featured' });
    const withFlag = withAddedField(model, flag);
    expect(withFlag.display.titleFieldId).toBeUndefined();
    const title = createField(withFlag, { type: 'string', label: 'Title', apiKey: 'title' });
    const withTitle = withAddedField(withFlag, title);
    expect(withTitle.fields).toEqual([flag, title]);
    expect(withTitle.display.titleFieldId).toBe(title.id);
  });

  it('keeps a title field that is already set', () => {
    const title = createField(model, { type: 'string', label: 'Title', apiKey: 'title' });
    const withTitle = withAddedField(model, title);
    const slug = createField(withTitle, { type: 'slug', label: 'Slug', apiKey: 'slug' });
    expect(withAddedField(withTitle, slug).display.titleFieldId).toBe(title.id);
  });

  it('leaves the title field unset when it was cleared next to existing candidates', () => {
    const title = createField(model, { type: 'string', label: 'Title', apiKey: 'title' });
    const cleared = { ...model, fields: [title] };
    const subtitle = createField(cleared, { type: 'string', label: 'Subtitle', apiKey: 'subtitle' });
    expect(withAddedField(cleared, subtitle).display.titleFieldId).toBeUndefined();
  });
});

describe('documentLayoutChoices', () => {
  const base: ModelDefinition = {
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'collection',
    apiKey: 'article',
    label: 'Article',
    localized: false,
    draftAndPublish: true,
    fields: [],
    display: {},
  };
  const title = createField(base, { type: 'string', label: 'Title', apiKey: 'title' });
  const cover = createField(base, { type: 'media', label: 'Cover', apiKey: 'cover' });
  const body = createField(base, { type: 'richtext', label: 'Body', apiKey: 'body' });
  const notes = createField(base, { type: 'richtext', label: 'Notes', apiKey: 'notes' });
  const gallery = withSetting(
    createField(base, { type: 'media', label: 'Gallery', apiKey: 'gallery' }),
    'multiple',
    true,
  );
  const model = { ...base, fields: [title, cover, body, notes, gallery] };

  it('shows the default canvas and offers single image fields as the cover', () => {
    const choices = documentLayoutChoices(model);
    expect(choices.coverOptions.map((field) => field.apiKey)).toEqual(['cover']);
    expect(choices.canvas).toEqual([body.id, notes.id, gallery.id]);
    expect(choices.stripOptions).toEqual([]);
  });

  it('lists the configured canvas first, in its order, then the other eligible fields', () => {
    const choices = documentLayoutChoices({ ...model, display: { canvasFieldIds: [gallery.id, body.id] } });
    expect(choices.canvasOptions.map((field) => field.apiKey)).toEqual(['gallery', 'body', 'notes']);
    expect(choices.stripOptions.map((field) => field.apiKey)).toEqual(['notes']);
  });
});

describe('document placement', () => {
  const base: ModelDefinition = {
    id: '00000000-0000-4000-8000-000000000003',
    kind: 'collection',
    apiKey: 'post',
    label: 'Post',
    localized: false,
    draftAndPublish: true,
    fields: [],
    display: {},
  };
  const title = createField(base, { type: 'string', label: 'Title', apiKey: 'title' });
  const excerpt = createField(base, { type: 'text', label: 'Excerpt', apiKey: 'excerpt' });
  const cover = createField(base, { type: 'media', label: 'Cover', apiKey: 'cover' });
  const body = createField(base, { type: 'richtext', label: 'Body', apiKey: 'body' });
  const seo = withSetting(
    createField(base, { type: 'component', label: 'SEO', apiKey: 'seo' }),
    'component',
    '00000000-0000-4000-8000-0000000005e0',
  );
  const model = { ...base, fields: [title, excerpt, cover, body, seo] };
  const ids = (definition: ModelDefinition) => definition.display.canvasFieldIds;
  const placement = (definition: ModelDefinition, field: FieldDefinition) =>
    documentPlacementOf(definition, field);

  it('reads the automatic layout and locks the title and the last document field', () => {
    expect(placement(model, body)).toEqual({ inDocument: true, lock: 'last' });
    expect(placement(model, excerpt)).toEqual({ inDocument: false, lock: undefined });
    expect(placement(model, title)).toEqual({ inDocument: false, lock: 'title' });
    expect(placement(model, cover)).toEqual({ inDocument: false, lock: undefined });
    expect(placement({ ...model, display: { coverFieldId: cover.id } }, cover).lock).toBe('cover');
  });

  it('turns the automatic layout into a list and inserts by field order', () => {
    const withExcerpt = withDocumentPlacement(model, excerpt.id, true);
    expect(ids(withExcerpt)).toEqual([excerpt.id, body.id]);
    const withSeo = withDocumentPlacement(withExcerpt, seo.id, true);
    expect(ids(withSeo)).toEqual([excerpt.id, body.id, seo.id]);
    expect(placement(withSeo, body)).toEqual({ inDocument: true, lock: undefined });
    expect(ids(withDocumentPlacement(withSeo, body.id, false))).toEqual([excerpt.id, seo.id]);
  });

  it('takes a field out of the strip when it goes in the document', () => {
    const stripped = { ...model, display: { stripFieldIds: [excerpt.id, cover.id] } };
    expect(withDocumentPlacement(stripped, excerpt.id, true).display.stripFieldIds).toEqual([cover.id]);
  });

  it('adds a new block field to a configured list only', () => {
    const notes = createField(model, { type: 'richtext', label: 'Notes', apiKey: 'notes' });
    const flag = createField(model, { type: 'boolean', label: 'Featured', apiKey: 'featured' });
    expect(ids(withAddedField(model, notes) as ModelDefinition)).toBeUndefined();
    const configured = withDocumentPlacement(model, excerpt.id, true);
    expect(ids(withAddedField(configured, notes) as ModelDefinition)).toEqual([
      excerpt.id,
      body.id,
      notes.id,
    ]);
    expect(ids(withAddedField(configured, flag) as ModelDefinition)).toEqual([excerpt.id, body.id]);
  });
});
