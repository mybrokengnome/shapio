import type { DeploymentConnectionSummary } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { PROVIDER_LABELS } from '../../constants';

/** A connection page's header line: its provider and, once deployed, the snapshot the site serves. */
export const useConnectionMeta = (
  connection: Pick<DeploymentConnectionSummary, 'provider' | 'currentRun'>,
) => {
  const { t } = useTranslation();
  const snapshot = connection.currentRun?.snapshot;
  const meta = [
    t(PROVIDER_LABELS[connection.provider]),
    snapshot != null
      ? t('publishing.deployments.liveSnapshot', { snapshot: t('publishing.snapshotNumber', { snapshot }) })
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return { meta };
};
