import type { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAssistEnabled } from '@/api/assist';
import { logError, reportError } from '@/helpers/reportError';
import { useRegisterCanvasHandle, type CanvasFieldHandle } from '../../../form/canvasHandles';
import { useFieldsEnvironment } from '../../../form/context';
import { createRelay } from '../../../helpers/relay';
import type { BuiltInEditorProps } from '../../../types';
import { useRewriteSelection } from '../../hooks/useRewriteSelection';
import { useRichTextEditor } from '../../hooks/useRichTextEditor';
import { LinkPopover } from '../../LinkPopover';
import { Notes } from '../../Notes';
import { BlockHandle, type HoveredBlock } from '../BlockHandle';
import { topLevelBlockAt } from '../blockMove';
import { edgeTarget, insertBlockAt, turnInto, type BlockType, type PickedImage } from '../blocks';
import { BubbleToolbar } from '../BubbleToolbar';
import { canvasExtensions } from '../extensions';
import { RewritePopover } from '../RewritePopover';
import { createSlashBridge } from '../slashCommand';
import { SlashMenu } from '../SlashMenu';
import { uploadIntoEditor } from '../uploadFiles';

/**
 * The writing surface's typography: the reading face (Source Serif 4, `font-serif text-canvas`) for the
 * text, Manrope for headings, tables and code chrome. Classes on the ProseMirror root (no global CSS).
 */
const CANVAS_CLASSES = [
  'min-h-16 font-serif text-canvas text-foreground outline-none',
  // The writing surface still shows where focus is (DESIGN.md: rings everywhere), framed a little wider.
  '-mx-3 rounded-lg px-3 py-1 focus-visible:ring-[3px] focus-visible:ring-ring/50',
  '[&_h1]:mt-10 [&_h1]:mb-3 [&_h1]:font-sans [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight',
  '[&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:font-sans [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight',
  '[&_h3]:mt-8 [&_h3]:mb-2 [&_h3]:font-sans [&_h3]:text-xl [&_h3]:font-semibold',
  '[&_h4]:mt-6 [&_h4]:font-sans [&_h4]:text-lg [&_h4]:font-semibold [&_h5]:mt-4 [&_h5]:font-sans [&_h5]:font-semibold [&_h6]:mt-4 [&_h6]:font-sans [&_h6]:font-semibold',
  '[&_p]:my-3 [&_a]:text-link [&_a]:underline [&_a]:underline-offset-2',
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-7 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-7 [&_li_p]:my-1',
  '[&_blockquote]:my-5 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-5 [&_blockquote]:text-muted-foreground [&_blockquote]:italic',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]',
  '[&_pre]:my-5 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-4 [&_pre]:text-sm [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_hr]:my-8 [&_hr]:border-border',
  '[&_.tableWrapper]:my-5 [&_.tableWrapper]:overflow-x-auto [&_table]:w-full [&_table]:table-fixed [&_table]:border-collapse [&_table]:font-sans [&_table]:text-sm',
  '[&_td]:relative [&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top',
  '[&_th]:relative [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:p-2 [&_th]:text-left [&_th]:font-semibold',
  '[&_.selectedCell]:bg-accent',
  '[&_.column-resize-handle]:pointer-events-none [&_.column-resize-handle]:absolute [&_.column-resize-handle]:top-0 [&_.column-resize-handle]:-right-0.5 [&_.column-resize-handle]:bottom-0 [&_.column-resize-handle]:w-1 [&_.column-resize-handle]:bg-primary',
  '[&.resize-cursor]:cursor-col-resize',
  '[&_.is-empty]:before:pointer-events-none [&_.is-empty]:before:float-left [&_.is-empty]:before:h-0 [&_.is-empty]:before:text-muted-foreground [&_.is-empty]:before:content-[attr(data-placeholder)]',
].join(' ');

/** Where the pointer is: the top-level block beside it and that block's offset in the field. */
const blockUnderPointer = (editor: Editor, wrapper: HTMLElement, clientY: number): HoveredBlock | null => {
  const content = editor.view.dom.getBoundingClientRect();
  const hit = editor.view.posAtCoords({ left: content.left + 8, top: clientY });
  if (!hit) {
    return null;
  }
  const block = topLevelBlockAt(editor.state.doc, hit.inside >= 0 ? hit.inside : hit.pos);
  const dom = block ? editor.view.nodeDOM(block.pos) : null;
  if (!block || !(dom instanceof HTMLElement)) {
    return null;
  }
  return { pos: block.pos, top: dom.getBoundingClientRect().top - wrapper.getBoundingClientRect().top };
};

