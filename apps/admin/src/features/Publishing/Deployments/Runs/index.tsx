import type { DeploymentRun } from '@shapio/client';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { RowTitle } from '@/components/RowTitle';
import {
  Table as TableRoot,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { RUN_TRIGGER_LABELS } from '../../constants';
import { RunStatus } from '../RunStatus';

type RunsProps = { runs: DeploymentRun[]; showConnection: boolean };

/** Deployment runs, newest first; each opens its detail page. */
export const Runs = ({ runs, showConnection }: RunsProps) => {
  const { t } = useTranslation();
  return (
    <TableRoot>
      <TableHeader>
        <TableRow>
          <TableHead>{t('publishing.deployments.run')}</TableHead>
          <TableHead>{t('publishing.fields.status')}</TableHead>
          {showConnection ? <TableHead>{t('publishing.deployments.connection')}</TableHead> : null}
          <TableHead>{t('publishing.deployments.trigger')}</TableHead>
          <TableHead>{t('publishing.fields.snapshot')}</TableHead>
          <TableHead>{t('publishing.deployments.finishedAt')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell className="whitespace-nowrap">
              <RowTitle asChild>
                <Link
                  to="/publishing/deployments/runs/$runId"
                  params={{ runId: run.id }}
                  aria-label={t('publishing.deployments.openRun', {
                    connection: run.connectionName,
                    at: formatDateTime(run.createdAt),
                  })}
                >
                  {formatDateTime(run.createdAt)}
                </Link>
              </RowTitle>
            </TableCell>
            <TableCell>
              <RunStatus run={run} />
            </TableCell>
            {showConnection ? (
              <TableCell className="max-w-56 truncate">{run.connectionName}</TableCell>
            ) : null}
            <TableCell>{t(RUN_TRIGGER_LABELS[run.trigger])}</TableCell>
            <TableCell className="tabular-nums">
              {run.snapshot === null
                ? t('common.none')
                : t('publishing.snapshotNumber', { snapshot: run.snapshot })}
            </TableCell>
            <TableCell className="whitespace-nowrap" title={formatDateTime(run.finishedAt)}>
              {run.finishedAt ? formatRelativeTime(run.finishedAt) : t('common.none')}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </TableRoot>
  );
};
