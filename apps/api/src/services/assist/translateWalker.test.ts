import type { FieldDefinition } from '@shapio/schema';
import { describe, expect, it } from 'vitest';
import type { ContentModel } from '../../content/model.js';
import { applyTranslations, collectTextLeaves } from './translateWalker.js';

const field = (id: string, type: string, settings: Record<string, unknown> = {}) =>
  ({
    id,
    apiKey: id,
    label: id,
    type,
    settings,
    localized: true,
    deprecated: false,
  }) as unknown as FieldDefinition;

const card = {
  id: 'card',
  kind: 'component',
  apiKey: 'card',
  label: 'Card',
  fields: [field('heading', 'string'), field('count', 'integer')],
};
const model = {
  definition: { id: 'm', apiKey: 'page', label: 'Page', localized: true, fields: [] },
  components: new Map([['card', { definition: card, version: 1 }]]),
} as unknown as ContentModel;

const fields = [
  field('title', 'string', { maxLength: 60 }),
  field('slug', 'slug'),
  field('body', 'richtext'),
  field('cards', 'component', { component: 'card', repeatable: true }),
  field('zone', 'dynamiczone', { components: ['card'] }),
];

const data = {
  title: 'Hello',
  slug: 'hello',
  body: {
    format: 'shapio-richtext',
    version: 1,
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read ' },
            { type: 'text', text: 'this', marks: [{ type: 'link', attrs: { href: 'https://x.test' } }] },
            { type: 'hardBreak' },
            { type: 'text', text: 'now' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Item' }] }] },
          ],
        },
        { type: 'paragraph' },
      ],
    },
  },
  cards: [{ heading: 'Card one', count: 2 }],
  zone: [{ __component: 'card', heading: 'Zone card', count: 1 }],
};

describe('translate walker', () => {
  it('collects text leaves in order with paths and limits, encoding marks and breaks', () => {
    expect(collectTextLeaves(model, fields, data)).toEqual([
      { path: '/title', text: 'Hello', kind: 'plain', maxLength: 60 },
      { path: '/body', text: 'Read <m1>this</m1><b2/>now', kind: 'block' },
      { path: '/body', text: 'Item', kind: 'block' },
      { path: '/cards/0/heading', text: 'Card one', kind: 'plain' },
      { path: '/zone/0/heading', text: 'Zone card', kind: 'plain' },
    ]);
  });

  it('rebuilds the document with translations, restoring marks and copying everything else', () => {
    const { data: translated, issues } = applyTranslations(model, fields, data, [
      'Bonjour',
      'Lisez <m1>ceci</m1><b2/>maintenant',
      'Élément',
      'Carte un',
      'Carte de zone',
    ]);
    expect(issues).toEqual([]);
    expect(translated.title).toBe('Bonjour');
    expect(translated.slug).toBe('hello');
    expect(translated.cards).toEqual([{ heading: 'Carte un', count: 2 }]);
    expect(translated.zone).toEqual([{ __component: 'card', heading: 'Carte de zone', count: 1 }]);
    const body = translated.body as typeof data.body;
    expect(body.doc.content[0]?.content).toEqual([
      { type: 'text', text: 'Lisez ' },
      { type: 'text', text: 'ceci', marks: [{ type: 'link', attrs: { href: 'https://x.test' } }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'maintenant' },
    ]);
    // The source document is untouched.
    expect(data.title).toBe('Hello');
  });

  it('falls back to plain text when the tags do not survive, and says so', () => {
    const { data: translated, issues } = applyTranslations(model, fields, data, [
      'Bonjour',
      'Lisez ceci <m7>maintenant</m7>',
      'Élément',
      'Carte un',
      'Carte de zone',
    ]);
    expect(issues).toEqual([expect.objectContaining({ path: '/body', code: 'FORMATTING_LOST' })]);
    const body = translated.body as typeof data.body;
    expect(body.doc.content[0]?.content).toEqual([{ type: 'text', text: 'Lisez ceci maintenant' }]);
  });

  it('never offers a code field for translation, and copies its value untouched', () => {
    const snippet = '<script async src="https://embed.test/widget.js"></script>\n<p>Hello</p>';
    const codeFields = [field('title', 'string'), field('embed', 'code', { language: 'html' })];
    const source = { title: 'Hello', embed: snippet };
    expect(collectTextLeaves(model, codeFields, source)).toEqual([
      { path: '/title', text: 'Hello', kind: 'plain' },
    ]);
    const { data: translated } = applyTranslations(model, codeFields, source, ['Bonjour']);
    expect(translated).toEqual({ title: 'Bonjour', embed: snippet });
  });
});
