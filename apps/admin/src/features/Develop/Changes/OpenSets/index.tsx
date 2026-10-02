import { GitPullRequest } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useChangeSets } from '@/api/changeSets';
import { useDeploymentConnections } from '@/api/deployments';
import { EmptyState } from '@/components/EmptyState';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Row } from './Row';

/** Sets still in flight: open, scheduled, shipping or failed. */
export const OpenSets = () => {
  const { t } = useTranslation();
  const sets = useChangeSets();
  const connections = useDeploymentConnections();
  const connectionName = (id: string | null) =>
    id ? connections.data?.find((connection) => connection.id === id)?.name : undefined;
  return (
    <Panel title={t('changes.openTitle')} flush>
      <QueryView
        query={sets}
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            icon={GitPullRequest}
            size="panel"
            title={t('changes.empty')}
            description={t('changes.emptyDescription')}
          />
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
