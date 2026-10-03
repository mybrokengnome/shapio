import { createReadStream } from 'node:fs';
import { SaxesParser, type SaxesTagPlain } from 'saxes';

/**
 * A streaming reader for WordPress eXtended RSS (WXR 1.x, Tools → Export): the channel's site details, authors,
 * categories and tags, and every item (posts, pages, attachments, anything else) with its post meta. Comments
 * are skipped. Element names are matched with their WXR prefixes (`wp:`, `content:`, `dc:`).
 */
export type WxrAuthor = {
  id: string;
  login: string;
  email: string;
  displayName: string;
  firstName: string;
  lastName: string;
};

export type WxrTerm = {
  taxonomy: 'category' | 'post_tag';
  slug: string;
  name: string;
  parent: string;
  description: string;
};

export type WxrItem = {
  id: string;
  type: string;
  status: string;
  title: string;
  /** `wp:post_name`, possibly percent-encoded, empty for some drafts. */
  slug: string;
  content: string;
  excerpt: string;
  /** `wp:post_date_gmt`, `0000-00-00 00:00:00` for drafts that never had a date. */
  dateGmt: string;
  date: string;
  creator: string;
  parent: string;
  attachmentUrl: string;
  /** `<category domain nicename>` elements: the item's categories and tags. */
  terms: Array<{ taxonomy: string; slug: string; name: string }>;
  meta: Record<string, string>;
};

export type WxrDocument = {
  title: string;
  link: string;
  language: string;
  baseSiteUrl: string;
  authors: WxrAuthor[];
  terms: WxrTerm[];
  items: WxrItem[];
};

type Fields = Record<string, string>;
type OpenRecord = { kind: 'item' | 'author' | 'category' | 'tag' | 'postmeta'; fields: Fields };

const RECORD_KINDS: Readonly<Record<string, OpenRecord['kind']>> = {
  item: 'item',
  'wp:author': 'author',
  'wp:category': 'category',
  'wp:tag': 'tag',
  'wp:postmeta': 'postmeta',
};

/** Regions whose content is ignored (comments carry their own meta elements). */
const SKIPPED = new Set(['wp:comment', 'wp:termmeta']);

const field = (fields: Fields, name: string) => fields[name] ?? '';

const toAuthor = (fields: Fields): WxrAuthor => ({
  id: field(fields, 'wp:author_id'),
  login: field(fields, 'wp:author_login'),
  email: field(fields, 'wp:author_email'),
  displayName: field(fields, 'wp:author_display_name'),
  firstName: field(fields, 'wp:author_first_name'),
  lastName: field(fields, 'wp:author_last_name'),
});

const toTerm = (kind: 'category' | 'tag', fields: Fields): WxrTerm =>
  kind === 'category'
    ? {
        taxonomy: 'category',
        slug: field(fields, 'wp:category_nicename'),
        name: field(fields, 'wp:cat_name'),
        parent: field(fields, 'wp:category_parent'),
        description: field(fields, 'wp:category_description'),
      }
    : {
        taxonomy: 'post_tag',
        slug: field(fields, 'wp:tag_slug'),
        name: field(fields, 'wp:tag_name'),
        parent: '',
        description: field(fields, 'wp:tag_description'),
      };

const newItem = (): WxrItem => ({
  id: '',
  type: '',
  status: '',
  title: '',
  slug: '',
  content: '',
  excerpt: '',
  dateGmt: '',
  date: '',
  creator: '',
  parent: '',
  attachmentUrl: '',
  terms: [],
  meta: {},
});

const finishItem = (item: WxrItem, fields: Fields): WxrItem => ({
  ...item,
  id: field(fields, 'wp:post_id'),
  type: field(fields, 'wp:post_type'),
  status: field(fields, 'wp:status'),
  title: field(fields, 'title'),
  slug: field(fields, 'wp:post_name'),
  content: field(fields, 'content:encoded'),
  excerpt: field(fields, 'excerpt:encoded'),
  dateGmt: field(fields, 'wp:post_date_gmt'),
  date: field(fields, 'wp:post_date'),
  creator: field(fields, 'dc:creator'),
  parent: field(fields, 'wp:post_parent'),
  attachmentUrl: field(fields, 'wp:attachment_url'),
});

