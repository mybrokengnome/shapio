import { APPROVAL_STATUSES, type ApprovalStatus } from '@shapio/client';
import { GitPullRequest } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useChangeSets } from '@/api/changeSets';
import { useDeploymentConnections } from '@/api/deployments';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { StatusFilter } from '@/features/Publishing/StatusFilter';
import { Row } from './Row';

const APPROVAL_FILTER_KEYS = {
  none: 'changes.approval.filter.none',
  requested: 'changes.approval.statuses.requested',
  approved: 'changes.approval.statuses.approved',
  changes_requested: 'changes.approval.statuses.changesRequested',
} as const satisfies Record<ApprovalStatus, string>;

/** Sets still in flight: open, scheduled, shipping or failed; filtered by approval state on request. */
export const OpenSets = () => {
  const { t } = useTranslation();
  const filterId = useId();
  const [approval, setApproval] = useState<ApprovalStatus | undefined>();
  const sets = useChangeSets(undefined, approval);
  const connections = useDeploymentConnections();
  const connectionName = (id: string | null) =>
    id ? connections.data?.find((connection) => connection.id === id)?.name : undefined;
  return (
    <Panel
      title={t('changes.openTitle')}
      flush
      actions={
        <StatusFilter
          id={filterId}
          label={t('changes.approval.filter.label')}
          value={approval}
          options={APPROVAL_STATUSES.map((value) => ({ value, label: t(APPROVAL_FILTER_KEYS[value]) }))}
          onChange={setApproval}
        />
      }
    >
      <QueryView
        query={sets}
        isEmpty={(data) => data.items.length === 0}
        empty={
          approval ? (
            <EmptyState icon={GitPullRequest} size="panel" title={t('changes.approval.filter.empty')} />
          ) : (
            <EmptyState
              icon={GitPullRequest}
              size="panel"
              title={t('changes.empty')}
              description={t('changes.emptyDescription')}
            />
          )
        }
      >
        {(data) => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('changes.fields.title')}</TableHead>
                <TableHead>{t('changes.fields.status')}</TableHead>
                <TableHead className="text-right">{t('changes.fields.items')}</TableHead>
                <TableHead>{t('changes.fields.author')}</TableHead>
                <TableHead>{t('changes.fields.when')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((set) => (
                <Row key={set.id} set={set} connectionName={connectionName(set.deploymentConnectionId)} />
              ))}
            </TableBody>
          </Table>
        )}
      </QueryView>
    </Panel>
  );
};
