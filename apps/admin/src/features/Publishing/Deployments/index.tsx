import { useNavigate, useSearch } from '@tanstack/react-router';
import { Plus, Rocket } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useDeploymentConnections } from '@/api/deployments';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { Panel } from '@/components/Panel';
import { QueryView } from '@/components/QueryView';
import { SecretReveal } from '@/components/SecretReveal';
import { Button } from '@/components/ui/button';
import { Header } from '../Header';
import { usePublishingPermissions } from '../hooks/usePublishingPermissions';
import { useSecretReveal } from '../hooks/useSecretReveal';
import { ConnectionCard } from './ConnectionCard';
import { CreateSheet } from './CreateSheet';
import { RunsList } from './RunsList';

/** Deployment connections as cards (managers) and the latest runs across all of them (everyone). */
export const Deployments = () => {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: '/publishing/deployments' });
  const { cursor } = useSearch({ from: '/app/publishing/deployments' });
  const { canManageDeployments } = usePublishingPermissions();
  const connections = useDeploymentConnections();
  const [creating, setCreating] = useState(false);
  const openConnection = (connectionId: string) =>
    void navigate({ to: '/publishing/deployments/$connectionId', params: { connectionId } });
  // A generated signing secret is shown here, then the connection opens.
  const secret = useSecretReveal(openConnection);
  return (
    <Page>
      <Header
        actions={
          canManageDeployments ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t('publishing.deployments.create')}
            </Button>
          ) : undefined
        }
      />
      {secret.revealed ? (
        <SecretReveal
          title={t('publishing.deployments.generatedSecretTitle')}
          description={t('publishing.deployments.generatedSecretDescription')}
          label={t('publishing.deployments.secretLabels.signingSecret')}
          secret={secret.revealed.secret}
          dismissLabel={t('publishing.secretDone')}
          onDismiss={secret.dismiss}
        />
      ) : null}
      {canManageDeployments ? (
        <section aria-labelledby="deployment-connections" className="space-y-3">
          <h2 id="deployment-connections" className="text-base font-semibold">
            {t('publishing.deployments.connections')}
          </h2>
          <QueryView
            query={connections}
            isEmpty={(data) => data.length === 0}
            empty={<EmptyState icon={Rocket} title={t('publishing.deployments.empty')} />}
          >
            {(data) => (
              <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {data.map((connection) => (
                  <li key={connection.id} className="grid">
                    <ConnectionCard connection={connection} />
                  </li>
                ))}
              </ul>
            )}
          </QueryView>
        </section>
      ) : null}
      <Panel title={t('publishing.deployments.recentRuns')} flush>
        <RunsList
          connectionId={undefined}
          cursor={cursor}
          onCursorChange={(next) => void navigate({ search: { cursor: next } })}
        />
      </Panel>
      <CreateSheet
        open={creating}
        onOpenChange={setCreating}
        onCloseAutoFocus={secret.keepFocusOnReveal}
        onCreated={({ connection, generatedSecrets }) => {
          setCreating(false);
          const generated = generatedSecrets.signingSecret;
          if (generated) {
            secret.reveal({ id: connection.id, secret: generated });
          } else {
            openConnection(connection.id);
          }
        }}
      />
    </Page>
  );
};
