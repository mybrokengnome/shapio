import { join } from 'node:path';
import { collectHtmlImages, htmlToRichText } from '@shapio/schema/html';
import { uniqueSlug } from '../naming.js';
import type {
  ImportEntry,
  ImportMedia,
  ImportSource,
  PlannedDefinition,
  PlannedField,
  SourceFields,
  ValueResolver,
} from '../types.js';
import {
  absoluteUrl,
  createImageIndex,
  filenameOf,
  prepareBody,
  shortcodeWarnings,
  uploadsRelativePath,
  type ImageIndex,
} from './content.js';
import type { WxrDocument, WxrItem, WxrTerm } from './wxr.js';

/**
 * WordPress → the import model. Posts and pages become `post` and `page`; authors a generated `author`
 * collection; categories and tags `category` and `tag` collections that posts reference; attachments the
 * media library. Published items become publish items of the change set; drafts, pending, private and
 * scheduled items stay drafts. Trash, revisions, menus and custom post types are skipped (and listed).
 */
export type WordPressOptions = { mediaDir?: string };

const PUBLISHED = new Set(['publish']);
const KEPT_AS_DRAFT = new Set(['draft', 'pending', 'private', 'future']);
const CONTENT_TYPES = new Set(['post', 'page']);

const text = (key: string, label: string, extra: Partial<PlannedField> = {}): PlannedField => ({
  key,
  apiKey: key,
  label,
  type: 'string',
  ...extra,
});
const slugField = (source: string): PlannedField =>
  text('slug', 'Slug', { type: 'slug', unique: true, slugSource: source });
const relation = (key: string, label: string, target: string, many: boolean): PlannedField => ({
  key,
  apiKey: key,
  label,
  type: 'relation',
  target,
  settings: { cardinality: many ? 'many' : 'one' },
});
const cover = (): PlannedField => ({
  key: 'cover',
  apiKey: 'cover',
  label: 'Featured image',
  type: 'media',
  settings: { multiple: false, allowedKinds: ['image'] },
});
const collection = (
  key: string,
  label: string,
  titleField: string,
  fields: PlannedField[],
): PlannedDefinition => ({
  key,
  kind: 'collection',
  apiKey: key,
  label,
  titleField,
  fields,
});

type Present = { authors: boolean; categories: boolean; tags: boolean; posts: boolean; pages: boolean };

const definitionsFor = (present: Present): PlannedDefinition[] => {
  const postFields: PlannedField[] = [
    text('title', 'Title'),
    slugField('title'),
    { key: 'body', apiKey: 'body', label: 'Body', type: 'richtext' },
    text('excerpt', 'Excerpt', { type: 'text' }),
    text('date', 'Date', { type: 'datetime', sortable: true }),
    cover(),
    ...(present.authors ? [relation('author', 'Author', 'author', false)] : []),
    ...(present.categories ? [relation('categories', 'Categories', 'category', true)] : []),
    ...(present.tags ? [relation('tags', 'Tags', 'tag', true)] : []),
  ];
  return [
    ...(present.authors
      ? [
          collection('author', 'Author', 'name', [
            text('name', 'Name'),
            slugField('name'),
            text('email', 'Email', { type: 'email', public: false }),
          ]),
        ]
      : []),
    ...(present.categories
      ? [
          collection('category', 'Category', 'name', [
            text('name', 'Name'),
            slugField('name'),
            text('description', 'Description', { type: 'text' }),
            relation('parent', 'Parent', 'category', false),
          ]),
        ]
      : []),
    ...(present.tags
      ? [
          collection('tag', 'Tag', 'name', [
            text('name', 'Name'),
            slugField('name'),
            text('description', 'Description', { type: 'text' }),
          ]),
        ]
      : []),
    ...(present.posts ? [collection('post', 'Post', 'title', postFields)] : []),
    ...(present.pages
      ? [
          collection('page', 'Page', 'title', [
            text('title', 'Title'),
            slugField('title'),
            { key: 'body', apiKey: 'body', label: 'Body', type: 'richtext' },
            text('date', 'Date', { type: 'datetime', sortable: true }),
            cover(),
            relation('parent', 'Parent', 'page', false),
          ]),
        ]
      : []),
  ];
};

const scalar = (value: string | undefined) =>
  value !== undefined && value.trim().length > 0
    ? { kind: 'scalar' as const, value: value.trim() }
    : undefined;
const refs = (sourceIds: string[], many: boolean) =>
  sourceIds.length > 0 ? { kind: 'entries' as const, sourceIds, many } : undefined;

const compact = (fields: Record<string, SourceFields[string] | undefined>): SourceFields =>
  Object.fromEntries(
    Object.entries(fields).filter((entry): entry is [string, SourceFields[string]] => !!entry[1]),
  );

