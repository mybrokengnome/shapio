import type { Extensions } from '@tiptap/core';
import { useEditor } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { isSameContent } from '../../helpers/values';
import type { BuiltInEditorProps } from '../../types';
import {
  prepareRichText,
  sanitizePastedHtml,
  toRichTextValue,
  type ProseMirrorDoc,
} from '../richTextDocument';

/** Mod+Shift+K: ⌘K is the command palette everywhere, so the link shortcut takes Shift. */
export const isLinkShortcut = (event: KeyboardEvent) =>
  (event.metaKey || event.ctrlKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'k';

type RichTextEditorOptions = {
  props: BuiltInEditorProps;
  extensions: Extensions;
  /** Classes of the editable root (typography). */
  contentClasses: string;
  onLinkShortcut: () => void;
  /** Files dropped where they can't be uploaded are refused instead of opened by the browser. */
  refuseFileDrops: boolean;
};

/**
 * The Tiptap editor behind a rich-text field, whatever it looks like: the stored envelope in and out,
 * ARIA wiring on the editable root, values replaced from outside (reload, restore, copy from another
 * locale) replacing the document, and the editable state following read-only/disabled.
 */
export const useRichTextEditor = ({
  props,
  extensions,
  contentClasses,
  onLinkShortcut,
  refuseFileDrops,
}: RichTextEditorOptions) => {
  const { inputId, labelId, describedBy, value, onChange, onBlur, readOnly, disabled, validation } = props;
  const [initial] = useState(() => prepareRichText(value));
  const lastEmitted = useRef<unknown>(value);
  const callbacks = useRef({ onChange, onBlur, onLinkShortcut });
  useEffect(() => {
    callbacks.current = { onChange, onBlur, onLinkShortcut };
  });
  const editable = !readOnly && !disabled && initial.status === 'ok';
  const editor = useEditor({
    extensions,
    content: initial.doc,
    editable,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      // Re-applied on every render (useEditor passes changed options to the editor), so these stay current.
      attributes: {
        id: inputId,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': labelId,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(validation.invalid ? { 'aria-invalid': 'true' } : {}),
        ...(editable ? {} : { 'aria-readonly': 'true' }),
        class: contentClasses,
      },
      transformPastedHTML: sanitizePastedHtml,
      handleKeyDown: (_view, event) => {
        if (isLinkShortcut(event)) {
          event.preventDefault();
          callbacks.current.onLinkShortcut();
          return true;
        }
        return false;
      },
      handleDrop: (_view, event) => {
        if (refuseFileDrops && (event.dataTransfer?.files.length ?? 0) > 0) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = toRichTextValue(current.getJSON() as ProseMirrorDoc);
      lastEmitted.current = next;
      callbacks.current.onChange(next);
    },
    onBlur: () => callbacks.current.onBlur(),
  });
  useEffect(() => {
    if (!isSameContent(value, lastEmitted.current)) {
      lastEmitted.current = value;
      editor.commands.setContent(prepareRichText(value).doc, { emitUpdate: false });
    }
  }, [value, editor]);
  useEffect(() => editor.setEditable(editable), [editor, editable]);
  return { editor, initial, editable };
};
