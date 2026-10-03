import type { ContentOpsRule } from '@shapio/client';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AssistButton } from '@/components/AssistButton';
import { AssistError } from '@/components/AssistError';
import { Button } from '@/components/ui/button';
import { describeAssistErrorCode } from '@/helpers/describeAssistError';
import { useContentOpsProposal } from '../hooks/useContentOpsProposal';
import { AltReview } from './AltReview';
import { LocaleResult } from './LocaleResult';

type ProposeFixesProps = { rule: ContentOpsRule };

/**
 * "Propose fixes" under a rule group (missing alt text, locales not started): a model drafts the fixes in
 * the background. Alt texts come back as a list to accept or reject; locale drafts land in a change set.
 */
export const ProposeFixes = ({ rule }: ProposeFixesProps) => {
  const { t } = useTranslation();
  const proposal = useContentOpsProposal(rule);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { run } = proposal;
  const result = run?.status === 'succeeded' ? run.result : null;
  return (
    <div className="space-y-1 px-5 pb-2">
      <div className="flex flex-wrap items-center gap-2">
        <AssistButton
          variant="outline"
          pending={proposal.running}
          pendingLabel={t('assist.fixes.running')}
          onClick={proposal.propose}
        >
          {run ? t('assist.fixes.again') : t('assist.fixes.propose')}
        </AssistButton>
        {result?.rule === 'altMissing' ? (
          result.proposals.length > 0 ? (
            <Button type="button" size="sm" onClick={() => setReviewOpen(true)}>
              {t('assist.fixes.review', { count: result.proposals.length })}
            </Button>
          ) : (
            <span className="text-meta text-muted-foreground">{t('assist.fixes.none')}</span>
          )
        ) : null}
        {result?.rule === 'localeMissing' ? <LocaleResult result={result} /> : null}
      </div>
      <AssistError error={proposal.error} />
      {run?.status === 'failed' ? (
        <p role="alert" className="text-meta text-destructive">
          {describeAssistErrorCode(run.error?.code ?? 'INTERNAL_ERROR')}
        </p>
      ) : null}
      {result?.rule === 'altMissing' && run ? (
        <AltReview
          open={reviewOpen}
          onOpenChange={(next) => {
            setReviewOpen(next);
            if (!next) {
              proposal.finishReview();
            }
          }}
          model={run.model}
          proposals={result.proposals}
          decisions={proposal.decisions}
          onDecide={proposal.decide}
        />
      ) : null}
    </div>
  );
};
