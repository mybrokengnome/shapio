import type { CheckSeverity } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { StatusChip, type StatusTone } from '@/components/StatusChip';

const SEVERITY_DISPLAY = {
  error: { labelKey: 'develop.health.error', tone: 'danger' },
  warning: { labelKey: 'develop.health.warning', tone: 'warning' },
} as const satisfies Record<CheckSeverity, { labelKey: string; tone: StatusTone }>;

type HealthChipProps = { severity: CheckSeverity };

/** A content-health finding's severity. */
export const HealthChip = ({ severity }: HealthChipProps) => {
  const { t } = useTranslation();
  const display = SEVERITY_DISPLAY[severity];
  return <StatusChip tone={display.tone} label={t(display.labelKey)} size="sm" />;
};
