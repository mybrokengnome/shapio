import type { DeploymentConnection } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { PROVIDER_LABELS } from '../../constants';
import { DetailList } from '../../DetailList';
import { EnabledChip } from '../../EnabledChip';
import { usePublishingPermissions } from '../../hooks/usePublishingPermissions';
import { useConnectionActions } from '../hooks/useConnectionActions';
import { RunStatus } from '../RunStatus';

type ConnectionCardProps = { connection: DeploymentConnection };

/** One deployment connection: provider, state, latest run and live snapshot, with Open and Deploy now. */
export const ConnectionCard = ({ connection }: ConnectionCardProps) => {
  const { t } = useTranslation();
  const { canTriggerDeployments } = usePublishingPermissions();
  const actions = useConnectionActions(connection);
  return (
    <Panel
      title={connection.name}
      titleAs="h3"
      description={t(PROVIDER_LABELS[connection.provider])}
      actions={<EnabledChip enabled={connection.enabled} />}
      bodyClassName="space-y-4"
    >
      <DetailList
        items={[
          {
            label: t('publishing.deployments.latestRun'),
            value: connection.latestRun ? <RunStatus run={connection.latestRun} /> : t('common.never'),
          },
          {
            label: t('publishing.deployments.currentSnapshot'),
            value:
              connection.currentRun?.snapshot != null
                ? t('publishing.snapshotNumber', { snapshot: connection.currentRun.snapshot })
                : t('common.none'),
          },
        ]}
        className="grid-cols-2"
      />
      <div className="flex flex-wrap justify-end gap-2">
        <Button asChild variant="outline" size="sm">
          <Link to="/publishing/deployments/$connectionId" params={{ connectionId: connection.id }}>
            {t('publishing.deployments.open')}
          </Link>
        </Button>
        {canTriggerDeployments ? (
          <Button size="sm" disabled={actions.triggering || !connection.enabled} onClick={actions.triggerRun}>
            <Rocket aria-hidden="true" />
            {t('publishing.deployments.triggerRun')}
          </Button>
        ) : null}
      </div>
    </Panel>
  );
};
