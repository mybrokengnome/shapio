import { createCipheriv, scryptSync } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { create } from 'tar';

/**
 * A small synthetic Strapi 5 export (the `strapi export` layout) for tests: no real export was available, so
 * this follows the data-transfer file format as documented. It has a localized article with a draft-only
 * locale, a single type, components, a dynamic zone, an author ↔ article relation cycle, an upload file with a
 * thumbnail format, and attributes the importer must skip.
 */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

export const STRAPI_SCHEMAS = [
  {
    uid: 'api::article.article',
    modelType: 'contentType',
    kind: 'collectionType',
    info: { singularName: 'article', pluralName: 'articles', displayName: 'Article' },
    options: { draftAndPublish: true },
    pluginOptions: { i18n: { localized: true } },
    attributes: {
      title: { type: 'string', pluginOptions: { i18n: { localized: true } } },
      slug: { type: 'uid', targetField: 'title' },
      body: { type: 'blocks', pluginOptions: { i18n: { localized: true } } },
      summary: { type: 'richtext', pluginOptions: { i18n: { localized: true } } },
      status: { type: 'enumeration', enum: ['in-review', 'live'] },
      kind: { type: 'enumeration', enum: ['news', 'opinion'] },
      rating: { type: 'float' },
      price: { type: 'decimal' },
      publishedOn: { type: 'date' },
      cover: { type: 'media', multiple: false, allowedTypes: ['images'] },
      author: {
        type: 'relation',
        relation: 'manyToOne',
        target: 'api::author.author',
        inversedBy: 'articles',
      },
      tags: { type: 'relation', relation: 'manyToMany', target: 'api::tag.tag' },
      seo: { type: 'component', component: 'shared.seo', repeatable: false },
      sections: { type: 'dynamiczone', components: ['shared.quote', 'shared.seo'] },
      secret: { type: 'password' },
      owner: { type: 'relation', relation: 'oneToOne', target: 'plugin::users-permissions.user' },
      createdBy: { type: 'relation', relation: 'oneToOne', target: 'admin::user' },
    },
  },
  {
    uid: 'api::author.author',
    modelType: 'contentType',
    kind: 'collectionType',
    info: { singularName: 'author', pluralName: 'authors', displayName: 'Author' },
    options: { draftAndPublish: false },
    attributes: {
      name: { type: 'string' },
      articles: {
        type: 'relation',
        relation: 'oneToMany',
        target: 'api::article.article',
        mappedBy: 'author',
      },
      bestArticle: { type: 'relation', relation: 'oneToOne', target: 'api::article.article' },
    },
  },
  {
    uid: 'api::tag.tag',
    modelType: 'contentType',
    kind: 'collectionType',
    info: { singularName: 'tag', pluralName: 'tags', displayName: 'Tag' },
    options: { draftAndPublish: true },
    attributes: { name: { type: 'string' } },
  },
  {
    uid: 'api::homepage.homepage',
    modelType: 'contentType',
    kind: 'singleType',
    info: { singularName: 'homepage', pluralName: 'homepages', displayName: 'Homepage' },
    options: { draftAndPublish: true },
    attributes: { headline: { type: 'string' } },
  },
  {
    uid: 'shared.seo',
    modelType: 'component',
    category: 'shared',
    info: { displayName: 'SEO' },
    attributes: {
      metaTitle: { type: 'string' },
      ogImage: { type: 'media', multiple: false, allowedTypes: ['images'] },
    },
  },
  {
    uid: 'shared.quote',
    modelType: 'component',
    category: 'shared',
    info: { displayName: 'Quote' },
    attributes: {
      text: { type: 'text' },
      by: { type: 'relation', relation: 'manyToOne', target: 'api::author.author' },
    },
  },
  {
    uid: 'plugin::upload.file',
    modelType: 'contentType',
    kind: 'collectionType',
    info: { singularName: 'file', pluralName: 'files', displayName: 'File' },
    attributes: { name: { type: 'string' } },
  },
];

export const ARTICLE_BLOCKS = [
  {
    type: 'paragraph',
    children: [
      { type: 'text', text: 'Hello ' },
      { type: 'text', text: 'world', bold: true, underline: true },
      { type: 'text', text: ' and ' },
      { type: 'link', url: 'https://strapi.io', children: [{ type: 'text', text: 'a link' }] },
    ],
  },
  { type: 'heading', level: 2, children: [{ type: 'text', text: 'Section' }] },
  {
    type: 'list',
    format: 'unordered',
    children: [
      { type: 'list-item', children: [{ type: 'text', text: 'One' }] },
      {
        type: 'list',
        format: 'ordered',
        children: [{ type: 'list-item', children: [{ type: 'text', text: 'Nested' }] }],
      },
    ],
  },
  {
    type: 'image',
    image: { url: '/uploads/cover_abc.png', alternativeText: 'A cover' },
    children: [{ type: 'text', text: '' }],
  },
  { type: 'code', language: 'ts', children: [{ type: 'text', text: 'const a = 1;' }] },
  { type: 'quote', children: [{ type: 'text', text: 'Quoted', italic: true }] },
];

