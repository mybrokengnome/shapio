import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';
import { RICHTEXT_FORMAT, RICHTEXT_FORMAT_VERSION } from '../types/valueFormats.js';
import { MAX_RICHTEXT_DEPTH, SAFE_LINK_PATTERN } from './spec.js';
import { validateRichText, type RichTextDocument, type RichTextNode } from './validate.js';

/**
 * HTML → Shapio rich text (ADR 0003), for importers: WordPress post bodies, Markdown rendered to HTML. Runs in
 * Node without a browser DOM (parse5). Everything maps to the baseline node and mark set in `spec.ts`;
 * anything else is unwrapped (its text is kept) or, for embeds and scripts, dropped with a warning. The result
 * always passes `validateRichText`.
 *
 * Images become `image` nodes only when `resolveImage` returns a media asset ID for them: rich text never
 * stores a URL, so an image the caller could not import is dropped (and reported).
 */

type Element = DefaultTreeAdapterTypes.Element;
type ChildNode = DefaultTreeAdapterTypes.ChildNode;
type Mark = NonNullable<RichTextNode['marks']>[number];

export type HtmlImage = { src: string; alt: string | null; title: string | null };

export type HtmlConversionWarningCode = 'imageUnresolved' | 'unsafeLink' | 'embedDropped' | 'invalidOutput';
export type HtmlConversionWarning = { code: HtmlConversionWarningCode; detail: string };

export type HtmlToRichTextOptions = {
  /** Returns the media asset ID for an image, or undefined to drop it. Without it every image is dropped. */
  resolveImage?: (image: HtmlImage) => string | undefined;
};

export type HtmlToRichTextResult = { document: RichTextDocument; warnings: HtmlConversionWarning[] };

const MARK_TAGS: Readonly<Record<string, Mark['type']>> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  code: 'code',
  kbd: 'code',
  samp: 'code',
  tt: 'code',
};

/** Elements whose content is block-level and simply unwrapped into the surrounding blocks. */
const CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'aside',
  'header',
  'footer',
  'main',
  'nav',
  'figure',
  'center',
  'details',
  'dl',
  'address',
  'form',
  'fieldset',
  'hgroup',
  'body',
  'html',
]);

/** Elements that become one paragraph of their inline content. */
const PARAGRAPH_TAGS = new Set(['p', 'figcaption', 'dt', 'dd', 'summary', 'caption', 'legend', 'li']);

/** Dropped with their content; embeds are reported because something visible is lost. */
const SILENT_DROP_TAGS = new Set([
  'script',
  'style',
  'template',
  'head',
  'noscript',
  'title',
  'meta',
  'link',
]);
const EMBED_TAGS = new Set([
  'iframe',
  'video',
  'audio',
  'object',
  'embed',
  'svg',
  'math',
  'canvas',
  'button',
  'input',
  'select',
  'textarea',
]);

const HEADING_LEVELS: Readonly<Record<string, number>> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
const LIST_TYPES = new Set(['1', 'a', 'A', 'i', 'I']);
const LANGUAGE_PATTERN = /^[A-Za-z0-9_+#.-]{1,32}$/;
const MAX_ATTR_TEXT = 1000;
/** Containers deeper than this are unwrapped, so the document stays within MAX_RICHTEXT_DEPTH. */
const MAX_BLOCK_DEPTH = MAX_RICHTEXT_DEPTH - 6;

type Context = { options: HtmlToRichTextOptions; warnings: HtmlConversionWarning[] };

/** Collects one textblock's inline content; `flush` turns it into a block and starts the next one. */
type Sink = {
  blocks: RichTextNode[];
  inline: RichTextNode[];
  textblock: (content: RichTextNode[]) => RichTextNode;
};

const isElement = (node: ChildNode): node is Element => 'tagName' in node;

const attrOf = (element: Element, name: string): string | null =>
  element.attrs.find((attr) => attr.name === name)?.value ?? null;

const textContent = (node: ChildNode): string =>
  node.nodeName === '#text'
    ? (node as DefaultTreeAdapterTypes.TextNode).value
    : isElement(node)
      ? node.childNodes.map(textContent).join('')
      : '';

const paragraph = (content: RichTextNode[]): RichTextNode =>
  content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };

