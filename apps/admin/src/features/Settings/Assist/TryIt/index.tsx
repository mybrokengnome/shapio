import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRewriteText } from '@/api/assist';
import { AssistButton } from '@/components/AssistButton';
import { AssistError } from '@/components/AssistError';
import { Panel } from '@/components/Panel';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { REWRITE_MAX_INSTRUCTION, REWRITE_MAX_TEXT } from '@/constants/assist';

/** A rewrite to check the configured model answers (writes nothing anywhere). */
export const TryIt = () => {
  const { t } = useTranslation();
  const id = useId();
  const [text, setText] = useState('');
  const [instruction, setInstruction] = useState('');
  const rewrite = useRewriteText();
  const ready = text.trim() !== '' && instruction.trim() !== '';
  return (
    <Panel title={t('assist.settings.tryIt')} titleAs="h2">
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) {
            rewrite.mutate({ text: text.trim(), instruction: instruction.trim() });
          }
        }}
      >
        <div className="space-y-2">
          <Label htmlFor={`${id}-text`}>{t('assist.settings.tryText')}</Label>
          <Textarea
            id={`${id}-text`}
            value={text}
            rows={3}
            maxLength={REWRITE_MAX_TEXT}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${id}-instruction`}>{t('assist.rewrite.instruction')}</Label>
          <Input
            id={`${id}-instruction`}
            value={instruction}
            maxLength={REWRITE_MAX_INSTRUCTION}
            placeholder={t('assist.rewrite.instructionPlaceholder')}
            onChange={(event) => setInstruction(event.target.value)}
          />
        </div>
        <AssistError error={rewrite.error} />
        <div className="flex justify-end">
          <AssistButton
            type="submit"
            variant="default"
            size="default"
            pending={rewrite.isPending}
            pendingLabel={t('assist.working')}
            disabled={!ready}
          >
            {t('assist.rewrite.run')}
          </AssistButton>
        </div>
        <div aria-live="polite">
          {rewrite.data ? (
            <figure className="space-y-1 rounded-lg border bg-muted/40 p-3">
              <figcaption className="text-meta text-muted-foreground">
                {t('assist.rewrite.proposal', { model: rewrite.data.model })}
              </figcaption>
              <p className="text-sm whitespace-pre-wrap">{rewrite.data.text}</p>
            </figure>
          ) : null}
        </div>
      </form>
    </Panel>
  );
};
