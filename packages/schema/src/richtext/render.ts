import { RICHTEXT_FORMAT, RICHTEXT_FORMAT_VERSION } from '../types/valueFormats.js';
import { SAFE_LINK_PATTERN } from './spec.js';
import type { RichTextDocument, RichTextNode } from './validate.js';

/**
 * HTML rendering of stored rich text for delivery (ADR 0003). Rendered from JSON only, never from stored
 * HTML: every tag comes from this allow-list and every text and attribute value is escaped, so the output
 * is safe whatever the document held. Deterministic, so a site built at a pinned snapshot gets the same HTML.
 */

/** Resolves an image's media ID to a deliverable URL; undefined when the asset is missing or not visible. */
export type MediaUrlResolver = (mediaId: string) => string | undefined;

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);

/** Attribute values come from validated documents: strings and numbers only. */
const textOf = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

const attribute = (name: string, value: unknown) =>
  value === null || value === undefined ? '' : ` ${name}="${escapeHtml(textOf(value))}"`;

const BLOCK_TAGS: Readonly<Record<string, string>> = {
  paragraph: 'p',
  blockquote: 'blockquote',
  bulletList: 'ul',
  listItem: 'li',
  table: 'table',
  tableRow: 'tr',
  tableHeader: 'th',
  tableCell: 'td',
};

const renderMarks = (text: string, marks: RichTextNode['marks']): string =>
  (marks ?? []).reduceRight((inner, mark) => {
    switch (mark.type) {
      case 'bold':
        return `<strong>${inner}</strong>`;
      case 'italic':
        return `<em>${inner}</em>`;
      case 'code':
        return `<code>${inner}</code>`;
      case 'link': {
        const href = textOf(mark.attrs?.href).trim();
        if (!SAFE_LINK_PATTERN.test(href)) {
          return inner;
        }
        const blank = mark.attrs?.target === '_blank';
        return `<a${attribute('href', href)}${blank ? ' target="_blank" rel="noopener noreferrer nofollow"' : ''}>${inner}</a>`;
      }
      default:
        return inner;
    }
  }, escapeHtml(text));

const cellAttributes = (node: RichTextNode) => {
  const colspan = Number(node.attrs?.colspan ?? 1);
  const rowspan = Number(node.attrs?.rowspan ?? 1);
  return `${colspan > 1 ? attribute('colspan', colspan) : ''}${rowspan > 1 ? attribute('rowspan', rowspan) : ''}`;
};

const renderNode = (node: RichTextNode, resolveMedia: MediaUrlResolver | undefined): string => {
  const children = () => (node.content ?? []).map((child) => renderNode(child, resolveMedia)).join('');
  switch (node.type) {
    case 'doc':
      return children();
    case 'text':
      return renderMarks(node.text ?? '', node.marks);
    case 'hardBreak':
      return '<br>';
    case 'horizontalRule':
      return '<hr>';
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level ?? 1)));
      return `<h${level}>${children()}</h${level}>`;
    }
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return `<ol${start !== 1 ? attribute('start', start) : ''}${attribute('type', node.attrs?.type)}>${children()}</ol>`;
    }
    case 'codeBlock': {
      const language = node.attrs?.language;
      const text = (node.content ?? []).map((child) => escapeHtml(child.text ?? '')).join('');
      return `<pre><code${language ? attribute('class', `language-${textOf(language)}`) : ''}>${text}</code></pre>`;
    }
    case 'image': {
      const mediaId = textOf(node.attrs?.mediaId);
      const src = resolveMedia?.(mediaId);
      if (!src) {
        // Unknown or private-and-unsigned media renders nothing rather than a broken or leaking link.
        return '';
      }
      return `<img${attribute('src', src)}${attribute('alt', node.attrs?.alt ?? '')}${attribute('title', node.attrs?.title)}>`;
    }
    case 'table':
      return `<table><tbody>${children()}</tbody></table>`;
    case 'tableHeader':
    case 'tableCell': {
      const tag = BLOCK_TAGS[node.type] as string;
      return `<${tag}${cellAttributes(node)}>${children()}</${tag}>`;
    }
    default: {
      const tag = BLOCK_TAGS[node.type];
      return tag ? `<${tag}>${children()}</${tag}>` : '';
    }
  }
};

/** Renders a validated document to sanitized HTML. */
export const renderRichTextHtml = (document: RichTextDocument, resolveMedia?: MediaUrlResolver): string =>
  renderNode(document.doc, resolveMedia);

/** The document's text, blocks separated by blank lines (rich text → plain text conversions, search). */
export const richTextToPlainText = (document: RichTextDocument): string => {
  const blocks: string[] = [];
  const inline = (node: RichTextNode): string =>
    node.type === 'text'
      ? (node.text ?? '')
      : node.type === 'hardBreak'
        ? '\n'
        : (node.content ?? []).map(inline).join('');
  const walk = (node: RichTextNode) => {
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock') {
      blocks.push(inline(node));
      return;
    }
    (node.content ?? []).forEach(walk);
  };
  walk(document.doc);
  return blocks.join('\n\n');
};

/** Plain text → a document of paragraphs (blank lines split paragraphs; single newlines are hard breaks). */
export const plainTextToRichText = (text: string): RichTextDocument => {
  const paragraphs = text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph): RichTextNode => {
      const content = paragraph
        .split('\n')
        .flatMap((line, index): RichTextNode[] => [
          ...(index > 0 ? [{ type: 'hardBreak' }] : []),
          ...(line.length > 0 ? [{ type: 'text', text: line }] : []),
        ]);
      return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
    });
  return {
    format: RICHTEXT_FORMAT,
    version: RICHTEXT_FORMAT_VERSION,
    doc: { type: 'doc', content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }] },
  };
};
