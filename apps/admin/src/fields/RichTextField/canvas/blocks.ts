import type { Editor, JSONContent, Range } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import {
  Code2,
  Heading2,
  Heading3,
  Image,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Table,
  type LucideIcon,
} from 'lucide-react';

/** The block types the `+` and `/` menus offer inside rich text (exactly what the stored format holds). */
export const BLOCK_TYPES = [
  'paragraph',
  'heading2',
  'heading3',
  'blockquote',
  'bulletList',
  'orderedList',
  'codeBlock',
  'horizontalRule',
  'image',
  'table',
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type BlockGroup = 'write' | 'media';

type BlockLabelKey =
  | 'entry.blocks.paragraph'
  | 'entry.blocks.heading'
  | 'entry.blocks.subheading'
  | 'entry.blocks.quote'
  | 'entry.blocks.bulletList'
  | 'entry.blocks.orderedList'
  | 'entry.blocks.code'
  | 'entry.blocks.divider'
  | 'entry.blocks.image'
  | 'entry.blocks.table';

export type BlockOption = {
  type: BlockType;
  icon: LucideIcon;
  /** Translation key of the label. */
  labelKey: BlockLabelKey;
  group: BlockGroup;
  /** Extra words the `/` filter matches (English and the API's names). */
  keywords: readonly string[];
};

export const BLOCK_OPTIONS: readonly BlockOption[] = [
  {
    type: 'paragraph',
    icon: Pilcrow,
    labelKey: 'entry.blocks.paragraph',
    group: 'write',
    keywords: ['text', 'p'],
  },
  {
    type: 'heading2',
    icon: Heading2,
    labelKey: 'entry.blocks.heading',
    group: 'write',
    keywords: ['h2', 'title'],
  },
  { type: 'heading3', icon: Heading3, labelKey: 'entry.blocks.subheading', group: 'write', keywords: ['h3'] },
  {
    type: 'blockquote',
    icon: Quote,
    labelKey: 'entry.blocks.quote',
    group: 'write',
    keywords: ['blockquote', 'cite'],
  },
  {
    type: 'bulletList',
    icon: List,
    labelKey: 'entry.blocks.bulletList',
    group: 'write',
    keywords: ['ul', 'list', 'bullet'],
  },
  {
    type: 'orderedList',
    icon: ListOrdered,
    labelKey: 'entry.blocks.orderedList',
    group: 'write',
    keywords: ['ol', 'list', 'number'],
  },
  {
    type: 'codeBlock',
    icon: Code2,
    labelKey: 'entry.blocks.code',
    group: 'write',
    keywords: ['pre', 'code'],
  },
  {
    type: 'horizontalRule',
    icon: Minus,
    labelKey: 'entry.blocks.divider',
    group: 'write',
    keywords: ['hr', 'rule', 'line'],
  },
  {
    type: 'image',
    icon: Image,
    labelKey: 'entry.blocks.image',
    group: 'media',
    keywords: ['picture', 'photo', 'img'],
  },
  { type: 'table', icon: Table, labelKey: 'entry.blocks.table', group: 'media', keywords: ['grid'] },
];

/** Options whose label or keywords start with the query (case-insensitive); all for an empty query. */
export const filterBlockOptions = (
  query: string,
  labelOf: (option: BlockOption) => string,
): BlockOption[] => {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return [...BLOCK_OPTIONS];
  }
  return BLOCK_OPTIONS.filter((option) =>
    [labelOf(option), ...option.keywords].some((word) =>
      word
        .toLowerCase()
        .split(/\s+/)
        .some((part) => part.startsWith(needle)),
    ),
  );
};

const NEW_TABLE: JSONContent = {
  type: 'table',
  content: [
    {
      type: 'tableRow',
      content: [0, 1, 2].map(() => ({ type: 'tableHeader', content: [{ type: 'paragraph' }] })),
    },
    ...[0, 1].map(() => ({
      type: 'tableRow',
      content: [0, 1, 2].map(() => ({ type: 'tableCell', content: [{ type: 'paragraph' }] })),
    })),
  ],
};

