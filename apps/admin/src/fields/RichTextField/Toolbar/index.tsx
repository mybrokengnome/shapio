import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  Code,
  Image,
  Italic,
  List,
  ListOrdered,
  Minus,
  Quote,
  Redo2,
  Subscript,
  Superscript,
  Underline,
  Undo2,
} from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { LinkPopover } from '../LinkPopover';
import { TableMenu } from '../TableMenu';
import { ToolButton } from '../ToolButton';

type ToolbarProps = {
  editor: Editor;
  minimal: boolean;
  disabled: boolean;
  linkOpen: boolean;
  onLinkOpenChange: (open: boolean) => void;
  onInsertImage: () => void;
};

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
type BlockType = 'paragraph' | `h${(typeof HEADING_LEVELS)[number]}` | 'codeBlock';

const BLOCK_LABEL_KEYS = {
  paragraph: 'content.richText.paragraph',
  h1: 'content.richText.heading1',
  h2: 'content.richText.heading2',
  h3: 'content.richText.heading3',
  h4: 'content.richText.heading4',
  h5: 'content.richText.heading5',
  h6: 'content.richText.heading6',
  codeBlock: 'content.richText.codeBlock',
} as const satisfies Record<BlockType, string>;

const blockTypeOf = (editor: Editor): BlockType => {
  if (editor.isActive('codeBlock')) {
    return 'codeBlock';
  }
  const level = HEADING_LEVELS.find((candidate) => editor.isActive('heading', { level: candidate }));
  return level ? `h${level}` : 'paragraph';
};

const setBlockType = (editor: Editor, type: BlockType) => {
  const chain = editor.chain();
  if (type === 'paragraph') {
    chain.setParagraph().run();
  } else if (type === 'codeBlock') {
    chain.toggleCodeBlock().run();
  } else {
    chain.setHeading({ level: Number(type.slice(1)) as (typeof HEADING_LEVELS)[number] }).run();
  }
};

/** Formatting controls. Every action also has Tiptap's keyboard shortcut, shown in its tooltip. */
export const Toolbar = ({
  editor,
  minimal,
  disabled,
  linkOpen,
  onLinkOpenChange,
  onInsertImage,
}: ToolbarProps) => {
  const { t } = useTranslation();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      block: blockTypeOf(current),
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      underline: current.isActive('underline'),
      subscript: current.isActive('subscript'),
      superscript: current.isActive('superscript'),
      code: current.isActive('code'),
      link: current.isActive('link'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      blockquote: current.isActive('blockquote'),
      table: current.isActive('table'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });
  // A block type was chosen: the select closes back to the text, not to its own trigger, so typing (and
  // Mod+B) carries on where the cursor was. Escape without a choice leaves focus on the select as usual.
  const blockChosen = useRef(false);
  const chain = () => editor.chain().focus();
  return (
    <div
      role="toolbar"
      aria-label={t('content.richText.toolbar')}
      // Sticks under the screen's sticky chrome (`--field-sticky-top`, set by the entry) while the field is in
      // view; opaque (the card under the muted tint) so the text scrolling beneath doesn't show through.
      className="sticky top-[var(--field-sticky-top,0px)] z-10 flex min-h-9 flex-wrap items-center gap-0.5 border-b bg-card bg-linear-to-r from-muted/40 to-muted/40 px-1 dark:bg-background"
    >
      {!minimal ? (
        <>
          <Select
            value={state.block}
            disabled={disabled}
            onValueChange={(value) => {
              blockChosen.current = true;
              setBlockType(editor, value as BlockType);
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t('content.richText.blockType')}
              className="w-36 border-transparent bg-transparent shadow-none dark:bg-transparent"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              onCloseAutoFocus={(event) => {
                if (blockChosen.current) {
                  blockChosen.current = false;
                  event.preventDefault();
                  editor.commands.focus();
                }
              }}
            >
              {(Object.keys(BLOCK_LABEL_KEYS) as BlockType[]).map((type) => (
                <SelectItem key={type} value={type}>
                  {t(BLOCK_LABEL_KEYS[type])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Separator orientation="vertical" className="mx-1 h-5" />
        </>
      ) : null}
      <ToolButton
        icon={Bold}
        label={t('content.richText.bold')}
        keys="Mod+B"
        pressed={state.bold}
        disabled={disabled}
        onClick={() => chain().toggleBold().run()}
      />
      <ToolButton
        icon={Italic}
        label={t('content.richText.italic')}
        keys="Mod+I"
        pressed={state.italic}
        disabled={disabled}
        onClick={() => chain().toggleItalic().run()}
      />
      <ToolButton
        icon={Underline}
        label={t('content.richText.underline')}
        keys="Mod+U"
        pressed={state.underline}
        disabled={disabled}
        onClick={() => chain().toggleUnderline().run()}
      />
      {!minimal ? (
        <>
          <ToolButton
            icon={Subscript}
            label={t('content.richText.subscript')}
            keys="Mod+,"
            pressed={state.subscript}
            disabled={disabled}
            onClick={() => chain().toggleSubscript().run()}
          />
          <ToolButton
            icon={Superscript}
            label={t('content.richText.superscript')}
            keys="Mod+."
            pressed={state.superscript}
            disabled={disabled}
            onClick={() => chain().toggleSuperscript().run()}
          />
          <ToolButton
            icon={Code}
            label={t('content.richText.code')}
            keys="Mod+E"
            pressed={state.code}
            disabled={disabled}
            onClick={() => chain().toggleCode().run()}
          />
        </>
      ) : null}
      <LinkPopover
        editor={editor}
        active={state.link}
        disabled={disabled}
        open={linkOpen}
        onOpenChange={onLinkOpenChange}
      />
      <Separator orientation="vertical" className="mx-1 h-5" />
      <ToolButton
        icon={List}
        label={t('content.richText.bulletList')}
        hint={t('content.richText.listJoinHint')}
        keys="Mod+Shift+8"
        pressed={state.bulletList}
        disabled={disabled}
        onClick={() => chain().toggleBulletList().run()}
      />
      <ToolButton
        icon={ListOrdered}
        label={t('content.richText.orderedList')}
        hint={t('content.richText.listJoinHint')}
        keys="Mod+Shift+7"
        pressed={state.orderedList}
        disabled={disabled}
        onClick={() => chain().toggleOrderedList().run()}
      />
      {!minimal ? (
        <>
          <ToolButton
            icon={Quote}
            label={t('content.richText.blockquote')}
            keys="Mod+Shift+B"
            pressed={state.blockquote}
            disabled={disabled}
            onClick={() => chain().toggleBlockquote().run()}
          />
          <Separator orientation="vertical" className="mx-1 h-5" />
          <ToolButton
            icon={Image}
            label={t('content.richText.image')}
            disabled={disabled}
            onClick={onInsertImage}
          />
          <TableMenu editor={editor} inTable={state.table} disabled={disabled} />
          <ToolButton
            icon={Minus}
            label={t('content.richText.horizontalRule')}
            disabled={disabled}
            onClick={() => chain().setHorizontalRule().run()}
          />
        </>
      ) : null}
      <span className="ml-auto flex">
        <ToolButton
          icon={Undo2}
          label={t('content.richText.undo')}
          keys="Mod+Z"
          disabled={disabled || !state.canUndo}
          onClick={() => chain().undo().run()}
        />
        <ToolButton
          icon={Redo2}
          label={t('content.richText.redo')}
          keys="Mod+Shift+Z"
          disabled={disabled || !state.canRedo}
          onClick={() => chain().redo().run()}
        />
      </span>
    </div>
  );
};
