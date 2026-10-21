import { useParams } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { useDeploymentConnection, useDeploymentConnectionSummary } from '@/api/deployments';
import { NoAccess } from '@/components/NoAccess';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { usePublishingPermissions } from '../../hooks/usePublishingPermissions';
import { SummaryView } from './SummaryView';
import { View } from './View';

/**
 * One deployment connection: the full page for managers, its state, Deploy now and runs for admins who may
 * only trigger, and the reason for anyone else (reached by URL). Only what the admin may read is requested.
 */
export const Connection = () => {
  const { t } = useTranslation();
  const { connectionId } = useParams({ from: '/app/publishing/deployments/$connectionId' });
  const { canManageDeployments, canTriggerDeployments } = usePublishingPermissions();
  const triggerOnly = !canManageDeployments && canTriggerDeployments;
  const connection = useDeploymentConnection(connectionId, canManageDeployments);
  const summary = useDeploymentConnectionSummary(connectionId, triggerOnly);
  if (canManageDeployments) {
    return (
      <QueryView query={connection} loadingRows={6}>
        {(data) => <View connection={data} />}
      </QueryView>
    );
  }
  if (triggerOnly) {
    return (
      <QueryView query={summary} loadingRows={4}>
        {(data) => <SummaryView connection={data} />}
      </QueryView>
    );
  }
  return (
    <Page>
      <PageHeader title={t('publishing.nav.deployments')} />
      <NoAccess />
    </Page>
  );
};
