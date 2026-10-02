import type { DeploymentRun } from '@shapio/client';
import { linkOptions, useNavigate } from '@tanstack/react-router';
import { AlertCircle, Info, RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useRetryDeploymentRun } from '@/api/deployments';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { TextLink } from '@/components/TextLink';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ACTIVE_RUN_STATUSES } from '@/constants/publishing';
import { formatDateTime } from '@/helpers/formatDate';
import { PROVIDER_LABELS, RUN_TRIGGER_LABELS } from '../../../constants';
import { DetailList, type DetailItem } from '../../../DetailList';
import { ExternalLink } from '../../../ExternalLink';
import { safeExternalUrl } from '../../../helpers/safeExternalUrl';
import { usePublishingPermissions } from '../../../hooks/usePublishingPermissions';
import { RunStatus } from '../../RunStatus';
import { Timeline } from '../Timeline';

type ViewProps = { run: DeploymentRun };

/** A loaded run: honest status, links, error, timeline and retry. */
export const View = ({ run }: ViewProps) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canTriggerDeployments } = usePublishingPermissions();
  const retry = useRetryDeploymentRun();
  const none = t('common.none');
  const logUrl = safeExternalUrl(run.logUrl);
  const siteUrl = safeExternalUrl(run.siteUrl);
  const active = ACTIVE_RUN_STATUSES.has(run.status);
  const details: DetailItem[] = [
    { label: t('publishing.deployments.connection'), value: run.connectionName },
    { label: t('publishing.deployments.provider'), value: t(PROVIDER_LABELS[run.provider]) },
    { label: t('publishing.deployments.trigger'), value: t(RUN_TRIGGER_LABELS[run.trigger]) },
    {
      label: t('publishing.fields.snapshot'),
      value: run.snapshot === null ? none : t('publishing.snapshotNumber', { snapshot: run.snapshot }),
    },
    { label: t('publishing.deployments.schemaVersion'), value: run.schemaVersion ?? none },
    { label: t('publishing.deployments.providerRef'), value: run.providerRef ?? none },
    { label: t('publishing.deployments.triggeredAt'), value: formatDateTime(run.triggeredAt) || none },
    { label: t('publishing.deployments.finishedAt'), value: formatDateTime(run.finishedAt) || none },
    {
      label: t('publishing.deployments.logUrl'),
      value: logUrl ? <ExternalLink href={logUrl}>{logUrl}</ExternalLink> : none,
    },
    {
      label: t('publishing.deployments.siteUrl'),
      value: siteUrl ? <ExternalLink href={siteUrl}>{siteUrl}</ExternalLink> : none,
    },
  ];
  if (run.retryOf) {
    details.push({
      label: t('publishing.deployments.retryOf'),
      value: (
        <TextLink to="/publishing/deployments/runs/$runId" params={{ runId: run.retryOf }}>
          {t('publishing.deployments.previousRun')}
        </TextLink>
      ),
    });
  }
  return (
    <Page>
      <PageHeader
        breadcrumb={[
          { label: t('nav.publishing') },
          { label: t('publishing.nav.deployments'), link: linkOptions({ to: '/publishing/deployments' }) },
          {
            label: run.connectionName,
            link: linkOptions({
              to: '/publishing/deployments/$connectionId',
              params: { connectionId: run.connectionId },
            }),
          },
        ]}
        title={t('publishing.deployments.runTitle', { connection: run.connectionName })}
        badge={
          <span aria-live="polite">
            <RunStatus run={run} />
          </span>
        }
        meta={
          active
            ? `${formatDateTime(run.createdAt)} · ${t('publishing.deployments.watching')}`
            : formatDateTime(run.createdAt)
        }
        actions={
          canTriggerDeployments && !active ? (
            <Button
              variant="outline"
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate(run.id, {
                  onSuccess: (next) => {
                    toast.success(t('publishing.deployments.retried'));
                    void navigate({ to: '/publishing/deployments/runs/$runId', params: { runId: next.id } });
                  },
                })
              }
            >
              <RotateCcw aria-hidden="true" />
              {t('publishing.deployments.retry')}
            </Button>
          ) : undefined
        }
      />
      {run.status === 'triggered' && !run.completionReported ? (
        <Alert variant="info">
          <Info aria-hidden="true" />
          <AlertDescription>{t('publishing.deployments.completionUnknown')}</AlertDescription>
        </Alert>
      ) : null}
      {run.error ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{run.error}</AlertDescription>
        </Alert>
      ) : null}
      <Panel title={t('publishing.deployments.details')}>
        <DetailList items={details} />
      </Panel>
      <Panel title={t('publishing.deployments.timeline')}>
        <Timeline run={run} />
      </Panel>
    </Page>
  );
};