const newSink = (textblock: Sink['textblock'] = paragraph): Sink => ({ blocks: [], inline: [], textblock });

const sameMarks = (left: RichTextNode['marks'], right: RichTextNode['marks']) =>
  JSON.stringify(left ?? []) === JSON.stringify(right ?? []);

/** HTML whitespace rules for one textblock: collapse runs, trim the edges and around hard breaks, merge texts. */
const normalizeInline = (nodes: readonly RichTextNode[]): RichTextNode[] => {
  const out: RichTextNode[] = [];
  let atLineStart = true;
  for (const node of nodes) {
    if (node.type !== 'text') {
      const last = out.at(-1);
      if (node.type === 'hardBreak' && last?.type === 'text' && last.text) {
        last.text = last.text.replace(/ +$/, '');
      }
      out.push(node);
      atLineStart = node.type === 'hardBreak';
      continue;
    }
    let text = (node.text ?? '').replace(/[ \t\n\r\f]+/g, ' ');
    if (atLineStart) {
      text = text.replace(/^ +/, '');
    }
    if (text.length === 0) {
      continue;
    }
    atLineStart = text.endsWith(' ');
    const last = out.at(-1);
    if (last?.type === 'text' && sameMarks(last.marks, node.marks)) {
      last.text = `${last.text ?? ''}${text}`;
    } else {
      out.push(node.marks ? { type: 'text', text, marks: node.marks } : { type: 'text', text });
    }
  }
  const last = out.at(-1);
  if (last?.type === 'text' && last.text) {
    last.text = last.text.replace(/ +$/, '');
  }
  return out.filter((node) => node.type !== 'text' || (node.text ?? '').length > 0);
};

/** Ends the current textblock. Blocks with no visible text (e.g. `<p>&nbsp;</p>`: `trim` covers U+00A0) are dropped. */
const flush = (sink: Sink) => {
  const content = normalizeInline(sink.inline);
  sink.inline = [];
  const visible = content.some((node) => node.type !== 'text' || (node.text ?? '').trim().length > 0);
  if (visible) {
    sink.blocks.push(sink.textblock(content));
  }
};

const withMark = (marks: readonly Mark[], mark: Mark): Mark[] => [
  ...marks.filter((existing) => existing.type !== mark.type),
  mark,
];

const linkMark = (element: Element, context: Context): Mark | undefined => {
  const href = attrOf(element, 'href')?.trim();
  if (!href) {
    return undefined;
  }
  if (href.length > 2048 || !SAFE_LINK_PATTERN.test(href)) {
    context.warnings.push({ code: 'unsafeLink', detail: href.slice(0, 200) });
    return undefined;
  }
  const target = attrOf(element, 'target') === '_blank' ? '_blank' : null;
  return { type: 'link', attrs: { href, target, rel: null, class: null } };
};

const clip = (value: string | null) => (value === null ? null : value.slice(0, MAX_ATTR_TEXT));

const imageNode = (element: Element, context: Context): RichTextNode | undefined => {
  const src = attrOf(element, 'src')?.trim() ?? '';
  const image: HtmlImage = { src, alt: clip(attrOf(element, 'alt')), title: clip(attrOf(element, 'title')) };
  const mediaId = src ? context.options.resolveImage?.(image) : undefined;
  if (!mediaId) {
    context.warnings.push({ code: 'imageUnresolved', detail: src.slice(0, 500) });
    return undefined;
  }
  return { type: 'image', attrs: { mediaId, alt: image.alt, title: image.title } };
};

const listItems = (element: Element, context: Context, depth: number): RichTextNode[] => {
  const items: RichTextNode[] = [];
  let stray: ChildNode[] = [];
  const pushItem = (nodes: ChildNode[]) => {
    const content = convertChildren(nodes, context, depth + 2);
    if (content.length > 0 || nodes.some(isElement)) {
      items.push({ type: 'listItem', content: content.length > 0 ? content : [paragraph([])] });
    }
  };
  for (const child of element.childNodes) {
    if (isElement(child) && child.tagName === 'li') {
      if (stray.length > 0) {
        pushItem(stray);
        stray = [];
      }
      pushItem(child.childNodes);
    } else if (textContent(child).trim().length > 0 || isElement(child)) {
      stray.push(child);
    }
  }
  if (stray.length > 0) {
    pushItem(stray);
  }
  return items;
};

