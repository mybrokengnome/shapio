import type { Extensions, NodeViewRenderer } from '@tiptap/core';
import { Link } from '@tiptap/extension-link';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { TableCell, TableHeader, TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { StarterKit } from '@tiptap/starter-kit';
import { MediaImage } from './imageNode';
import { SAFE_LINK_PATTERN } from './richTextDocument';

/** Links: safe protocols only, no `title` attribute, and no target/rel/class unless set on purpose. */
const SafeLink = Link.extend({
  addAttributes() {
    const { title: _title, ...attributes } = (this.parent?.() ?? {}) as Record<string, never>;
    return attributes;
  },
}).configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: 'https',
  HTMLAttributes: { target: null, rel: null, class: null },
  isAllowedUri: (url) => SAFE_LINK_PATTERN.test(url.trim()),
});

/** Table cells keep `colspan`, `rowspan` and `colwidth` (resizable columns) and drop Tiptap's `align`. */
const withoutAlign = <T extends typeof TableCell | typeof TableHeader>(extension: T) =>
  extension.extend({
    addAttributes() {
      const { align: _align, ...attributes } = (this.parent?.() ?? {}) as Record<string, never>;
      return attributes;
    },
  });

/** Subscript and superscript replace each other (Tiptap's own extensions would stack them). */
const ExclusiveSubscript = Subscript.extend({ excludes: 'superscript' });
const ExclusiveSuperscript = Superscript.extend({ excludes: 'subscript' });

/**
 * The editor's schema: exactly the nodes, marks and attributes the server stores (ADR 0003,
 * `packages/schema/src/richtext/spec.ts`). Anything else (strike, colors, other pasted styles) is
 * not in the schema, so ProseMirror drops it on paste instead of the server rejecting the save. Link's
 * `title` attribute and table cells' `align` are removed for the same reason. `richTextContract.test.ts` checks the contract.
 */
export const richTextExtensions = ({
  placeholder,
  imageView,
}: { placeholder?: string; imageView?: NodeViewRenderer } = {}): Extensions => [
  StarterKit.configure({
    strike: false,
    link: false,
    heading: { levels: [1, 2, 3, 4, 5, 6] },
  }),
  SafeLink,
  ExclusiveSubscript,
  ExclusiveSuperscript,
  TableKit.configure({
    table: { resizable: true, allowTableNodeSelection: true },
    tableCell: false,
    tableHeader: false,
  }),
  withoutAlign(TableCell),
  withoutAlign(TableHeader),
  imageView ? MediaImage.extend({ addNodeView: () => imageView }) : MediaImage,
  ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
];
