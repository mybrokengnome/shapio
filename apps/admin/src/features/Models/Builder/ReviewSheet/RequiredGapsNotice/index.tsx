import type { PlanStep, PlanStepImpact } from '@shapio/client';
import type { SchemaDefinition } from '@shapio/schema';
import { Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { requiredGapNotices } from '../../../helpers/describeStep';

type RequiredGapsNoticeProps = {
  steps: readonly PlanStep[];
  /** Impact per step, in the same order. */
  impacts?: readonly PlanStepImpact[];
  before: SchemaDefinition | null;
  after: SchemaDefinition | null;
};

/**
 * Before shipping a field made required: the entries without a value go live as they are, are listed in the
 * Inbox and can't be published again until filled in. Nothing to acknowledge: nothing is lost or changed.
 */
export const RequiredGapsNotice = ({ steps, impacts, before, after }: RequiredGapsNoticeProps) => {
  const { t } = useTranslation();
  const notices = requiredGapNotices(steps, impacts, before, after);
  if (notices.length === 0) {
    return null;
  }
  return (
    <Alert variant="info">
      <Info aria-hidden="true" />
      <AlertTitle>{t('models.plan.requiredGapsTitle')}</AlertTitle>
      <AlertDescription>
        {notices.map((notice) => (
          <p key={notice}>{notice}</p>
        ))}
      </AlertDescription>
    </Alert>
  );
};