const articleData = (locale: string, publishedAt: string | null, title: string) => ({
  documentId: 'a1',
  locale,
  publishedAt,
  title,
  slug: 'hello-world',
  body: ARTICLE_BLOCKS,
  summary: 'Some **markdown** with ![thumb](/uploads/thumbnail_cover_abc.png)',
  status: 'in-review',
  kind: 'news',
  rating: 4.5,
  price: 9.5,
  publishedOn: '2024-05-01',
  secret: 'hash',
  seo: { id: 10, metaTitle: `${title} (SEO)` },
  sections: [
    { id: 11, __component: 'shared.quote', text: 'Q' },
    { id: 12, __component: 'shared.seo', metaTitle: 'Z' },
  ],
});

export const STRAPI_ENTITIES = [
  { type: 'api::article.article', id: 1, data: articleData('en', null, 'Hello') },
  { type: 'api::article.article', id: 2, data: articleData('en', '2024-05-01T10:00:00.000Z', 'Hello') },
  { type: 'api::article.article', id: 3, data: articleData('fr', null, 'Bonjour') },
  {
    type: 'api::author.author',
    id: 5,
    data: { documentId: 'u1', locale: null, publishedAt: '2024-01-01T00:00:00.000Z', name: 'Ada' },
  },
  { type: 'api::tag.tag', id: 6, data: { documentId: 't1', locale: null, publishedAt: null, name: 'News' } },
  {
    type: 'api::homepage.homepage',
    id: 7,
    data: { documentId: 'h1', locale: null, publishedAt: '2024-01-01T00:00:00.000Z', headline: 'Old' },
  },
  {
    type: 'api::homepage.homepage',
    id: 8,
    data: { documentId: 'h1', locale: null, publishedAt: null, headline: 'New' },
  },
  {
    type: 'plugin::upload.file',
    id: 20,
    data: {
      documentId: 'f1',
      // Without its extension, as in Strapi's own example project (`ext` holds it).
      name: 'cover',
      alternativeText: 'A cover',
      caption: 'The cover',
      hash: 'cover_abc',
      ext: '.png',
      mime: 'image/png',
      url: '/uploads/cover_abc.png',
      formats: { thumbnail: { url: '/uploads/thumbnail_cover_abc.png' } },
    },
  },
];

export const STRAPI_LINKS = [
  {
    kind: 'relation.morph',
    relation: 'morphToMany',
    left: { type: 'plugin::upload.file', ref: 20, field: 'related' },
    right: { type: 'api::article.article', ref: 1, field: 'cover' },
  },
  {
    kind: 'relation.morph',
    relation: 'morphToMany',
    left: { type: 'plugin::upload.file', ref: 20, field: 'related' },
    right: { type: 'shared.seo', ref: 10, field: 'ogImage' },
  },
  {
    kind: 'relation.basic',
    relation: 'manyToOne',
    left: { type: 'api::article.article', ref: 1, field: 'author' },
    right: { type: 'api::author.author', ref: 5, field: 'articles' },
  },
  {
    kind: 'relation.basic',
    relation: 'manyToMany',
    left: { type: 'api::article.article', ref: 1, field: 'tags' },
    right: { type: 'api::tag.tag', ref: 6 },
  },
  {
    kind: 'relation.basic',
    relation: 'oneToOne',
    left: { type: 'api::author.author', ref: 5, field: 'bestArticle' },
    right: { type: 'api::article.article', ref: 2 },
  },
  {
    kind: 'relation.basic',
    relation: 'manyToOne',
    left: { type: 'shared.quote', ref: 11, field: 'by' },
    right: { type: 'api::author.author', ref: 5 },
  },
  {
    kind: 'relation.basic',
    relation: 'oneToOne',
    left: { type: 'api::article.article', ref: 1, field: 'owner' },
    right: { type: 'plugin::users-permissions.user', ref: 1 },
  },
];

const jsonl = (items: readonly unknown[]) => `${items.map((item) => JSON.stringify(item)).join('\n')}\n`;

const writeFiles = async (dir: string, files: Record<string, string | Buffer>) => {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), content);
  }
};

/**
 * Writes the export's files into `workdir/export` and packs them as `strapi export` does: tar, gzip, then
 * (with `key`) AES-128-ECB. Returns the archive's path.
 */
export const buildStrapiExport = async (
  workdir: string,
  { key, version = '5.12.1' }: { key?: string; version?: string } = {},
): Promise<string> => {
  const source = join(workdir, 'export');
  await writeFiles(source, {
    'metadata.json': JSON.stringify({ createdAt: '2024-05-02T00:00:00.000Z', strapi: { version } }, null, 2),
    'schemas/schemas_00001.jsonl': jsonl(STRAPI_SCHEMAS),
    'entities/entities_00001.jsonl': jsonl(STRAPI_ENTITIES),
    'links/links_00001.jsonl': jsonl(STRAPI_LINKS),
    'configuration/configuration_00001.jsonl': jsonl([]),
    'assets/uploads/cover_abc.png': PNG_1X1,
    'assets/uploads/thumbnail_cover_abc.png': PNG_1X1,
    'assets/metadata/cover_abc.png.json': JSON.stringify(STRAPI_ENTITIES.at(-1)?.data),
  });
  const archive = join(workdir, key ? 'export.tar.gz.enc' : 'export.tar.gz');
  const plain = join(workdir, 'export.tar.gz');
  await create({ gzip: true, cwd: source, file: plain, portable: true }, await readdir(source));
  if (key) {
    await pipeline(
      createReadStream(plain),
      createCipheriv('aes-128-ecb', scryptSync(key, '', 16), null),
      createWriteStream(archive),
    );
  }
  return archive;
};