/**
 * Rich text as a block of the entry document: borderless, in the reading face, with formatting in a
 * floating toolbar on selection, a `+` handle and `/` menu for blocks, drag (or ⌥↑↓) to move a block, and
 * images dropped or pasted straight in (uploaded to the library, with a placeholder meanwhile).
 */
export const CanvasRichText = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { uploadMedia } = useFieldsEnvironment();
  const { context, definition, field, path } = props;
  const [linkOpen, setLinkOpen] = useState(false);
  const [hovered, setHovered] = useState<HoveredBlock | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [slash] = useState(createSlashBridge);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [files] = useState(() => createRelay<[Editor, File[], number], void>(() => undefined));
  const canUpload = uploadMedia !== undefined;
  const placeholder = typeof field.options.placeholder === 'string' ? field.options.placeholder : undefined;
  const extensions = useMemo(
    () =>
      canvasExtensions({
        placeholder: placeholder ?? t('entry.canvas.placeholder'),
        uploadingLabel: (name) => t('entry.upload.uploading', { name }),
        slash,
        onFiles: canUpload ? files.call : undefined,
      }),
    [placeholder, t, slash, canUpload, files],
  );
  useEffect(() => {
    files.set((editor, dropped, pos) => {
      if (!uploadMedia) {
        return;
      }
      void uploadIntoEditor(editor, dropped, pos, uploadMedia, (file, error) => {
        logError(error, `uploading ${file.name} into rich text`);
        toast.error(t('entry.upload.failed', { name: file.name }));
      });
    });
  });
  const { editor, initial, editable } = useRichTextEditor({
    props,
    extensions,
    contentClasses: CANVAS_CLASSES,
    onLinkShortcut: () => setLinkOpen(true),
    refuseFileDrops: !canUpload,
  });
  const assistEnabled = useAssistEnabled();
  const rewrite = useRewriteSelection(editor);
  const pickImages = useCallback(async (): Promise<PickedImage[]> => {
    try {
      const picked = await context.pickMedia({ multiple: true, allowedKinds: ['image'] });
      return (picked ?? []).map((asset) => ({ mediaId: asset.id, alt: asset.alt || null }));
    } catch (error) {
      reportError(error, 'picking images');
      return [];
    }
  }, [context]);
  const insert = useCallback(
    (type: BlockType, target: Parameters<typeof insertBlockAt>[2]) =>
      insertBlockAt(editor, type, target, pickImages),
    [editor, pickImages],
  );
  const handle = useMemo<CanvasFieldHandle>(
    () => ({ insertBlock: (type, at) => insert(type, edgeTarget(editor, at)) }),
    [insert, editor],
  );
  useRegisterCanvasHandle(path, editable ? handle : undefined);
  const track = (event: MouseEvent<HTMLDivElement>) => {
    if (!menuOpen && wrapperRef.current && editable) {
      setHovered(blockUnderPointer(editor, wrapperRef.current, event.clientY));
    }
  };
  const maxLength = definition.type === 'richtext' ? definition.settings.maxLength : undefined;
  return (
    <div
      ref={wrapperRef}
      className="relative"
      onMouseMove={track}
      onMouseLeave={() => (menuOpen ? undefined : setHovered(null))}
      data-rich-text-canvas
    >
      {editable && hovered ? (
        <BlockHandle
          editor={editor}
          block={hovered}
          onInsert={(type, pos) => void insert(type, pos)}
          onMenuOpenChange={setMenuOpen}
        />
      ) : null}
      <EditorContent editor={editor} />
      {editable ? (
        <>
          <BubbleToolbar
            editor={editor}
            onLink={() => setLinkOpen(true)}
            onRewrite={assistEnabled ? rewrite.start : undefined}
          />
          {assistEnabled ? <RewritePopover editor={editor} rewrite={rewrite} /> : null}
          <LinkPopover
            editor={editor}
            active={editor.isActive('link')}
            disabled={false}
            open={linkOpen}
            onOpenChange={setLinkOpen}
            anchorToSelection
          />
          <SlashMenu
            editor={editor}
            bridge={slash}
            onChoose={(type, state) => void turnInto(editor, type, state.range, pickImages)}
          />
        </>
      ) : null}
      <Notes editor={editor} initial={initial} maxLength={maxLength} />
    </div>
  );
};
