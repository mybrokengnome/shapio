import type { Editor } from '@tiptap/core';
import { Loader2 } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { AssistButton } from '@/components/AssistButton';
import { AssistError } from '@/components/AssistError';
import { HintedLabel } from '@/components/HintedLabel';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { ASSIST_WRITE_MAX_INSTRUCTION } from '@/constants/assist';
import type { WriteProposal } from '../../hooks/useWriteProposal';
import { selectionAnchor } from '../../selectionAnchor';
import { ProposalEditor } from '../ProposalEditor';

type WritePopoverProps = { editor: Editor; write: WriteProposal };

/**
 * "Write…" and "Continue writing", anchored where the text will go: the instruction (for a section), then the
 * proposal to edit and Insert. Nothing changes in the document until Insert.
 */
export const WritePopover = ({ editor, write }: WritePopoverProps) => {
  const { t } = useTranslation();
  const id = useId();
  const { result, anchor, instruction } = write;
  const askInstruction = !result && write.kind === 'section';
  return (
    <Popover
      open={write.open}
      onOpenChange={(next) => {
        if (next) {
          return;
        }
        if (write.confirmingDiscard) {
          write.keepEditing();
          return;
        }
        write.requestClose();
      }}
    >
      {anchor ? (
        <PopoverAnchor virtualRef={selectionAnchor(editor, { from: anchor.from, to: anchor.from })} />
      ) : null}
      <PopoverContent
        align="start"
        className="w-[min(32rem,calc(100vw-2rem))] space-y-3 font-sans"
        aria-label={t('assist.write.title')}
        // Back to the text, so writing continues where the proposal went.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          editor.commands.focus();
        }}
      >
        {result ? (
          <ProposalEditor key={write.answer} write={write} result={result} />
        ) : askInstruction ? (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              write.run();
            }}
          >
            <HintedLabel
              htmlFor={`${id}-instruction`}
              label={t('assist.write.instruction')}
              hint={t('assist.write.hint')}
            />
            <Input
              id={`${id}-instruction`}
              value={instruction}
              autoFocus
              maxLength={ASSIST_WRITE_MAX_INSTRUCTION}
              placeholder={t('assist.write.instructionPlaceholder')}
              disabled={write.pending}
              onChange={(event) => write.setInstruction(event.target.value)}
            />
            <AssistError error={write.error} />
            <div className="flex justify-end gap-2">
              <AssistButton
                type="submit"
                variant="default"
                pending={write.pending}
                pendingLabel={t('assist.working')}
                disabled={instruction.trim() === ''}
              >
                {t('assist.write.run')}
              </AssistButton>
            </div>
          </form>
        ) : (
          <div className="space-y-2">
            {write.pending ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                {t('assist.working')}
              </p>
            ) : null}
            <AssistError error={write.error} />
            {write.error ? (
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={write.discard}>
                  {t('assist.discard')}
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={write.tryAgain}>
                  {t('assist.write.tryAgain')}
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};
