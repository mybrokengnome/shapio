import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildStrapiExport } from '../../testing/strapiExport.js';
import { buildDefinitions } from '../planner.js';
import type { ImportSource, SourceValue, ValueResolver } from '../types.js';
import { strapiSource } from './adapter.js';
import { EncryptedExportError, extractStrapiExport } from './archive.js';
import { readStrapiExport, UnsupportedExportError } from './exportFiles.js';

const MEDIA_ID = '9c9c9c9c-9999-4999-8999-999999999999';
const resolver: ValueResolver = {
  media: (sourceId) => (sourceId === 'file:20' ? MEDIA_ID : undefined),
  entry: () => undefined,
};

const convert = (value: SourceValue | undefined) => {
  if (value?.kind !== 'richtext') {
    throw new Error('not rich text');
  }
  return value.convert(resolver);
};

const entryOf = (source: ImportSource, sourceId: string) => {
  const entry = source.entries.find((candidate) => candidate.sourceId === sourceId);
  if (!entry) {
    throw new Error(`no entry ${sourceId}`);
  }
  return entry;
};

describe('Strapi 5 exports', () => {
  let workdir: string;

  beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'shapio-strapi-'));
  });

  afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
  });

  const load = async (options: { key?: string; version?: string } = {}) => {
    const archive = await buildStrapiExport(workdir, options);
    await extractStrapiExport(archive, join(workdir, 'out'), options.key);
    return strapiSource(await readStrapiExport(join(workdir, 'out')));
  };

  it('plans models, singletons and components with mapped field types', async () => {
    const source = await load();
    expect(source.definitions.map((definition) => `${definition.kind}:${definition.apiKey}`)).toEqual([
      'collection:article',
      'collection:author',
      'collection:tag',
      'singleton:homepage',
      'component:seo',
      'component:quote',
    ]);
    const article = source.definitions[0]!;
    expect(article.localized).toBe(true);
    expect(
      article.fields.map((field) => `${field.apiKey}:${field.type}${field.localized ? '*' : ''}`),
    ).toEqual([
      'title:string*',
      'slug:uid*',
      'body:richtext*',
      'summary:richtext*',
      'statusField:string',
      'kind:enum',
      'rating:number',
      'price:decimal',
      'publishedOn:date',
      'cover:media',
      'author:relation*',
      'tags:relation*',
      'seo:component',
      'sections:dynamiczone',
    ]);
    expect(source.definitions[1]?.fields.map((field) => field.apiKey)).toEqual(['name', 'bestArticle']);
    expect(source.notes).toEqual([
      'article.status: enumeration values are not valid API names, imported as text.',
      'article.status is named statusField (the name is reserved or not a valid API ID).',
      'Skipped article.secret: passwords are never imported.',
      'Skipped article.owner: relations to plugin::users-permissions.user are not imported.',
      'Skipped author.articles: the inverse side of api::article.article.author (the owning side is imported).',
      'Draft and publish is turned on for author (off in Strapi), so imported entries are reviewed before they go live.',
    ]);
    const ids = Object.fromEntries(
      source.definitions.map((definition) => [
        definition.key,
        {
          id: crypto.randomUUID(),
          kind: definition.kind,
          apiKey: definition.apiKey,
          fields: Object.fromEntries(definition.fields.map((field) => [field.key, crypto.randomUUID()])),
        },
      ]),
    );
    expect(buildDefinitions(source, ids)).toHaveLength(6);
  });

  it('maps documents to entries with locales, published state, references and components', async () => {
    const source = await load();
    const article = entryOf(source, 'strapi:api::article.article:a1');
    expect(article.locales.map((locale) => [locale.locale, locale.published])).toEqual([
      ['en', true],
      ['fr', false],
    ]);
    const en = article.locales[0]!.fields;
    expect(en).toMatchObject({
      title: { kind: 'scalar', value: 'Hello' },
      slug: { kind: 'scalar', value: 'hello-world' },
      status: { kind: 'scalar', value: 'in-review' },
      rating: { kind: 'scalar', value: 4.5 },
      price: { kind: 'scalar', value: '9.5' },
      cover: { kind: 'media', sourceIds: ['file:20'], many: false },
      author: { kind: 'entries', sourceIds: ['strapi:api::author.author:u1'], many: false },
      tags: { kind: 'entries', sourceIds: ['strapi:api::tag.tag:t1'], many: true },
      seo: {
        kind: 'component',
        many: false,
        items: [
          {
            metaTitle: { kind: 'scalar', value: 'Hello (SEO)' },
            ogImage: { kind: 'media', sourceIds: ['file:20'] },
          },
        ],
      },
      sections: {
        kind: 'zone',
        items: [
          {
            component: 'shared.quote',
            fields: {
              text: { kind: 'scalar', value: 'Q' },
              by: { kind: 'entries', sourceIds: ['strapi:api::author.author:u1'] },
            },
          },
          { component: 'shared.seo', fields: { metaTitle: { kind: 'scalar', value: 'Z' } } },
        ],
      },
    });
    expect(article.locales[1]?.fields.title).toEqual({ kind: 'scalar', value: 'Bonjour' });
    expect(entryOf(source, 'strapi:api::author.author:u1').locales[0]?.fields.bestArticle).toEqual({
      kind: 'entries',
      sourceIds: ['strapi:api::article.article:a1'],
      many: false,
    });
    expect(entryOf(source, 'strapi:api::tag.tag:t1').locales[0]?.published).toBe(false);
    expect(entryOf(source, 'strapi:api::author.author:u1').locales[0]?.published).toBe(true);
    const homepage = entryOf(source, 'strapi:api::homepage.homepage:h1');
    expect(homepage.locales).toEqual([
      { locale: null, published: true, fields: { headline: { kind: 'scalar', value: 'New' } } },
    ]);
  });

  it('converts blocks and Markdown to rich text, resolving uploaded images', async () => {
    const fields = entryOf(await load(), 'strapi:api::article.article:a1').locales[0]!.fields;
    const body = convert(fields.body);
    expect(body.warnings).toEqual([]);
    expect(body.document.doc.content?.map((node) => node.type)).toEqual([
      'paragraph',
      'heading',
      'bulletList',
      'image',
      'codeBlock',
      'blockquote',
    ]);
    expect(body.document.doc.content?.[0]?.content).toEqual([
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' and ' },
      {
        type: 'text',
        text: 'a link',
        marks: [{ type: 'link', attrs: { href: 'https://strapi.io', target: null, rel: null, class: null } }],
      },
    ]);
    expect(body.document.doc.content?.[2]?.content?.[0]?.content?.map((node) => node.type)).toEqual([
      'paragraph',
      'orderedList',
    ]);
    const summary = convert(fields.summary);
    expect(summary.document.doc.content).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Some ' },
          { type: 'text', text: 'markdown', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' with' },
        ],
      },
      { type: 'image', attrs: { mediaId: MEDIA_ID, alt: 'thumb', title: null } },
    ]);
  });

  it('imports upload files from the archive with their alt text', async () => {
    const source = await load();
    expect(source.media).toEqual([
      {
        sourceId: 'file:20',
        filename: 'cover.png',
        path: join(workdir, 'out', 'assets', 'uploads', 'cover_abc.png'),
        mimeType: 'image/png',
        alt: 'A cover',
        caption: 'The cover',
      },
    ]);
  });

  it('reads encrypted exports with the key and refuses them without', async () => {
    const archive = await buildStrapiExport(workdir, { key: 'secret key' });
    await expect(extractStrapiExport(archive, join(workdir, 'out'))).rejects.toBeInstanceOf(
      EncryptedExportError,
    );
    await expect(extractStrapiExport(archive, join(workdir, 'out'), 'wrong')).rejects.toThrow(
      /is the key right/,
    );
    await extractStrapiExport(archive, join(workdir, 'out'), 'secret key');
    expect((await readStrapiExport(join(workdir, 'out'))).version).toBe('5.12.1');
  });

  it('refuses Strapi 4 exports', async () => {
    const archive = await buildStrapiExport(workdir, { version: '4.25.0' });
    await extractStrapiExport(archive, join(workdir, 'out'));
    await expect(readStrapiExport(join(workdir, 'out'))).rejects.toThrow(UnsupportedExportError);
    await expect(readStrapiExport(join(workdir, 'out'))).rejects.toThrow(
      /Only Strapi 5 exports are supported/,
    );
  });
});
