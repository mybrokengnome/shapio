import { useNavigate } from '@tanstack/react-router';
import { Plus, Webhook as WebhookIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useWebhooks } from '@/api/webhooks';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { QueryView } from '@/components/QueryView';
import { Button } from '@/components/ui/button';
import { Header } from '../Header';
import { useSecretReveal } from '../hooks/useSecretReveal';
import { CreateSheet } from './CreateSheet';
import { SigningSecretReveal } from './SigningSecretReveal';
import { Table } from './Table';

/** Outgoing webhooks: signed HTTP notifications of content, change set and deployment events. */
export const Webhooks = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const webhooks = useWebhooks();
  const [creating, setCreating] = useState(false);
  // The new webhook's secret is shown here, then the webhook opens.
  const secret = useSecretReveal(
    (webhookId) => void navigate({ to: '/publishing/webhooks/$webhookId', params: { webhookId } }),
  );
  return (
    <Page>
      <Header
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t('publishing.webhooks.create')}
          </Button>
        }
      />
      {secret.revealed ? (
        <SigningSecretReveal secret={secret.revealed.secret} onDismiss={secret.dismiss} />
      ) : null}
      <QueryView
        query={webhooks}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState icon={WebhookIcon} title={t('publishing.webhooks.empty')} />}
      >
        {(data) => <Table webhooks={data} />}
      </QueryView>
      <CreateSheet
        open={creating}
        onOpenChange={setCreating}
        onCloseAutoFocus={secret.keepFocusOnReveal}
        onCreated={({ webhook, secret: signingSecret }) => {
          setCreating(false);
          secret.reveal({ id: webhook.id, secret: signingSecret });
        }}
      />
    </Page>
  );
};