const CHANNEL_FIELDS: Readonly<
  Record<string, keyof Pick<WxrDocument, 'title' | 'link' | 'language' | 'baseSiteUrl'>>
> = {
  title: 'title',
  link: 'link',
  language: 'language',
  'wp:base_site_url': 'baseSiteUrl',
};

/** Builds the document from parser events; one instance per file. */
const createCollector = () => {
  const document: WxrDocument = {
    title: '',
    link: '',
    language: '',
    baseSiteUrl: '',
    authors: [],
    terms: [],
    items: [],
  };
  const records: OpenRecord[] = [];
  let item = newItem();
  let text = '';
  let skipDepth = 0;
  let depth = 0;

  const open = (tag: SaxesTagPlain) => {
    depth += 1;
    text = '';
    if (skipDepth > 0 || SKIPPED.has(tag.name)) {
      skipDepth += 1;
      return;
    }
    const kind = RECORD_KINDS[tag.name];
    if (kind) {
      records.push({ kind, fields: {} });
      if (kind === 'item') {
        item = newItem();
      }
    } else if (tag.name === 'category' && records.at(-1)?.kind === 'item') {
      item.terms.push({
        taxonomy: tag.attributes.domain ?? '',
        slug: tag.attributes.nicename ?? '',
        name: '',
      });
    }
  };

  const closeRecord = (record: OpenRecord) => {
    if (record.kind === 'item') {
      document.items.push(finishItem(item, record.fields));
    } else if (record.kind === 'author') {
      document.authors.push(toAuthor(record.fields));
    } else if (record.kind === 'postmeta') {
      item.meta[field(record.fields, 'wp:meta_key')] = field(record.fields, 'wp:meta_value');
    } else {
      document.terms.push(toTerm(record.kind, record.fields));
    }
  };

  const close = (tag: SaxesTagPlain) => {
    depth -= 1;
    if (skipDepth > 0) {
      skipDepth -= 1;
      return;
    }
    const current = records.at(-1);
    if (RECORD_KINDS[tag.name] && current) {
      records.pop();
      closeRecord(current);
    } else if (tag.name === 'category' && current?.kind === 'item') {
      const term = item.terms.at(-1);
      if (term) {
        term.name = text.trim();
      }
    } else if (current) {
      current.fields[tag.name] = text;
    } else if (depth === 2 && CHANNEL_FIELDS[tag.name]) {
      document[CHANNEL_FIELDS[tag.name]!] = text.trim();
    }
    text = '';
  };

  const append = (chunk: string) => {
    if (skipDepth === 0) {
      text += chunk;
    }
  };

  return { document, open, close, append };
};

/** Parses a WXR file without loading the XML into memory at once. */
export const readWxr = async (path: string): Promise<WxrDocument> => {
  const parser = new SaxesParser({ xmlns: false });
  const collector = createCollector();
  let failure: Error | undefined;
  parser.on('opentag', collector.open);
  parser.on('closetag', collector.close);
  parser.on('text', collector.append);
  parser.on('cdata', collector.append);
  parser.on('error', (error) => {
    failure ??= error;
  });
  for await (const chunk of createReadStream(path, { encoding: 'utf8' })) {
    parser.write(chunk as string);
    if (failure) {
      break;
    }
  }
  if (!failure) {
    parser.close();
  }
  if (failure) {
    throw new Error(`${path} is not a readable WordPress export (WXR): ${failure.message}`);
  }
  if (!collector.document.items.length && !collector.document.authors.length) {
    throw new Error(`${path} has no WordPress items or authors: is it a WXR export (Tools → Export)?`);
  }
  return collector.document;
};
