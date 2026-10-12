import { normalizeDefinition, type ComponentDefinition, type ModelDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import type { ContentModel } from '../model.js';
import { projectData, RICH_TEXT_HTML, selectFields, type DeliveredRichText } from './select.js';
import type { RichTextMode } from './types.js';

const ids = {
  body: '1a1a1a1a-1111-4111-8111-111111111111',
  count: '2b2b2b2b-2222-4222-8222-222222222222',
  title: '3c3c3c3c-3333-4333-8333-333333333333',
  tags: '4d4d4d4d-4444-4444-8444-444444444444',
  live: '5e5e5e5e-5555-4555-8555-555555555555',
};

const definition = normalizeDefinition({
  id: '0b5d6f3e-2d55-4f6c-9b1a-5d2c8e9f1a01',
  kind: 'collection',
  apiKey: 'article',
  label: 'Article',
  fields: [
    { id: ids.body, apiKey: 'body', label: 'Body', type: 'richtext' },
    { id: ids.count, apiKey: 'count', label: 'Count', type: 'integer' },
    { id: ids.title, apiKey: 'title', label: 'Title', type: 'string' },
    {
      id: ids.tags,
      apiKey: 'tags',
      label: 'Tags',
      type: 'enum',
      settings: { values: [{ value: 'a', label: 'A' }], multiple: true },
    },
    { id: ids.live, apiKey: 'live', label: 'Live', type: 'boolean' },
  ],
}) as ModelDefinition;

const model: ContentModel = { definition, version: 1, revisionId: 'r', components: new Map() };

const project = (data: Record<string, unknown>, richText: RichTextMode | null = 'both') =>
  projectData(data, {
    model,
    fields: selectFields(model, { mode: 'all' }, null),
    visibleTargets: null,
    populated: new Map(),
    ...(richText ? { richText } : {}),
    mediaAssets: null,
    publicComponentFieldsOnly: false,
  });

const richDoc = {
  format: 'shapio-richtext',
  version: 1,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] },
};

