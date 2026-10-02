import { useTranslation } from 'react-i18next';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { useDevelopPermissions } from '../Changes/hooks/useDevelopPermissions';
import { NoAccess } from '../Changes/NoAccess';
import { FailedJobs } from './FailedJobs';
import { HealthCard } from './HealthCard';
import { OperationsCard } from './OperationsCard';
import { ReadersTable } from './ReadersTable';
import { SnapshotCard } from './SnapshotCard';

/**
 * Live: what production serves and who reads it. Sections show only with their permission: the snapshot
 * with `changes.manage`, readers with `tokens.manage`, webhooks with theirs, and failed jobs (only when
 * there are any) with `publishing.manage`.
 */
export const Live = () => {
  const { t } = useTranslation();
  const { canManageChanges, canReadUsage, canManagePublishing, canManageWebhooks } = useDevelopPermissions();
  const anything = canManageChanges || canReadUsage || canManagePublishing || canManageWebhooks;
  return (
    <Page>
      <PageHeader title={t('develop.live.title')} />
      {anything ? null : <NoAccess />}
      {canManageChanges ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <SnapshotCard />
          <HealthCard />
        </div>
      ) : null}
      {canReadUsage ? <ReadersTable /> : null}
      {canManagePublishing ? <FailedJobs /> : null}
      <OperationsCard />
    </Page>
  );
};
