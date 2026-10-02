import { isStableId } from '@shapio/schema';

/**
 * The rich-text document schema (ADR 0003, build plan §3.9): the baseline Tiptap/ProseMirror node and mark
 * set, as data. The server validates stored documents against it and renders HTML from it; the admin's
 * Tiptap editor (package F) must produce exactly these nodes, marks and attributes. Anything else is
 * rejected, never stripped silently.
 *
 * Why a hand-written structural check instead of `@tiptap/core` headless: the baseline is small and fixed,
 * the check needs no DOM shim, no extra runtime dependency on the server and no schema instantiation per
 * request, and it reports precise paths. Package F keeps the editor in step with this module (it is the
 * contract), and the shared JSON fixtures in this module's tests are what both sides agree on.
 */

export type AttrRule = {
  /** Returns true when the value is acceptable. `null` is checked like any other value. */
  check: (value: unknown) => boolean;
  /** Used when the attribute is absent. */
  default: unknown;
};

export type NodeRule = {
  /** `block` nodes sit in block containers; `inline` nodes in textblocks. */
  group: 'block' | 'inline' | 'listItem' | 'tableRow' | 'tableCell' | 'doc';
  /** Allowed child groups or node types, and the minimum number of children. */
  content?: { allow: readonly string[]; min: number };
  attrs?: Readonly<Record<string, AttrRule>>;
  /** Inline children may carry marks (text nodes in a textblock); false for code blocks. */
  marks?: boolean;
};

const isNullOrString = (max: number) => (value: unknown) =>
  value === null || (typeof value === 'string' && value.length <= max);
const isIntegerIn = (min: number, max: number) => (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** `href` values a link may carry: web, mail and phone links, and same-document/relative paths. */
export const SAFE_LINK_PATTERN = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;
const isSafeHref = (value: unknown) =>
  typeof value === 'string' && value.length <= 2048 && SAFE_LINK_PATTERN.test(value.trim());

const CELL_ATTRS: Readonly<Record<string, AttrRule>> = {
  colspan: { check: isIntegerIn(1, 1000), default: 1 },
  rowspan: { check: isIntegerIn(1, 1000), default: 1 },
  colwidth: {
    check: (value) =>
      value === null || (Array.isArray(value) && value.every((width) => isIntegerIn(0, 100_000)(width))),
    default: null,
  },
};

export const NODE_RULES: Readonly<Record<string, NodeRule>> = {
  doc: { group: 'doc', content: { allow: ['block'], min: 0 } },
  paragraph: { group: 'block', content: { allow: ['inline'], min: 0 }, marks: true },
  heading: {
    group: 'block',
    content: { allow: ['inline'], min: 0 },
    marks: true,
    attrs: { level: { check: isIntegerIn(1, 6), default: 1 } },
  },
  blockquote: { group: 'block', content: { allow: ['block'], min: 1 } },
  bulletList: { group: 'block', content: { allow: ['listItem'], min: 1 } },
  orderedList: {
    group: 'block',
    content: { allow: ['listItem'], min: 1 },
    attrs: {
      start: { check: isIntegerIn(0, 1_000_000), default: 1 },
      type: {
        check: (value) => value === null || ['1', 'a', 'A', 'i', 'I'].includes(value as string),
        default: null,
      },
    },
  },
  listItem: { group: 'listItem', content: { allow: ['block'], min: 1 } },
  codeBlock: {
    group: 'block',
    content: { allow: ['text'], min: 0 },
    marks: false,
    attrs: {
      language: {
        check: (value) =>
          value === null || (typeof value === 'string' && /^[A-Za-z0-9_+#.-]{1,32}$/.test(value)),
        default: null,
      },
    },
  },
  horizontalRule: { group: 'block' },
  image: {
    group: 'block',
    attrs: {
      // A media library reference, never a URL: delivery resolves it so private media stays private.
      mediaId: { check: isStableId, default: undefined },
      alt: { check: isNullOrString(1000), default: null },
      title: { check: isNullOrString(1000), default: null },
    },
  },
  table: { group: 'block', content: { allow: ['tableRow'], min: 1 } },
  tableRow: { group: 'tableRow', content: { allow: ['tableCell'], min: 1 } },
  tableHeader: { group: 'tableCell', content: { allow: ['block'], min: 1 }, attrs: CELL_ATTRS },
  tableCell: { group: 'tableCell', content: { allow: ['block'], min: 1 }, attrs: CELL_ATTRS },
  text: { group: 'inline' },
  hardBreak: { group: 'inline' },
};

export type MarkRule = { attrs?: Readonly<Record<string, AttrRule>> };

export const MARK_RULES: Readonly<Record<string, MarkRule>> = {
  bold: {},
  italic: {},
  code: {},
  link: {
    attrs: {
      href: { check: isSafeHref, default: undefined },
      target: { check: (value) => value === null || value === '_blank', default: null },
      rel: { check: isNullOrString(200), default: null },
      class: { check: (value) => value === null, default: null },
    },
  },
};

/** Nesting deeper than this is rejected (keeps validation and rendering bounded). */
export const MAX_RICHTEXT_DEPTH = 40;