const publishedEntry = (
  sourceId: string,
  definition: string,
  title: string,
  fields: SourceFields,
): ImportEntry => ({
  sourceId,
  definition,
  title,
  locales: [{ locale: null, fields, published: true }],
});

const WP_DATE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

/** `2024-05-01 10:00:00` (GMT) → `2024-05-01T10:00:00.000Z`; WordPress's zero date has none. */
export const wordpressDate = (item: Pick<WxrItem, 'dateGmt' | 'date'>): string | undefined => {
  for (const value of [item.dateGmt, item.date]) {
    const match = WP_DATE.exec(value.trim());
    if (match && !value.startsWith('0000')) {
      return `${match[1]}T${match[2]}.000Z`;
    }
  }
  return undefined;
};

/** Every term the export lists, plus terms items use without the channel listing them. */
const collectTerms = (document: WxrDocument): WxrTerm[] => {
  const terms = new Map(document.terms.map((term) => [`${term.taxonomy}:${term.slug}`, term]));
  for (const item of document.items) {
    for (const term of item.terms) {
      const taxonomy =
        term.taxonomy === 'post_tag' ? 'post_tag' : term.taxonomy === 'category' ? 'category' : undefined;
      if (taxonomy && term.slug && !terms.has(`${taxonomy}:${term.slug}`)) {
        terms.set(`${taxonomy}:${term.slug}`, {
          taxonomy,
          slug: term.slug,
          name: term.name,
          parent: '',
          description: '',
        });
      }
    }
  }
  return [...terms.values()];
};

const termEntries = (terms: readonly WxrTerm[]): ImportEntry[] => {
  const slugs = { category: new Set<string>(), post_tag: new Set<string>() };
  const known = new Set(terms.map((term) => `${term.taxonomy}:${term.slug}`));
  return terms.map((term) => {
    const definition = term.taxonomy === 'category' ? 'category' : 'tag';
    const parent =
      term.taxonomy === 'category' && known.has(`category:${term.parent}`) ? [`category:${term.parent}`] : [];
    return publishedEntry(
      `${definition}:${term.slug}`,
      definition,
      term.name || term.slug,
      compact({
        name: scalar(term.name || term.slug),
        slug: scalar(uniqueSlug(term.slug, `${definition}-${term.slug}`, slugs[term.taxonomy])),
        description: scalar(term.description),
        ...(definition === 'category' ? { parent: refs(parent, false) } : {}),
      }),
    );
  });
};

const authorEntries = (document: WxrDocument): ImportEntry[] => {
  const byLogin = new Map(document.authors.map((author) => [author.login, author]));
  for (const item of document.items) {
    if (CONTENT_TYPES.has(item.type) && item.creator && !byLogin.has(item.creator)) {
      byLogin.set(item.creator, {
        id: '',
        login: item.creator,
        email: '',
        displayName: item.creator,
        firstName: '',
        lastName: '',
      });
    }
  }
  const slugs = new Set<string>();
  return [...byLogin.values()].map((author) => {
    const name =
      author.displayName || [author.firstName, author.lastName].filter(Boolean).join(' ') || author.login;
    return publishedEntry(
      `author:${author.login}`,
      'author',
      name,
      compact({
        name: scalar(name),
        slug: scalar(uniqueSlug(author.login, `author-${author.id || author.login}`, slugs)),
        email: scalar(author.email),
      }),
    );
  });
};

const attachmentMedia = (item: WxrItem, options: WordPressOptions): ImportMedia => {
  const relative = options.mediaDir ? uploadsRelativePath(item.attachmentUrl) : undefined;
  const alt = item.meta._wp_attachment_image_alt;
  return {
    sourceId: `attachment:${item.id}`,
    filename: filenameOf(item.attachmentUrl, `attachment-${item.id}`),
    url: item.attachmentUrl,
    ...(relative && options.mediaDir ? { path: join(options.mediaDir, relative) } : {}),
    ...(alt ? { alt } : {}),
    ...(item.excerpt.trim() ? { caption: item.excerpt.trim() } : {}),
  };
};

type ItemContext = {
  base: string;
  images: ImageIndex;
  known: ReadonlySet<string>;
  slugs: Record<string, Set<string>>;
};

const bodyValue = (html: string, images: ImageIndex) => ({
  kind: 'richtext' as const,
  convert: (resolver: ValueResolver) => {
    const result = htmlToRichText(html, {
      resolveImage: (image) => {
        const sourceId = images.lookup(image.src);
        return sourceId ? resolver.media(sourceId) : undefined;
      },
    });
    return { document: result.document, warnings: [...shortcodeWarnings(html), ...result.warnings] };
  },
});

