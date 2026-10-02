import { Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { InlineConfirm } from '@/components/InlineConfirm';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';

export type SaveActionsProps = {
  /** Discard is possible (there are unsaved edits). */
  canDiscard: boolean;
  /** Review is possible: edits, no problems, nothing blocking. */
  canReview: boolean;
  reviewing: boolean;
  onReview: () => void;
  /** Runs once the admin confirms the discard. */
  onDiscard: () => void;
};

/**
 * Discard changes (confirmed in place), then Review (the primary action: the plan, then Ship now or Review in a change set). In the header on xl, the
 * footer below.
 */
export const SaveActions = ({ canDiscard, canReview, reviewing, onReview, onDiscard }: SaveActionsProps) => {
  const { t } = useTranslation();
  return (
    <>
      <InlineConfirm
        tone="danger"
        title={t('models.builder.discardTitle')}
        description={t('models.builder.discardDescription')}
        confirmLabel={t('models.builder.discard')}
        onConfirm={onDiscard}
        trigger={
          <Button type="button" variant="ghost" disabled={!canDiscard}>
            <Undo2 aria-hidden="true" />
            {t('models.builder.discard')}
          </Button>
        }
      />
      <SubmitButton
        pending={reviewing}
        pendingLabel={t('models.builder.planning')}
        disabled={!canReview}
        onClick={onReview}
      >
        {t('models.builder.review')}
      </SubmitButton>
    </>
  );
};
