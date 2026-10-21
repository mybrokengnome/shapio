import type { DeploymentConnectionSummary } from '@shapio/client';
import { linkOptions, useNavigate, useSearch } from '@tanstack/react-router';
import { Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Button } from '@/components/ui/button';
import { EnabledChip } from '../../../EnabledChip';
import { canDeployConnection } from '../../helpers/connectionState';
import { useConnectionActions } from '../../hooks/useConnectionActions';
import { useConnectionMeta } from '../../hooks/useConnectionMeta';
import { RunsList } from '../../RunsList';
import { SecretsUnreadableChip } from '../../SecretsUnreadableChip';

type SummaryViewProps = { connection: DeploymentConnectionSummary };

/**
 * A connection for an admin who may trigger deployments but not manage them: its state, Deploy now and its
 * runs. Its settings, secrets and URLs belong to managers and are not loaded.
 */
export const SummaryView = ({ connection }: SummaryViewProps) => {
  const { t } = useTranslation();
  const { cursor } = useSearch({ from: '/app/publishing/deployments/$connectionId' });
  const navigate = useNavigate({ from: '/publishing/deployments/$connectionId' });
  const actions = useConnectionActions(connection);
  const { meta } = useConnectionMeta(connection);
  return (
    <Page>
      <PageHeader
        breadcrumb={[
          { label: t('nav.publishing') },
          { label: t('publishing.nav.deployments'), link: linkOptions({ to: '/publishing/deployments' }) },
        ]}
        title={connection.name}
        badge={
          <>
            <EnabledChip enabled={connection.enabled} />
            <SecretsUnreadableChip unreadable={connection.secretsUnreadable} />
          </>
        }
        meta={meta}
        actions={
          <Button
            disabled={actions.triggering || !canDeployConnection(connection)}
            onClick={actions.triggerRun}
          >
            <Rocket aria-hidden="true" />
            {t('publishing.deployments.triggerRun')}
          </Button>
        }
      />
      <Panel title={t('publishing.deployments.runs')} flush>
        <RunsList
          connectionId={connection.id}
          cursor={cursor}
          onCursorChange={(next) => void navigate({ search: { cursor: next } })}
        />
      </Panel>
    </Page>
  );
};
