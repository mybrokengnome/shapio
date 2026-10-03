import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ImportSource, SourceValue, ValueResolver } from '../types.js';
import { wordpressDate, wordpressSource } from './adapter.js';
import { readWxr } from './wxr.js';

const FIXTURE = fileURLToPath(new URL('../../../test/fixtures/wxr/blog.xml', import.meta.url));

const entryOf = (source: ImportSource, sourceId: string) => {
  const entry = source.entries.find((candidate) => candidate.sourceId === sourceId);
  if (!entry) {
    throw new Error(`no entry ${sourceId}`);
  }
  return entry;
};

const fieldsOf = (source: ImportSource, sourceId: string) => entryOf(source, sourceId).locales[0]!.fields;

const resolver: ValueResolver = {
  media: (sourceId) => (sourceId === 'attachment:10' ? '9c9c9c9c-9999-4999-8999-999999999999' : undefined),
  entry: () => undefined,
};

const convert = (value: SourceValue | undefined) => {
  if (value?.kind !== 'richtext') {
    throw new Error('not rich text');
  }
  return value.convert(resolver);
};

describe('readWxr', () => {
  it('reads the channel, authors, terms and items, skipping comments', async () => {
    const document = await readWxr(FIXTURE);
    expect(document).toMatchObject({
      title: 'Field Notes',
      language: 'en-US',
      baseSiteUrl: 'http://blog.test',
    });
    expect(document.authors).toEqual([
      {
        id: '1',
        login: 'ada',
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
        firstName: 'Ada',
        lastName: 'Lovelace',
      },
    ]);
    expect(document.terms.map((term) => `${term.taxonomy}:${term.slug}<${term.parent}`)).toEqual([
      'category:engines<',
      'category:analytical<engines',
      'post_tag:history<',
    ]);
    const post = document.items.find((item) => item.id === '20');
    expect(post).toMatchObject({
      type: 'post',
      status: 'publish',
      slug: 'analytical-engine',
      creator: 'ada',
    });
    expect(post?.meta).toEqual({ _thumbnail_id: '10' });
    expect(post?.terms).toEqual([
      { taxonomy: 'category', slug: 'analytical', name: 'Analytical' },
      { taxonomy: 'post_tag', slug: 'history', name: 'History' },
      { taxonomy: 'post_tag', slug: 'looms', name: 'Looms' },
    ]);
    expect(document.items).toHaveLength(7);
  });

  it('refuses a file that is not WXR', async () => {
    await expect(readWxr(fileURLToPath(new URL('../../../package.json', import.meta.url)))).rejects.toThrow(
      /not a readable WordPress export/,
    );
  });
});