const listNode = (element: Element, context: Context, depth: number): RichTextNode[] => {
  const items = listItems(element, context, depth);
  if (items.length === 0) {
    return [];
  }
  if (element.tagName === 'ul') {
    return [{ type: 'bulletList', content: items }];
  }
  const start = Number.parseInt(attrOf(element, 'start') ?? '1', 10);
  const type = attrOf(element, 'type');
  return [
    {
      type: 'orderedList',
      attrs: {
        start: Number.isInteger(start) && start >= 0 && start <= 1_000_000 ? start : 1,
        type: type !== null && LIST_TYPES.has(type) ? type : null,
      },
      content: items,
    },
  ];
};

const codeLanguage = (element: Element): string | null => {
  const code = element.childNodes.find(
    (child): child is Element => isElement(child) && child.tagName === 'code',
  );
  const classes = `${attrOf(element, 'class') ?? ''} ${code ? (attrOf(code, 'class') ?? '') : ''}`;
  const language = /(?:^|\s)(?:language|lang)-(\S+)/.exec(classes)?.[1] ?? null;
  return language !== null && LANGUAGE_PATTERN.test(language) ? language : null;
};

const codeBlockNode = (element: Element): RichTextNode => {
  const text = textContent(element).replace(/\r\n?/g, '\n').replace(/\n$/, '');
  return {
    type: 'codeBlock',
    attrs: { language: codeLanguage(element) },
    ...(text.length > 0 ? { content: [{ type: 'text', text }] } : {}),
  };
};

const CELL_SPAN_MAX = 1000;

const span = (element: Element, name: string) => {
  const value = Number.parseInt(attrOf(element, name) ?? '1', 10);
  return Number.isInteger(value) && value >= 1 && value <= CELL_SPAN_MAX ? value : 1;
};

const tableRows = (element: Element): Element[] =>
  element.childNodes.filter(isElement).flatMap((child) => {
    if (child.tagName === 'tr') {
      return [child];
    }
    return ['thead', 'tbody', 'tfoot'].includes(child.tagName) ? tableRows(child) : [];
  });

const tableNodes = (element: Element, context: Context, depth: number): RichTextNode[] => {
  const caption = element.childNodes.find(
    (child): child is Element => isElement(child) && child.tagName === 'caption',
  );
  const rows = tableRows(element).flatMap((row): RichTextNode[] => {
    const cells = row.childNodes
      .filter((cell): cell is Element => isElement(cell) && (cell.tagName === 'td' || cell.tagName === 'th'))
      .map((cell): RichTextNode => {
        const content = convertChildren(cell.childNodes, context, depth + 3);
        return {
          type: cell.tagName === 'th' ? 'tableHeader' : 'tableCell',
          attrs: { colspan: span(cell, 'colspan'), rowspan: span(cell, 'rowspan'), colwidth: null },
          content: content.length > 0 ? content : [paragraph([])],
        };
      });
    return cells.length > 0 ? [{ type: 'tableRow', content: cells }] : [];
  });
  return [
    ...(caption ? convertChildren([caption], context, depth) : []),
    ...(rows.length > 0 ? [{ type: 'table', content: rows }] : []),
  ];
};

/** A block-level element → zero or more blocks. Undefined when the element is not block-level. */
const convertBlock = (element: Element, context: Context, depth: number): RichTextNode[] | undefined => {
  const tag = element.tagName;
  const nested = depth < MAX_BLOCK_DEPTH;
  const level = HEADING_LEVELS[tag];
  if (level !== undefined) {
    const sink = newSink((content) => ({
      type: 'heading',
      attrs: { level },
      ...(content.length > 0 ? { content } : {}),
    }));
    walkChildren(element.childNodes, sink, [], context, depth);
    flush(sink);
    return sink.blocks;
  }
  if (
    PARAGRAPH_TAGS.has(tag) ||
    CONTAINER_TAGS.has(tag) ||
    (!nested && (tag === 'blockquote' || tag === 'ul' || tag === 'ol'))
  ) {
    return convertChildren(element.childNodes, context, depth);
  }
  switch (tag) {
    case 'blockquote': {
      const content = convertChildren(element.childNodes, context, depth + 1);
      return content.length > 0 ? [{ type: 'blockquote', content }] : [];
    }
    case 'ul':
    case 'ol':
      return listNode(element, context, depth);
    case 'pre':
      return [codeBlockNode(element)];
    case 'hr':
      return [{ type: 'horizontalRule' }];
    case 'table':
      return nested
        ? tableNodes(element, context, depth)
        : convertChildren(element.childNodes, context, depth);
    default:
      return undefined;
  }
};

