import type { RichTextValue } from '@shapio/editor-sdk';
import { RICHTEXT_FORMAT, RICHTEXT_FORMAT_VERSION } from '@shapio/schema';
import type { JSONContent } from '@tiptap/core';
import { isEmptyValue, isRecord } from '../helpers/values';

/**
 * The stored rich-text envelope (ADR 0003): `{ format: 'shapio-richtext', version, doc }`, where `doc` is
 * ProseMirror JSON limited to the node and mark set in `packages/schema/src/richtext/spec.ts`.
 */
export type ProseMirrorDoc = JSONContent & { type: 'doc' };

export const EMPTY_DOC: ProseMirrorDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Upgrades a document saved in an older format version, one version at a time. A format change is also a
 * schema change with a server-side conversion job (ADR 0003), so stored content is converted there; this
 * hook lets the editor open drafts that have not been converted yet. Version 1 is the first format.
 */
export const RICHTEXT_MIGRATIONS: Readonly<Record<number, (doc: ProseMirrorDoc) => ProseMirrorDoc>> = {};

export type PreparedRichText =
  | { status: 'ok'; doc: ProseMirrorDoc }
  /** Saved by a newer Shapio: shown read-only so nothing is lost by re-saving it in the old format. */
  | { status: 'newer'; doc: ProseMirrorDoc; version: number }
  | { status: 'unreadable'; doc: ProseMirrorDoc };

const paragraphsOf = (text: string): ProseMirrorDoc => ({
  type: 'doc',
  content: text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text: block }] })),
});

const isDoc = (value: unknown): value is ProseMirrorDoc => isRecord(value) && value.type === 'doc';

/** A stored value → a document the editor can open (migrating older versions). */
export const prepareRichText = (value: unknown): PreparedRichText => {
  if (isEmptyValue(value)) {
    return { status: 'ok', doc: EMPTY_DOC };
  }
  // Plain text (e.g. a draft written before the field became rich text) becomes paragraphs.
  if (typeof value === 'string') {
    return { status: 'ok', doc: paragraphsOf(value) };
  }
  if (
    !isRecord(value) ||
    value.format !== RICHTEXT_FORMAT ||
    !isDoc(value.doc) ||
    typeof value.version !== 'number'
  ) {
    return { status: 'unreadable', doc: EMPTY_DOC };
  }
  if (value.version > RICHTEXT_FORMAT_VERSION) {
    return { status: 'newer', doc: value.doc, version: value.version };
  }
  let doc = value.doc;
  for (let version = value.version; version < RICHTEXT_FORMAT_VERSION; version += 1) {
    const migrate = RICHTEXT_MIGRATIONS[version];
    if (!migrate) {
      return { status: 'unreadable', doc: EMPTY_DOC };
    }
    doc = migrate(doc);
  }
  return { status: 'ok', doc };
};

/** Editor JSON → the stored value (null when the document is empty, which the server treats as no value). */
export const toRichTextValue = (doc: ProseMirrorDoc): RichTextValue | null => {
  const value = { format: RICHTEXT_FORMAT, version: RICHTEXT_FORMAT_VERSION, doc } as RichTextValue;
  return isEmptyValue(value) ? null : value;
};

/** `href`s a link may carry (the server's `SAFE_LINK_PATTERN`): web, mail, phone, relative and anchors. */
export const SAFE_LINK_PATTERN = /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i;

/** What someone typed into the link box → a safe href (`example.com` becomes `https://example.com`). */
export const normalizeHref = (text: string): string | null => {
  const trimmed = text.trim();
  if (trimmed === '') {
    return null;
  }
  if (SAFE_LINK_PATTERN.test(trimmed)) {
    return trimmed;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return null;
  }
  return `https://${trimmed}`;
};

/**
 * Pasted HTML, before ProseMirror parses it against the schema (which already drops every node, mark and
 * attribute Shapio does not store): remove scripts, styles, comments and Office markup outright, so none
 * of their text leaks into the document.
 */
export const sanitizePastedHtml = (html: string): string =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|template|iframe|object|noscript)[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<\/?(meta|link|base|o:p|xml)[^>]*>/gi, '');