describe('wordpressSource', () => {
  it('plans author, category, tag, post and page models', async () => {
    const source = wordpressSource(await readWxr(FIXTURE));
    expect(source.definitions.map((definition) => definition.apiKey)).toEqual([
      'author',
      'category',
      'tag',
      'post',
      'page',
    ]);
    const post = source.definitions.find((definition) => definition.key === 'post');
    expect(post?.fields.map((field) => `${field.apiKey}:${field.type}`)).toEqual([
      'title:string',
      'slug:slug',
      'body:richtext',
      'excerpt:text',
      'date:datetime',
      'cover:media',
      'author:relation',
      'categories:relation',
      'tags:relation',
    ]);
    expect(source.definitions.find((definition) => definition.key === 'author')?.fields[2]).toMatchObject({
      apiKey: 'email',
      public: false,
    });
  });

  it('maps posts with their references, published state and dates', async () => {
    const source = wordpressSource(await readWxr(FIXTURE));
    const post = entryOf(source, 'post:20');
    expect(post.locales[0]?.published).toBe(true);
    expect(post.locales[0]?.fields).toMatchObject({
      title: { kind: 'scalar', value: 'On the Analytical Engine' },
      slug: { kind: 'scalar', value: 'analytical-engine' },
      date: { kind: 'scalar', value: '2024-05-02T09:30:00.000Z' },
      excerpt: { kind: 'scalar', value: 'Notes on the engine.' },
      cover: { kind: 'media', sourceIds: ['attachment:10'], many: false },
      author: { kind: 'entries', sourceIds: ['author:ada'], many: false },
      categories: { kind: 'entries', sourceIds: ['category:analytical'], many: true },
      tags: { kind: 'entries', sourceIds: ['tag:history', 'tag:looms'], many: true },
    });
    const draft = entryOf(source, 'post:21');
    expect(draft.locales[0]?.published).toBe(false);
    expect(draft.locales[0]?.fields.slug).toEqual({ kind: 'scalar', value: 'draft-notes' });
    expect(draft.locales[0]?.fields.date).toBeUndefined();
    expect(fieldsOf(source, 'page:31').parent).toEqual({
      kind: 'entries',
      sourceIds: ['page:30'],
      many: false,
    });
    expect(fieldsOf(source, 'category:analytical').parent).toEqual({
      kind: 'entries',
      sourceIds: ['category:engines'],
      many: false,
    });
    expect(fieldsOf(source, 'tag:looms').name).toEqual({ kind: 'scalar', value: 'Looms' });
  });

  it('converts bodies with paragraphs, captions and resolved images', async () => {
    const source = wordpressSource(await readWxr(FIXTURE));
    const { document, warnings } = convert(fieldsOf(source, 'post:20').body);
    expect(document.doc.content?.map((node) => node.type)).toEqual([
      'paragraph',
      'image',
      'paragraph',
      'paragraph',
      'paragraph',
    ]);
    expect(document.doc.content?.[0]?.content?.map((node) => node.type)).toEqual([
      'text',
      'text',
      'text',
      'hardBreak',
      'text',
    ]);
    expect(document.doc.content?.[1]?.attrs).toEqual({
      mediaId: '9c9c9c9c-9999-4999-8999-999999999999',
      alt: 'Engine',
      title: null,
    });
    expect(warnings).toEqual([
      { code: 'shortcodeKept', detail: '[gallery]' },
      { code: 'imageUnresolved', detail: 'https://cdn.example.org/diagram.png' },
    ]);
    expect(convert(fieldsOf(source, 'post:21').body).document.doc.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Unfinished.' }] },
    ]);
  });

  it('imports attachments and images from other hosts as media', async () => {
    const source = wordpressSource(await readWxr(FIXTURE), { mediaDir: '/copy/uploads' });
    expect(source.media).toEqual([
      {
        sourceId: 'attachment:10',
        filename: 'engine.png',
        url: 'http://blog.test/wp-content/uploads/2024/05/engine.png',
        path: '/copy/uploads/2024/05/engine.png',
        alt: 'The difference engine',
        caption: 'The engine, drawn.',
      },
      {
        sourceId: 'url:https://cdn.example.org/diagram.png',
        filename: 'diagram.png',
        url: 'https://cdn.example.org/diagram.png',
        alt: 'Diagram',
      },
    ]);
  });

  it('lists what it skipped', async () => {
    const source = wordpressSource(await readWxr(FIXTURE));
    expect(source.notes).toEqual([
      'Skipped 1 posts with status "trash".',
      'Skipped 1 items of type "nav_menu_item" (only posts, pages and attachments are imported).',
    ]);
    expect(source.entries.some((entry) => entry.sourceId === 'post:40')).toBe(false);
  });
});

describe('wordpressDate', () => {
  it('prefers the GMT date and ignores the zero date', () => {
    expect(wordpressDate({ dateGmt: '2024-05-02 09:30:00', date: '2024-05-02 11:30:00' })).toBe(
      '2024-05-02T09:30:00.000Z',
    );
    expect(wordpressDate({ dateGmt: '0000-00-00 00:00:00', date: '2024-05-02 11:30:00' })).toBe(
      '2024-05-02T11:30:00.000Z',
    );
    expect(wordpressDate({ dateGmt: '0000-00-00 00:00:00', date: '0000-00-00 00:00:00' })).toBeUndefined();
  });
});
