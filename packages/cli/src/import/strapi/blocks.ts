import {
  RICHTEXT_FORMAT,
  RICHTEXT_FORMAT_VERSION,
  SAFE_LINK_PATTERN,
  validateRichText,
  type RichTextNode,
} from '@shapio/schema';
import type { ConversionWarning, RichTextConversion } from '../types.js';

/**
 * Strapi 5 "blocks" (its JSON rich-text format) → Shapio rich text. Paragraphs, headings, lists (nested lists
 * join the previous item), quotes, code and images map directly; bold, italic, code and links keep their marks;
 * underline and strikethrough have no Shapio mark and are dropped (the text stays). Images become image nodes
 * when `resolveImage` knows the uploaded asset, else they are left out with a warning.
 */
type Block = {
  type?: string;
  children?: Block[];
  text?: string;
  level?: number;
  format?: string;
  language?: string;
  url?: string;
  image?: { url?: string; alternativeText?: string | null; caption?: string | null };
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

export type BlockImageResolver = (url: string) => string | undefined;

type Context = { resolveImage: BlockImageResolver; warnings: ConversionWarning[] };

type Mark = NonNullable<RichTextNode['marks']>[number];

const LANGUAGE_PATTERN = /^[A-Za-z0-9_+#.-]{1,32}$/;

const inline = (nodes: readonly Block[] | undefined, context: Context, link?: Mark): RichTextNode[] =>
  (nodes ?? []).flatMap((node): RichTextNode[] => {
    if (node.type === 'link') {
      const url = node.url?.trim() ?? '';
      const safe = url.length > 0 && url.length <= 2048 && SAFE_LINK_PATTERN.test(url);
      if (!safe && url) {
        context.warnings.push({ code: 'unsafeLink', detail: url.slice(0, 200) });
      }
      return inline(
        node.children,
        context,
        safe ? { type: 'link', attrs: { href: url, target: null, rel: null, class: null } } : link,
      );
    }
    if (typeof node.text !== 'string' || node.text.length === 0) {
      return inline(node.children, context, link);
    }
    const parts = node.text.split('\n');
    const marks: Mark[] = [
      ...(node.bold ? [{ type: 'bold' }] : []),
      ...(node.italic ? [{ type: 'italic' }] : []),
      ...(node.code ? [{ type: 'code' }] : []),
      ...(link ? [link] : []),
    ];
    return parts.flatMap((part, index): RichTextNode[] => [
      ...(index > 0 ? [{ type: 'hardBreak' }] : []),
      ...(part
        ? [marks.length > 0 ? { type: 'text', text: part, marks } : { type: 'text', text: part }]
        : []),
    ]);
  });

const textblock = (type: string, content: RichTextNode[], attrs?: Record<string, unknown>): RichTextNode => ({
  type,
  ...(attrs ? { attrs } : {}),
  ...(content.length > 0 ? { content } : {}),
});

const plainText = (nodes: readonly Block[] | undefined): string =>
  (nodes ?? [])
    .map((node) => (typeof node.text === 'string' ? node.text : plainText(node.children)))
    .join('');

const listNode = (block: Block, context: Context): RichTextNode[] => {
  const items: RichTextNode[] = [];
  for (const child of block.children ?? []) {
    if (child.type === 'list') {
      const nested = listNode(child, context);
      const previous = items.at(-1);
      if (previous) {
        previous.content = [...(previous.content ?? []), ...nested];
      } else {
        items.push({ type: 'listItem', content: nested.length > 0 ? nested : [{ type: 'paragraph' }] });
      }
      continue;
    }
    items.push({ type: 'listItem', content: [textblock('paragraph', inline(child.children, context))] });
  }
  if (items.length === 0) {
    return [];
  }
  return [
    block.format === 'ordered'
      ? { type: 'orderedList', attrs: { start: 1, type: null }, content: items }
      : { type: 'bulletList', content: items },
  ];
};

const imageNode = (block: Block, context: Context): RichTextNode[] => {
  const url = block.image?.url ?? '';
  const mediaId = url ? context.resolveImage(url) : undefined;
  if (!mediaId) {
    context.warnings.push({ code: 'imageUnresolved', detail: url || '(no url)' });
    return [];
  }
  const alt = block.image?.alternativeText?.slice(0, 1000) ?? null;
  return [{ type: 'image', attrs: { mediaId, alt: alt || null, title: null } }];
};

const convertBlock = (block: Block, context: Context): RichTextNode[] => {
  switch (block.type) {
    case 'paragraph':
      return [textblock('paragraph', inline(block.children, context))];
    case 'heading': {
      const level = Number.isInteger(block.level) && block.level! >= 1 && block.level! <= 6 ? block.level : 1;
      return [textblock('heading', inline(block.children, context), { level })];
    }
    case 'list':
      return listNode(block, context);
    case 'quote': {
      const content = inline(block.children, context);
      return [{ type: 'blockquote', content: [textblock('paragraph', content)] }];
    }
    case 'code': {
      const text = plainText(block.children);
      const language = block.language && LANGUAGE_PATTERN.test(block.language) ? block.language : null;
      return [
        { type: 'codeBlock', attrs: { language }, ...(text ? { content: [{ type: 'text', text }] } : {}) },
      ];
    }
    case 'image':
      return imageNode(block, context);
    default:
      context.warnings.push({ code: 'unsupportedBlock', detail: String(block.type) });
      return [textblock('paragraph', inline(block.children, context))];
  }
};

export const blocksToRichText = (value: unknown, resolveImage: BlockImageResolver): RichTextConversion => {
  const context: Context = { resolveImage, warnings: [] };
  const blocks = Array.isArray(value) ? (value as Block[]) : [];
  const content = blocks.flatMap((block) => convertBlock(block, context));
  const result = validateRichText({
    format: RICHTEXT_FORMAT,
    version: RICHTEXT_FORMAT_VERSION,
    doc: content.length > 0 ? { type: 'doc', content } : { type: 'doc' },
  });
  if (result.ok) {
    return { document: result.document, warnings: context.warnings };
  }
  context.warnings.push({ code: 'invalidOutput', detail: JSON.stringify(result.problems.slice(0, 3)) });
  const text = blocks
    .map((block) => plainText(block.children))
    .filter(Boolean)
    .join('\n\n');
  const fallback = validateRichText({
    format: RICHTEXT_FORMAT,
    version: RICHTEXT_FORMAT_VERSION,
    doc: text
      ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
      : { type: 'doc' },
  });
  if (!fallback.ok) {
    throw new Error('Rich-text fallback document is invalid');
  }
  return { document: fallback.document, warnings: context.warnings };
};
