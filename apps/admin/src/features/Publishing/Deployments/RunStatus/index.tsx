import type { DeploymentRun } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { runDisplay } from '../../helpers/statusDisplay';

type RunStatusProps = {
  run: Pick<DeploymentRun, 'status' | 'provider' | 'completionReported'>;
  /** False for a past state on the timeline. */
  live?: boolean;
};

/** A run's status, labelled honestly (see `runDisplay`). */
export const RunStatus = ({ run, live = true }: RunStatusProps) => {
  const { t } = useTranslation();
  const display = runDisplay(run);
  return <StatusChip tone={display.tone} label={t(display.labelKey)} live={live} />;
};
