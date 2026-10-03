import type { AltProposal } from '@shapio/client';
import { Check, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUpdateMediaAsset } from '@/api/media';
import { StatusChip } from '@/components/StatusChip';
import { SubmitButton } from '@/components/SubmitButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeError } from '@/helpers/describeError';
import type { AltDecision } from '../../../hooks/useContentOpsProposal';

type RowProps = {
  proposal: AltProposal;
  decision: AltDecision | undefined;
  onDecide: (decision: AltDecision) => void;
};

/** One image's proposed alt text: editable, then Accept (the library update, with its version) or Reject. */
export const Row = ({ proposal, decision, onDecide }: RowProps) => {
  const { t } = useTranslation();
  const id = useId();
  const [alt, setAlt] = useState(proposal.proposedAlt);
  const update = useUpdateMediaAsset();
  return (
    <li className="space-y-2 py-4 first:pt-0">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-semibold">{proposal.filename}</p>
        {decision ? (
          <StatusChip
            size="sm"
            tone={decision === 'accepted' ? 'success' : 'muted'}
            label={decision === 'accepted' ? t('assist.fixes.accepted') : t('assist.fixes.rejected')}
          />
        ) : null}
      </div>
      {decision ? null : (
        <form
          className="space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            update.mutate(
              { id: proposal.assetId, input: { alt: alt.trim(), expectedVersion: proposal.assetVersion } },
              { onSuccess: () => onDecide('accepted') },
            );
          }}
        >
          <Label htmlFor={id}>{t('content.media.altLabel')}</Label>
          <Input id={id} value={alt} onChange={(event) => setAlt(event.target.value)} />
          {update.error ? (
            <p role="alert" className="text-meta text-destructive">
              {describeError(update.error)}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onDecide('rejected')}>
              <X aria-hidden="true" />
              {t('assist.fixes.reject')}
            </Button>
            <SubmitButton
              size="sm"
              pending={update.isPending}
              pendingLabel={t('common.saving')}
              disabled={alt.trim() === ''}
            >
              <Check aria-hidden="true" />
              {t('assist.fixes.accept')}
            </SubmitButton>
          </div>
        </form>
      )}
    </li>
  );
};
