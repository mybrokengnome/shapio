import type { Webhook } from '@shapio/client';
import { linkOptions } from '@tanstack/react-router';
import { KeyRound, Power, Send, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { queryKeys } from '@/api/queryKeys';
import { InlineConfirm } from '@/components/InlineConfirm';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Panel } from '@/components/Panel';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EnabledChip } from '../../../EnabledChip';
import { useConflictReload } from '../../../hooks/useConflictReload';
import { SignatureHelp } from '../../../SignatureHelp';
import { useWebhookActions } from '../../hooks/useWebhookActions';
import { SigningSecretReveal } from '../../SigningSecretReveal';
import { SiteBadge } from '../../SiteBadge';
import { Deliveries } from '../Deliveries';
import { EditForm } from '../EditForm';

type ViewProps = { webhook: Webhook };

/** A loaded webhook: actions, the delivery log, its settings and how receivers verify requests. */
export const View = ({ webhook }: ViewProps) => {
  const { t } = useTranslation();
  const conflict = useConflictReload(queryKeys.publishing.webhooks.webhook(webhook.id));
  const actions = useWebhookActions(webhook, conflict.onSaveError);
  return (
    <Page>
      <PageHeader
        breadcrumb={[
          { label: t('nav.publishing') },
          { label: t('publishing.nav.webhooks'), link: linkOptions({ to: '/publishing/webhooks' }) },
        ]}
        title={webhook.name}
        badge={
          <span className="flex items-center gap-2">
            <EnabledChip enabled={webhook.enabled} />
            <SiteBadge webhook={webhook} />
          </span>
        }
        meta={<span className="font-mono text-xs break-all">{webhook.url}</span>}
        actions={
          <>
            <InlineConfirm
              tone="danger"
              title={t('publishing.webhooks.deleteTitle', { name: webhook.name })}
              description={t('publishing.webhooks.deleteDescription')}
              confirmLabel={t('common.delete')}
              onConfirm={actions.remove}
              trigger={
                <Button variant="destructive-ghost" disabled={actions.pending}>
                  <Trash2 aria-hidden="true" />
                  {t('common.delete')}
                </Button>
              }
            />
            <InlineConfirm
              tone="danger"
              title={t('publishing.webhooks.rotateTitle')}
              description={t('publishing.webhooks.rotateDescription')}
              confirmLabel={t('publishing.webhooks.rotateSecret')}
              onConfirm={actions.rotateSecret}
              // The new secret's reveal takes focus (its Copy button); don't pull it back to this button.
              onCloseAutoFocus={(event) => {
                if (actions.secret) {
                  event.preventDefault();
                }
              }}
              trigger={
                <Button variant="outline" disabled={actions.pending}>
                  <KeyRound aria-hidden="true" />
                  {t('publishing.webhooks.rotateSecret')}
                </Button>
              }
            />
            <Button variant="outline" disabled={actions.pending} onClick={actions.toggleEnabled}>
              <Power aria-hidden="true" />
              {webhook.enabled ? t('publishing.webhooks.disable') : t('publishing.webhooks.enable')}
            </Button>
            <Button disabled={actions.testing || !webhook.enabled} onClick={actions.sendTest}>
              <Send aria-hidden="true" />
              {t('publishing.webhooks.sendTest')}
            </Button>
          </>
        }
      />
      {actions.secret ? (
        <SigningSecretReveal secret={actions.secret} onDismiss={actions.clearSecret} />
      ) : null}
      {conflict.conflicted ? (
        <Alert variant="destructive">
          <AlertDescription>{t('publishing.conflictReloaded')}</AlertDescription>
        </Alert>
      ) : null}
      <Deliveries webhookId={webhook.id} />
      <Panel title={t('publishing.webhooks.settings')}>
        <EditForm
          key={webhook.version}
          webhook={webhook}
          onSaved={conflict.clearConflict}
          onConflict={conflict.onSaveError}
        />
      </Panel>
      <Panel title={t('publishing.webhooks.signatureTitle')}>
        <SignatureHelp description={t('publishing.webhooks.signatureDescription')} />
      </Panel>
    </Page>
  );
};
