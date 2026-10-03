import type { Editor } from '@tiptap/core';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AssistButton } from '@/components/AssistButton';
import { AssistError } from '@/components/AssistError';
import { HintedLabel } from '@/components/HintedLabel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Textarea } from '@/components/ui/textarea';
import { REWRITE_MAX_INSTRUCTION, REWRITE_MAX_TEXT, REWRITE_PRESETS } from '@/constants/assist';
import type { RewriteSelection } from '../../hooks/useRewriteSelection';
import { selectionAnchor } from '../../selectionAnchor';

type RewritePopoverProps = { editor: Editor; rewrite: RewriteSelection };

/**
 * "Rewrite…" for the selected text, anchored to it: an instruction (or Shorten / Expand), then the proposal
 * to edit and Replace the selection with, or Discard. Nothing changes in the document until Replace.
 */
export const RewritePopover = ({ editor, rewrite }: RewritePopoverProps) => {
  const { t } = useTranslation();
  const id = useId();
  const [instruction, setInstruction] = useState('');
  const { captured, result } = rewrite;
  const busy = rewrite.pending;
  return (
    <Popover
      open={rewrite.open}
      onOpenChange={(next) => {
        if (!next) {
          rewrite.close();
          setInstruction('');
        }
      }}
    >
      {captured ? <PopoverAnchor virtualRef={selectionAnchor(editor, captured)} /> : null}
      <PopoverContent
        align="start"
        className="w-[min(26rem,calc(100vw-2rem))] space-y-3 font-sans"
        aria-label={t('assist.rewrite.title')}
        // Back to the text, so writing continues where the rewrite happened.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          editor.commands.focus();
        }}
      >
        {result ? (
          <div className="space-y-2">
            <HintedLabel
              htmlFor={`${id}-result`}
              label={t('assist.rewrite.proposal', { model: result.model })}
              hint={t('assist.rewrite.marksHint')}
            />
            <Textarea
              id={`${id}-result`}
              value={rewrite.draft}
              autoFocus
              rows={5}
              className="max-h-72"
              onChange={(event) => rewrite.setDraft(event.target.value)}
            />
            {result.truncated ? (
              <p className="text-meta text-muted-foreground">{t('assist.truncated')}</p>
            ) : null}
            {rewrite.stale ? (
              <p role="alert" className="text-meta text-destructive">
                {t('assist.rewrite.stale')}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={rewrite.discard}>
                {t('assist.discard')}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={rewrite.draft.trim() === '' || rewrite.stale}
                onClick={rewrite.apply}
              >
                {t('assist.rewrite.replace')}
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              rewrite.run(instruction);
            }}
          >
            <HintedLabel
              htmlFor={`${id}-instruction`}
              label={t('assist.rewrite.instruction')}
              hint={t('assist.rewrite.marksHint')}
            />
            <Input
              id={`${id}-instruction`}
              value={instruction}
              autoFocus
              maxLength={REWRITE_MAX_INSTRUCTION}
              placeholder={t('assist.rewrite.instructionPlaceholder')}
              disabled={busy || rewrite.tooLong}
              onChange={(event) => setInstruction(event.target.value)}
            />
            {rewrite.tooLong ? (
              <p role="alert" className="text-meta text-destructive">
                {t('assist.rewrite.tooLong', { max: REWRITE_MAX_TEXT.toLocaleString() })}
              </p>
            ) : null}
            <AssistError error={rewrite.error} />
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || rewrite.tooLong}
                onClick={() => rewrite.run(REWRITE_PRESETS.shorten)}
              >
                {t('assist.rewrite.shorten')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || rewrite.tooLong}
                onClick={() => rewrite.run(REWRITE_PRESETS.expand)}
              >
                {t('assist.rewrite.expand')}
              </Button>
              <AssistButton
                variant="default"
                pending={busy}
                pendingLabel={t('assist.working')}
                disabled={instruction.trim() === '' || rewrite.tooLong}
                onClick={() => rewrite.run(instruction)}
              >
                {t('assist.rewrite.run')}
              </AssistButton>
            </div>
          </form>
        )}
      </PopoverContent>
    </Popover>
  );
};
