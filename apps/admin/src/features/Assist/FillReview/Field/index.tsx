import type { FieldProposal } from '@shapio/client';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import type { FieldFill } from '../../hooks/useFieldFill';
import { ValueEditor } from '../ValueEditor';

type FieldProps = {
  proposal: FieldProposal;
  fill: FieldFill;
  /** The group was saved or is being saved: nothing changes any more. */
  locked: boolean;
};

/** One proposed value: the field's name, the value in its editor, and Reject (left out of the accept). */
export const Field = ({ proposal, fill, locked }: FieldProps) => {
  const { t } = useTranslation();
  const id = useId();
  const labelId = `${id}-label`;
  const rejected = fill.isRejected(proposal.key);
  const groupOfBoxes = proposal.fieldType === 'enum' && proposal.multiple === true;
  const LabelElement = groupOfBoxes ? 'span' : Label;
  return (
    <div className="space-y-1.5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <LabelElement id={labelId} {...(groupOfBoxes ? {} : { htmlFor: id })} className="text-sm font-medium">
          {proposal.fieldLabel}
        </LabelElement>
        {locked ? null : (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-pressed={rejected}
            aria-label={
              rejected
                ? t('assist.fill.keepField', { field: proposal.fieldLabel })
                : t('assist.fill.rejectField', { field: proposal.fieldLabel })
            }
            onClick={() => fill.toggleRejected(proposal.key)}
          >
            {rejected ? t('assist.fill.keep') : t('assist.fixes.reject')}
          </Button>
        )}
      </div>
      {rejected ? (
        <p className="text-meta text-muted-foreground">{t('assist.fill.rejectedField')}</p>
      ) : (
        <ValueEditor
          proposal={proposal}
          value={fill.valueOf(proposal.key, proposal.proposedValue)}
          onChange={(value) => fill.setDraft(proposal.key, value)}
          id={id}
          labelId={labelId}
          disabled={locked}
        />
      )}
    </div>
  );
};