/** Walks nodes in inline context, adding text to the sink and ending its textblock at every block element. */
const walkChildren = (
  nodes: readonly ChildNode[],
  sink: Sink,
  marks: readonly Mark[],
  context: Context,
  depth: number,
) => {
  for (const node of nodes) {
    if (node.nodeName === '#text') {
      const text = (node as DefaultTreeAdapterTypes.TextNode).value;
      sink.inline.push(marks.length > 0 ? { type: 'text', text, marks: [...marks] } : { type: 'text', text });
      continue;
    }
    if (isElement(node)) {
      walkElement(node, sink, marks, context, depth);
    }
  }
};

const walkElement = (
  element: Element,
  sink: Sink,
  marks: readonly Mark[],
  context: Context,
  depth: number,
) => {
  const tag = element.tagName;
  if (SILENT_DROP_TAGS.has(tag)) {
    return;
  }
  if (EMBED_TAGS.has(tag)) {
    context.warnings.push({ code: 'embedDropped', detail: tag });
    return;
  }
  if (tag === 'br') {
    sink.inline.push({ type: 'hardBreak' });
    return;
  }
  if (tag === 'img') {
    const image = imageNode(element, context);
    if (image) {
      flush(sink);
      sink.blocks.push(image);
    }
    return;
  }
  const blocks = convertBlock(element, context, depth);
  if (blocks) {
    flush(sink);
    sink.blocks.push(...blocks);
    return;
  }
  const markType = MARK_TAGS[tag];
  const mark = markType ? { type: markType } : tag === 'a' ? linkMark(element, context) : undefined;
  walkChildren(element.childNodes, sink, mark ? withMark(marks, mark) : marks, context, depth);
};

/** Converts nodes in block context: loose inline content becomes paragraphs. */
const convertChildren = (nodes: readonly ChildNode[], context: Context, depth: number): RichTextNode[] => {
  const sink = newSink();
  walkChildren(nodes, sink, [], context, depth);
  flush(sink);
  return sink.blocks;
};

const envelope = (content: RichTextNode[]): RichTextDocument => ({
  format: RICHTEXT_FORMAT,
  version: RICHTEXT_FORMAT_VERSION,
  doc: content.length > 0 ? { type: 'doc', content } : { type: 'doc' },
});

/** Converts an HTML fragment to a validated rich-text document, with what was lost on the way. */
export const htmlToRichText = (html: string, options: HtmlToRichTextOptions = {}): HtmlToRichTextResult => {
  const context: Context = { options, warnings: [] };
  const blocks = convertChildren(parseFragment(html).childNodes, context, 1);
  const result = validateRichText(envelope(blocks));
  if (result.ok) {
    return { document: result.document, warnings: context.warnings };
  }
  // A converter bug, never expected: keep the text rather than lose the content.
  context.warnings.push({ code: 'invalidOutput', detail: JSON.stringify(result.problems.slice(0, 3)) });
  const text = parseFragment(html).childNodes.map(textContent).join('').replace(/\s+/g, ' ').trim();
  const fallback = validateRichText(envelope(text ? [paragraph([{ type: 'text', text }])] : []));
  if (!fallback.ok) {
    throw new Error('Rich-text fallback document is invalid');
  }
  return { document: fallback.document, warnings: context.warnings };
};

/** Every `<img>` in a fragment (in document order), so an importer can fetch them before converting. */
export const collectHtmlImages = (html: string): HtmlImage[] => {
  const images: HtmlImage[] = [];
  const walk = (node: ChildNode) => {
    if (!isElement(node)) {
      return;
    }
    if (node.tagName === 'img') {
      const src = attrOf(node, 'src')?.trim();
      if (src) {
        images.push({ src, alt: clip(attrOf(node, 'alt')), title: clip(attrOf(node, 'title')) });
      }
    }
    node.childNodes.forEach(walk);
  };
  parseFragment(html).childNodes.forEach(walk);
  return images;
};