const itemEntry = (item: WxrItem, context: ItemContext): ImportEntry => {
  const type = item.type;
  const terms = (taxonomy: string, prefix: string) =>
    item.terms
      .filter((term) => term.taxonomy === taxonomy && term.slug)
      .map((term) => `${prefix}:${term.slug}`);
  const ref = (sourceId: string) => (context.known.has(sourceId) ? [sourceId] : []);
  const body = prepareBody(item.content);
  const date = wordpressDate(item);
  const fields = compact({
    title: scalar(item.title),
    slug: scalar(uniqueSlug(item.slug || item.title, `${type}-${item.id}`, context.slugs[type]!)),
    body: body.trim() ? bodyValue(body, context.images) : undefined,
    date: date ? { kind: 'scalar', value: date } : undefined,
    cover:
      item.meta._thumbnail_id && context.known.has(`attachment:${item.meta._thumbnail_id}`)
        ? { kind: 'media', sourceIds: [`attachment:${item.meta._thumbnail_id}`], many: false }
        : undefined,
    ...(type === 'post'
      ? {
          excerpt: scalar(item.excerpt),
          author: refs(ref(`author:${item.creator}`), false),
          categories: refs(terms('category', 'category'), true),
          tags: refs(terms('post_tag', 'tag'), true),
        }
      : { parent: refs(ref(`page:${item.parent}`), false) }),
  });
  return {
    sourceId: `${type}:${item.id}`,
    definition: type,
    title: item.title || `(untitled ${type} ${item.id})`,
    locales: [{ locale: null, fields, published: PUBLISHED.has(item.status) }],
  };
};

/** Images posts show that are not attachments of the export: imported from their URLs as extra media. */
const extraImages = (
  items: readonly WxrItem[],
  context: Pick<ItemContext, 'base' | 'images'>,
): ImportMedia[] => {
  const extra: ImportMedia[] = [];
  for (const item of items) {
    for (const image of collectHtmlImages(prepareBody(item.content))) {
      const url = absoluteUrl(image.src, context.base);
      if (!url || context.images.lookup(url)) {
        continue;
      }
      const sourceId = `url:${url}`;
      context.images.add(url, sourceId);
      extra.push({
        sourceId,
        filename: filenameOf(url, 'image'),
        url,
        ...(image.alt ? { alt: image.alt } : {}),
      });
    }
  }
  return extra;
};

const skippedNotes = (items: readonly WxrItem[]): string[] => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const reason =
      !CONTENT_TYPES.has(item.type) && item.type !== 'attachment'
        ? `items of type "${item.type}" (only posts, pages and attachments are imported)`
        : CONTENT_TYPES.has(item.type) && !PUBLISHED.has(item.status) && !KEPT_AS_DRAFT.has(item.status)
          ? `${item.type}s with status "${item.status}"`
          : undefined;
    if (reason) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return [...counts].map(([reason, count]) => `Skipped ${count} ${reason}.`);
};

export const wordpressSource = (document: WxrDocument, options: WordPressOptions = {}): ImportSource => {
  const base = document.baseSiteUrl || document.link;
  const contentItems = document.items.filter(
    (item) => CONTENT_TYPES.has(item.type) && (PUBLISHED.has(item.status) || KEPT_AS_DRAFT.has(item.status)),
  );
  const attachments = document.items.filter((item) => item.type === 'attachment' && item.attachmentUrl);
  const images = createImageIndex(base);
  const media = attachments.map((item) => attachmentMedia(item, options));
  media.forEach((item) => images.add(item.url!, item.sourceId));
  media.push(...extraImages(contentItems, { base, images }));
  const terms = collectTerms(document);
  const authors = authorEntries(document);
  const present: Present = {
    authors: authors.length > 0,
    categories: terms.some((term) => term.taxonomy === 'category'),
    tags: terms.some((term) => term.taxonomy === 'post_tag'),
    posts: contentItems.some((item) => item.type === 'post'),
    pages: contentItems.some((item) => item.type === 'page'),
  };
  const known = new Set([
    ...authors.map((entry) => entry.sourceId),
    ...contentItems.map((item) => `${item.type}:${item.id}`),
    ...attachments.map((item) => `attachment:${item.id}`),
  ]);
  const context: ItemContext = { base, images, known, slugs: { post: new Set(), page: new Set() } };
  return {
    kind: 'wordpress',
    definitions: definitionsFor(present),
    media,
    entries: [...authors, ...termEntries(terms), ...contentItems.map((item) => itemEntry(item, context))],
    notes: skippedNotes(document.items),
  };
};
