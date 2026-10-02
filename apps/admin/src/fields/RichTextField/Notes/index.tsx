import type { Editor } from '@tiptap/core';
import { useEditorState } from '@tiptap/react';
import { useTranslation } from 'react-i18next';
import type { PreparedRichText } from '../richTextDocument';

type NotesProps = { editor: Editor; initial: PreparedRichText; maxLength: number | undefined };

/** Under a rich-text field: why it is read-only (a newer or unreadable format) and the character count. */
export const Notes = ({ editor, initial, maxLength }: NotesProps) => {
  const { t } = useTranslation();
  const textLength = useEditorState({
    editor,
    selector: ({ editor: current }) => current.state.doc.textContent.length,
  });
  return (
    <>
      {initial.status === 'newer' ? (
        <p className="font-sans text-meta text-muted-foreground">
          {t('content.richText.newerVersion', { version: initial.version })}
        </p>
      ) : null}
      {initial.status === 'unreadable' ? (
        <p className="font-sans text-meta text-destructive">{t('content.richText.unreadable')}</p>
      ) : null}
      {maxLength ? (
        <p className="text-right font-sans text-meta text-muted-foreground tabular-nums">
          {t('content.fields.characterCount', { count: textLength, max: maxLength })}
        </p>
      ) : null}
    </>
  );
};