describe('projectData', () => {
  it('emits values written under an older field type as empty, never as the new type', () => {
    // A snapshot from before `body` became rich text (it was text) and `count` became an integer.
    expect(
      project({
        [ids.body]: 'plain old text',
        [ids.count]: '12',
        [ids.title]: 42,
        [ids.tags]: 'a',
        [ids.live]: 'yes',
      }),
    ).toEqual({ body: null, count: null, title: null, tags: null, live: null });
  });

  it('passes values that match the current type through', () => {
    const doc = {
      version: 1,
      doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }] },
    };
    const projected = project({
      [ids.body]: doc,
      [ids.count]: 12,
      [ids.title]: 'T',
      [ids.tags]: ['a'],
      [ids.live]: false,
    });
    expect(projected).toMatchObject({
      count: 12,
      title: 'T',
      tags: ['a'],
      live: false,
      body: { version: 1 },
    });
    expect((projected.body as { html: string }).html).toContain('Hi');
  });

  describe('rich text by mode', () => {
    it('returns the stored document with json, carrying the renderer only behind a symbol', () => {
      const body = project({ [ids.body]: richDoc }, 'json').body as DeliveredRichText;
      expect(JSON.parse(JSON.stringify(body))).toEqual(richDoc);
      expect(body[RICH_TEXT_HTML]?.()).toBe('<p>Hi</p>');
    });

    it('returns the envelope and HTML without the document with html', () => {
      const body = project({ [ids.body]: richDoc }, 'html').body;
      expect(JSON.parse(JSON.stringify(body))).toEqual({
        format: 'shapio-richtext',
        version: 1,
        html: '<p>Hi</p>',
      });
    });

    it('returns the document and HTML with both', () => {
      const body = project({ [ids.body]: richDoc }, 'both').body;
      expect(JSON.parse(JSON.stringify(body))).toEqual({ ...richDoc, html: '<p>Hi</p>' });
    });

    it('leaves the stored value untouched without a mode (admin reads, hooks)', () => {
      const body = project({ [ids.body]: richDoc }, null).body;
      expect(body).toBe(richDoc);
    });
  });

  describe('component fields', () => {
    const c = {
      box: 'a0a0a0a0-0000-4000-8000-000000000001',
      open: 'a0a0a0a0-0000-4000-8000-000000000002',
      secret: 'a0a0a0a0-0000-4000-8000-000000000003',
      address: 'a0a0a0a0-0000-4000-8000-000000000004',
      city: 'a0a0a0a0-0000-4000-8000-000000000005',
      hidden: 'a0a0a0a0-0000-4000-8000-000000000006',
      inner: 'a0a0a0a0-0000-4000-8000-000000000007',
      addr: 'a0a0a0a0-0000-4000-8000-000000000008',
      addrs: 'a0a0a0a0-0000-4000-8000-000000000009',
      zone: 'a0a0a0a0-0000-4000-8000-00000000000a',
    };
    const box = normalizeDefinition({
      id: c.box,
      kind: 'component',
      apiKey: 'box',
      label: 'Box',
      fields: [
        { id: c.open, apiKey: 'open', label: 'Open', type: 'string' },
        { id: c.secret, apiKey: 'secret', label: 'Secret', type: 'string', public: false },
      ],
    }) as ComponentDefinition;
    const address = normalizeDefinition({
      id: c.address,
      kind: 'component',
      apiKey: 'address',
      label: 'Address',
      fields: [
        { id: c.city, apiKey: 'city', label: 'City', type: 'string' },
        { id: c.hidden, apiKey: 'hidden', label: 'Hidden', type: 'string', public: false },
        { id: c.inner, apiKey: 'inner', label: 'Inner', type: 'component', settings: { component: c.box } },
      ],
    }) as ComponentDefinition;
    const thing = normalizeDefinition({
      id: '0b5d6f3e-2d55-4f6c-9b1a-5d2c8e9f1a02',
      kind: 'collection',
      apiKey: 'thing',
      label: 'Thing',
      fields: [
        { id: c.addr, apiKey: 'addr', label: 'Addr', type: 'component', settings: { component: c.address } },
        {
          id: c.addrs,
          apiKey: 'addrs',
          label: 'Addrs',
          type: 'component',
          settings: { component: c.address, repeatable: true },
        },
        {
          id: c.zone,
          apiKey: 'zone',
          label: 'Zone',
          type: 'dynamiczone',
          settings: { components: [c.address] },
        },
      ],
    }) as ModelDefinition;
    const thingModel: ContentModel = {
      definition: thing,
      version: 1,
      revisionId: 'r',
      components: new Map([
        [c.box, { definition: box, version: 1 }],
        [c.address, { definition: address, version: 1 }],
      ]),
    };
    const stored = { [c.city]: 'Paris', [c.hidden]: 'h1', [c.inner]: { [c.open]: 'o', [c.secret]: 's' } };
    const data = {
      [c.addr]: stored,
      [c.addrs]: [stored],
      [c.zone]: [{ __component: c.address, ...stored }],
    };
    const projectThing = (publicComponentFieldsOnly: boolean) =>
      projectData(data, {
        model: thingModel,
        fields: selectFields(thingModel, { mode: 'all' }, null),
        visibleTargets: null,
        populated: new Map(),
        mediaAssets: null,
        publicComponentFieldsOnly,
      });

    it('leaves out non-public fields of single, repeatable and dynamic-zone components at any depth', () => {
      const shown = { city: 'Paris', inner: { open: 'o' } };
      expect(projectThing(true)).toEqual({
        addr: shown,
        addrs: [shown],
        zone: [{ __component: 'address', ...shown }],
      });
    });

    it('keeps every field when not limited to public ones (admin reads)', () => {
      const all = { city: 'Paris', hidden: 'h1', inner: { open: 'o', secret: 's' } };
      expect(projectThing(false)).toEqual({
        addr: all,
        addrs: [all],
        zone: [{ __component: 'address', ...all }],
      });
    });
  });
});
