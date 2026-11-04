import { EditorContent, ReactNodeViewRenderer } from '@tiptap/react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAssistEnabled } from '@/api/assist';
import { cn } from '@/helpers/cn';
import { reportError } from '@/helpers/reportError';
import type { BuiltInEditorProps } from '../types';
import { CanvasRichText } from './canvas/CanvasRichText';
import { RewritePopover } from './canvas/RewritePopover';
import { WritePopover } from './canvas/WritePopover';
import { FORM_CONTENT_CLASSES } from './contentClasses';
import { richTextExtensions } from './extensions';
import { useAssistActions } from './hooks/useAssistActions';
import { useRichTextEditor } from './hooks/useRichTextEditor';
import { ImageView } from './ImageView';
import { Notes } from './Notes';
import { Toolbar } from './Toolbar';

/**
 * `richText`: Tiptap (open-source core) producing the `shapio-richtext` v1 document: headings, paragraphs,
 * bold/italic/code, links, lists, quotes, code blocks, hard breaks, library images with alt text, tables
 * with a header row and resizable columns, and rules. Pasted content is cleaned and limited to that schema.
 * In the entry document (`appearance: 'canvas'`) it is the writing surface instead of a boxed control.
 */
export const RichTextField = (props: BuiltInEditorProps) =>
  props.appearance === 'canvas' ? <CanvasRichText {...props} /> : <FormRichText {...props} />;

const FormRichText = (props: BuiltInEditorProps) => {
  const { t } = useTranslation();
  const { field, context, validation, definition } = props;
  const [linkOpen, setLinkOpen] = useState(false);
  const placeholder = typeof field.options.placeholder === 'string' ? field.options.placeholder : undefined;
  const extensions = useMemo(
    () =>
      richTextExtensions({
        placeholder: placeholder ?? t('content.richText.placeholder'),
        imageView: ReactNodeViewRenderer(ImageView),
      }),
    [placeholder, t],
  );
  const { editor, initial, editable } = useRichTextEditor({
    props,
    extensions,
    contentClasses: FORM_CONTENT_CLASSES,
    onLinkShortcut: () => setLinkOpen(true),
    refuseFileDrops: true,
  });
  const assistEnabled = useAssistEnabled();
  const { rewrite, write, writeAtCursor, continueAtEnd } = useAssistActions(editor, definition.label);
  const maxLength = definition.type === 'richtext' ? definition.settings.maxLength : undefined;
  const insertImage = async () => {
    try {
      const picked = await context.pickMedia({ multiple: true, allowedKinds: ['image'] });
      for (const asset of picked ?? []) {
        editor
          .chain()
          .focus()
          .insertMediaImage({ mediaId: asset.id, alt: asset.alt || null })
          .run();
      }
    } catch (error) {
      reportError(error, 'inserting an image');
    }
  };
  return (
    <div className="space-y-1">
      <div
        className={cn(
          // `overflow-clip`, not hidden: hidden would make the box a scroll container and stop the toolbar sticking.
          'overflow-clip rounded-lg border border-input bg-card focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/20',
          validation.invalid && 'border-destructive',
        )}
      >
        {editable ? (
          <Toolbar
            editor={editor}
            minimal={field.options.toolbar === 'minimal'}
            disabled={!editable}
            linkOpen={linkOpen}
            onLinkOpenChange={setLinkOpen}
            onInsertImage={() => void insertImage()}
            assist={
              assistEnabled
                ? {
                    onWrite: () => writeAtCursor('section'),
                    onContinue: continueAtEnd,
                    onRewrite: rewrite.start,
                  }
                : undefined
            }
          />
        ) : null}
        <EditorContent editor={editor} />
      </div>
      <Notes editor={editor} initial={initial} maxLength={maxLength} />
      {/* Portaled popovers anchored to the text (the bordered box clips nothing outside it). */}
      {editable && assistEnabled ? (
        <>
          <RewritePopover editor={editor} rewrite={rewrite} />
          <WritePopover editor={editor} write={write} />
        </>
      ) : null}
    </div>
  );
};
