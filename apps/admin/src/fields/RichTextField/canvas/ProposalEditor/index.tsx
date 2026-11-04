import type { WriteResult } from '@shapio/client';
import { EditorContent } from '@tiptap/react';
import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { InfoHint } from '@/components/InfoHint';
import { Button } from '@/components/ui/button';
import { useProposalEditor } from '../../hooks/useProposalEditor';
import type { WriteProposal } from '../../hooks/useWriteProposal';
import { BubbleToolbar } from '../BubbleToolbar';
import { markdownToHtml } from '../markdownToHtml';

type ProposalEditorProps = { write: WriteProposal; result: WriteResult };

/**
 * The model's text as an editable rich-text proposal: format it with the floating toolbar, then Insert it as
 * blocks where the write started, try again, or discard it (asked first when it came from Escape or a click
 * outside, see `useWriteProposal.requestClose`).
 */
export const ProposalEditor = ({ write, result }: ProposalEditorProps) => {
  const { t } = useTranslation();
  const label = t('assist.proposedBy', { model: result.model });
  const html = useMemo(() => markdownToHtml(result.markdown), [result.markdown]);
  const editor = useProposalEditor({ html, label, onTextChange: write.setHasText });
  // Back into the proposal when the person chose to keep editing it.
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (wasConfirming.current && !write.confirmingDiscard) {
      editor.commands.focus();
    }
    wasConfirming.current = write.confirmingDiscard;
  }, [write.confirmingDiscard, editor]);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <span className="text-sm font-semibold">{label}</span>
        <InfoHint about={label}>{t('assist.write.proposalHint')}</InfoHint>
      </div>
      <div className="rounded-lg border border-input bg-card focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/20">
        <EditorContent editor={editor} />
      </div>
      <BubbleToolbar editor={editor} variant="proposal" />
      {write.stale ? (
        <p role="alert" className="text-meta text-destructive">
          {t('assist.write.stale')}
        </p>
      ) : null}
      {write.confirmingDiscard ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <p role="alert" className="mr-auto text-sm font-medium">
            {t('assist.write.discardTitle')}
          </p>
          <Button type="button" variant="outline" size="sm" autoFocus onClick={write.keepEditing}>
            {t('assist.write.keepEditing')}
          </Button>
          <Button type="button" variant="destructive-ghost" size="sm" onClick={write.discard}>
            {t('assist.discard')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={write.pending} onClick={write.tryAgain}>
            {t('assist.write.tryAgain')}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={write.discard}>
            {t('assist.discard')}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!write.hasText || write.stale}
            onClick={() => write.insert(editor.getJSON().content ?? [])}
          >
            {t('assist.write.insert')}
          </Button>
        </div>
      )}
    </div>
  );
};
