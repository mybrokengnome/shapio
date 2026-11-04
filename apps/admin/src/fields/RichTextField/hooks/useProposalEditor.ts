import { useEditor } from '@tiptap/react';
import { useEffect, useMemo, useRef } from 'react';
import { cn } from '@/helpers/cn';
import { FORM_CONTENT_CLASSES } from '../contentClasses';
import { richTextExtensions } from '../extensions';
import { sanitizePastedHtml } from '../richTextDocument';

/** The proposal scrolls inside its own root, so the floating toolbar beside it is never clipped. */
const PROPOSAL_CLASSES = cn(FORM_CONTENT_CLASSES, 'max-h-96 min-h-24 overflow-y-auto px-3 py-2');

type ProposalEditorOptions = {
  /** The proposal as HTML (`markdownToHtml`), parsed against the stored schema. */
  html: string;
  /** The editable root's accessible name ("Proposed by …"). */
  label: string;
  /** Whether the proposal holds any text, on load and after every edit. */
  onTextChange: (hasText: boolean) => void;
};

const hasTextIn = (text: string) => text.trim() !== '';

/**
 * A second, small Tiptap editor for an assist proposal: the stored schema only (`richTextExtensions`, no
 * `/` menu, block moves, uploads or images), focused at its end, so the person edits the proposal as rich
 * text and Insert takes valid blocks.
 */
export const useProposalEditor = ({ html, label, onTextChange }: ProposalEditorOptions) => {
  const extensions = useMemo(() => richTextExtensions(), []);
  const onText = useRef(onTextChange);
  useEffect(() => {
    onText.current = onTextChange;
  });
  const editor = useEditor({
    extensions,
    content: html,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    autofocus: 'end',
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, class: PROPOSAL_CLASSES },
      transformPastedHTML: sanitizePastedHtml,
    },
    onCreate: ({ editor: created }) => onText.current(hasTextIn(created.state.doc.textContent)),
    onUpdate: ({ editor: current }) => onText.current(hasTextIn(current.state.doc.textContent)),
  });
  return editor;
};
