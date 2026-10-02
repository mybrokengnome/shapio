import type { DeploymentConnection } from '@shapio/client';
import { linkOptions, useNavigate, useSearch } from '@tanstack/react-router';
import { Loader2, PlugZap, Rocket, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/api/queryKeys';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { PROVIDER_LABELS } from '../../../constants';
import { EnabledChip } from '../../../EnabledChip';
import { useConflictReload } from '../../../hooks/useConflictReload';
import { usePublishingPermissions } from '../../../hooks/usePublishingPermissions';
import { CallbackHelp } from '../../CallbackHelp';
import { useConnectionActions } from '../../hooks/useConnectionActions';
import { RunsList } from '../../RunsList';
import { EditForm } from '../EditForm';
import { TestResult } from '../TestResult';

type ViewProps = { connection: DeploymentConnection };

/** A loaded connection: test, trigger, its runs, the callback contract (generic) and its settings. */
export const View = ({ connection }: ViewProps) => {
  const { t } = useTranslation();
  const { cursor } = useSearch({ from: '/app/publishing/deployments/$connectionId' });
  const navigate = useNavigate({ from: '/publishing/deployments/$connectionId' });
  const conflict = useConflictReload(queryKeys.publishing.deployments.connection(connection.id));
  const actions = useConnectionActions(connection);
  const { canTriggerDeployments } = usePublishingPermissions();
  const busy = actions.testing || actions.triggering || actions.deleting;
  const snapshot = connection.currentRun?.snapshot;
  const meta = [
    t(PROVIDER_LABELS[connection.provider]),
    snapshot != null
      ? t('publishing.deployments.liveSnapshot', { snapshot: t('publishing.snapshotNumber', { snapshot }) })
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <Page>
      <PageHeader
        breadcrumb={[
          { label: t('nav.publishing') },
          { label: t('publishing.nav.deployments'), link: linkOptions({ to: '/publishing/deployments' }) },
        ]}
        title={connection.name}
        badge={<EnabledChip enabled={connection.enabled} />}
        meta={meta}
        actions={
          <>
            <InlineConfirm
              tone="danger"
              title={t('publishing.deployments.deleteTitle', { name: connection.name })}
              description={t('publishing.deployments.deleteDescription')}
              confirmLabel={t('common.delete')}
              onConfirm={actions.remove}
              trigger={
                <Button variant="destructive-ghost" disabled={busy}>
                  <Trash2 aria-hidden="true" />
                  {t('common.delete')}
                </Button>
              }
            />
            <Button variant="outline" disabled={busy} onClick={actions.runTest}>
              {actions.testing ? (
                <Loader2 aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
              ) : (
                <PlugZap aria-hidden="true" />
              )}
              {t('publishing.deployments.test')}
            </Button>
            {canTriggerDeployments ? (
              <Button disabled={busy || !connection.enabled} onClick={actions.triggerRun}>
                <Rocket aria-hidden="true" />
                {t('publishing.deployments.triggerRun')}
              </Button>
            ) : null}
          </>
        }
      />
      {actions.testResult ? <TestResult result={actions.testResult} /> : null}
      <Panel title={t('publishing.deployments.runs')} flush>
        <RunsList
          connectionId={connection.id}
          cursor={cursor}
          onCursorChange={(next) => void navigate({ search: { cursor: next } })}
        />
      </Panel>
      {connection.provider === 'generic_webhook' ? (
        <Panel
          title={t('publishing.deployments.callbacks')}
          description={t('publishing.deployments.callbacksDescription')}
        >
          <CallbackHelp callbackUrl={connection.callbackUrl} />
        </Panel>
      ) : null}
      <Panel title={t('publishing.deployments.settings')} bodyClassName="space-y-4">
        {conflict.conflicted ? (
          <Alert variant="destructive">
            <AlertDescription>{t('publishing.conflictReloaded')}</AlertDescription>
          </Alert>
        ) : null}
        <EditForm
          key={connection.version}
          connection={connection}
          onSaved={conflict.clearConflict}
          onConflict={conflict.onSaveError}
        />
      </Panel>
    </Page>
  );
};
