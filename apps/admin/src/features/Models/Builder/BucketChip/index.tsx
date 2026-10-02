import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@/components/StatusChip';
import { PLAN_BUCKET_LABEL_KEYS } from '../../constants';
import type { PlanBucket } from '../../helpers/planBuckets';

const BUCKET_TONES = {
  breaking: 'warning',
  prerequisites: 'scheduled',
  live: 'success',
  metadata: 'neutral',
} as const satisfies Record<PlanBucket, StatusTone>;

type BucketChipProps = { bucket: PlanBucket; className?: string };

/** How a change is applied: metadata only, live, after checks, or breaking. */
export const BucketChip = ({ bucket, className }: BucketChipProps) => {
  const { t } = useTranslation();
  return (
    <StatusChip tone={BUCKET_TONES[bucket]} label={t(PLAN_BUCKET_LABEL_KEYS[bucket])} className={className} />
  );
};