/** A new, empty block of a type (images are inserted from the picker instead). */
export const emptyBlock = (type: Exclude<BlockType, 'image'>): JSONContent[] => {
  switch (type) {
    case 'paragraph':
      return [{ type: 'paragraph' }];
    case 'heading2':
      return [{ type: 'heading', attrs: { level: 2 } }];
    case 'heading3':
      return [{ type: 'heading', attrs: { level: 3 } }];
    case 'blockquote':
      return [{ type: 'blockquote', content: [{ type: 'paragraph' }] }];
    case 'bulletList':
    case 'orderedList':
      return [{ type, content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] }];
    case 'codeBlock':
      return [{ type: 'codeBlock' }];
    case 'horizontalRule':
      // A rule is an atom: a paragraph after it keeps the cursor somewhere to type.
      return [{ type: 'horizontalRule' }, { type: 'paragraph' }];
    case 'table':
      return [NEW_TABLE];
  }
};

export type PickedImage = { mediaId: string; alt: string | null };

/** Images as nodes of the stored format (a media reference plus alt text, ADR 0003). */
const imageNodes = (images: readonly PickedImage[]): JSONContent[] =>
  images.map((image) => ({
    type: 'image',
    attrs: { mediaId: image.mediaId, alt: image.alt || null, title: null },
  }));

/**
 * Inserts a block at a document position (between top-level blocks), or in place of a range (an empty
 * paragraph it replaces), and puts the cursor inside it. Images come from `pickImages` (the library sheet);
 * nothing is inserted when it is cancelled.
 */
export const insertBlockAt = async (
  editor: Editor,
  type: BlockType,
  target: number | Range,
  pickImages: () => Promise<PickedImage[]>,
) => {
  const content = type === 'image' ? imageNodes(await pickImages()) : emptyBlock(type);
  if (content.length === 0 || editor.isDestroyed) {
    return;
  }
  const size = editor.state.doc.content.size;
  const clamp = (pos: number) => Math.min(Math.max(pos, 0), size);
  const range = typeof target === 'number' ? { from: clamp(target), to: clamp(target) } : target;
  editor.chain().insertContentAt(range, content, { updateSelection: true }).focus().run();
  if (type !== 'image') {
    // Into the first textblock of what was inserted (a list's paragraph, a table's first cell).
    editor.commands.command(({ tr }) => {
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(range.from + 1, tr.doc.content.size)), 1));
      return true;
    });
  }
};

/** Where a block goes at the start or end of a document: an empty paragraph there is replaced. */
export const edgeTarget = (editor: Editor, at: 'start' | 'end'): number | Range => {
  const { doc } = editor.state;
  const edge = at === 'start' ? doc.firstChild : doc.lastChild;
  if (edge?.type.name === 'paragraph' && edge.content.size === 0) {
    return at === 'start'
      ? { from: 0, to: edge.nodeSize }
      : { from: doc.content.size - edge.nodeSize, to: doc.content.size };
  }
  return at === 'start' ? 0 : doc.content.size;
};

/**
 * Turns the block the cursor is in into another type, after removing the `/query` that asked for it. Wraps
 * (quote, lists) and replaces (headings, code) like the toolbar does; rules, images and tables are inserted
 * after the cursor's block.
 */
export const turnInto = async (
  editor: Editor,
  type: BlockType,
  range: Range,
  pickImages: () => Promise<PickedImage[]>,
) => {
  editor.chain().focus().deleteRange(range).run();
  const chain = () => editor.chain().focus();
  switch (type) {
    case 'paragraph':
      chain().setParagraph().run();
      return;
    case 'heading2':
      chain().setHeading({ level: 2 }).run();
      return;
    case 'heading3':
      chain().setHeading({ level: 3 }).run();
      return;
    case 'blockquote':
      chain().toggleBlockquote().run();
      return;
    case 'bulletList':
      chain().toggleBulletList().run();
      return;
    case 'orderedList':
      chain().toggleOrderedList().run();
      return;
    case 'codeBlock':
      chain().toggleCodeBlock().run();
      return;
    case 'horizontalRule':
      chain().setHorizontalRule().run();
      return;
    case 'image': {
      const images = await pickImages();
      if (images.length > 0) {
        chain().insertContent(imageNodes(images)).run();
      }
      return;
    }
    case 'table':
      chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      return;
  }
};
