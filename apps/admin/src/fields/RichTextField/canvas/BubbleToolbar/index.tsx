import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import { useEditorState } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Bold, Code, Heading2, Heading3, Italic, Link, List, Quote, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Separator } from '@/components/ui/separator';
import { ToolButton } from '../../ToolButton';

type BubbleToolbarProps = {
  editor: Editor;
  onLink: () => void;
  /** "Rewrite…" with the instance's model (only while assist is on). */
  onRewrite?: () => void;
};

/** Text is selected (not an image or rule, not inside code): the floating toolbar has something to do. */
const hasTextSelection = ({ editor }: { editor: Editor }) => {
  const { selection } = editor.state;
  return (
    editor.isEditable &&
    !selection.empty &&
    !(selection instanceof NodeSelection) &&
    !editor.isActive('codeBlock')
  );
};

/** Formatting for the selected text, floating above it (Ghost/Notion style); every action has a shortcut. */
export const BubbleToolbar = ({ editor, onLink, onRewrite }: BubbleToolbarProps) => {
  const { t } = useTranslation();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      code: current.isActive('code'),
      link: current.isActive('link'),
      heading2: current.isActive('heading', { level: 2 }),
      heading3: current.isActive('heading', { level: 3 }),
      blockquote: current.isActive('blockquote'),
      bulletList: current.isActive('bulletList'),
    }),
  });
  const chain = () => editor.chain().focus();
  return (
    <BubbleMenu editor={editor} shouldShow={hasTextSelection} options={{ placement: 'top' }}>
      <div
        role="toolbar"
        aria-label={t('content.richText.toolbar')}
        className="flex items-center gap-0.5 rounded-xl border bg-popover p-1 font-sans text-popover-foreground shadow-md"
      >
        <ToolButton
          icon={Bold}
          label={t('content.richText.bold')}
          keys="Mod+B"
          pressed={state.bold}
          disabled={false}
          onClick={() => chain().toggleBold().run()}
        />
        <ToolButton
          icon={Italic}
          label={t('content.richText.italic')}
          keys="Mod+I"
          pressed={state.italic}
          disabled={false}
          onClick={() => chain().toggleItalic().run()}
        />
        <ToolButton
          icon={Code}
          label={t('content.richText.code')}
          keys="Mod+E"
          pressed={state.code}
          disabled={false}
          onClick={() => chain().toggleCode().run()}
        />
        <ToolButton
          icon={Link}
          label={t('content.richText.link')}
          keys="Mod+Shift+K"
          pressed={state.link}
          disabled={false}
          onClick={onLink}
        />
        <Separator orientation="vertical" className="mx-1 h-5" />
        <ToolButton
          icon={Heading2}
          label={t('entry.blocks.heading')}
          pressed={state.heading2}
          disabled={false}
          onClick={() => chain().toggleHeading({ level: 2 }).run()}
        />
        <ToolButton
          icon={Heading3}
          label={t('entry.blocks.subheading')}
          pressed={state.heading3}
          disabled={false}
          onClick={() => chain().toggleHeading({ level: 3 }).run()}
        />
        <ToolButton
          icon={Quote}
          label={t('content.richText.blockquote')}
          keys="Mod+Shift+B"
          pressed={state.blockquote}
          disabled={false}
          onClick={() => chain().toggleBlockquote().run()}
        />
        <ToolButton
          icon={List}
          label={t('content.richText.bulletList')}
          keys="Mod+Shift+8"
          pressed={state.bulletList}
          disabled={false}
          onClick={() => chain().toggleBulletList().run()}
        />
        {onRewrite ? (
          <>
            <Separator orientation="vertical" className="mx-1 h-5" />
            <ToolButton
              icon={Sparkles}
              label={t('assist.rewrite.open')}
              disabled={false}
              onClick={onRewrite}
            />
          </>
        ) : null}
      </div>
    </BubbleMenu>
  );
};
