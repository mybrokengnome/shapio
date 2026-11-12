import type { ApiToken } from '@shapio/client';
import { KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useMe } from '@/api/auth';
import { useDraftRoleIds, useRoleNames } from '@/api/roles';
import { useApiTokens, useRevokeApiToken } from '@/api/tokens';
import { useTokenSchemaVersions } from '@/api/usage';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { SecretReveal } from '@/components/SecretReveal';
import { Button } from '@/components/ui/button';
import { CreateSheet } from '../CreateSheet';
import { EditSheet } from '../EditSheet';
import { listedTokens } from '../helpers/tokenState';
import { Table } from '../Table';

/** API tokens for admins with `tokens.manage`: the list, New token, and the one-time secret. */
export const Manage = () => {
  const { t } = useTranslation();
  const tokens = useApiTokens();
  const { names: roleNames } = useRoleNames();
  const { draftRoleIds } = useDraftRoleIds();
  const { schemaVersions } = useTokenSchemaVersions();
  const siteName = useMe().data?.site.name ?? '';
  const revoke = useRevokeApiToken();
  const [creating, setCreating] = useState(false);
  // The token being edited stays set while its sheet closes, so the title doesn't flicker.
  const [editing, setEditing] = useState<ApiToken | undefined>(undefined);
  const [editOpen, setEditOpen] = useState(false);
  const editToken = (token: ApiToken) => {
    setEditing(token);
    setEditOpen(true);
  };
  // The new token's secret, held only in memory until the admin says they've copied it.
  const [secret, setSecret] = useState<string | undefined>(undefined);
  const revokeToken = async (token: ApiToken) => {
    await revoke.mutateAsync(token.id);
    toast.success(t('apiTokens.revoked'));
  };
  const createButton = (
    <Button onClick={() => setCreating(true)}>
      <Plus aria-hidden="true" />
      {t('apiTokens.create')}
    </Button>
  );
  return (
    <Page width="full">
      <PageHeader title={t('apiTokens.title')} actions={createButton} />
      {secret ? (
        <SecretReveal
          title={t('apiTokens.secretTitle')}
          description={t('apiTokens.secretDescription')}
          label={t('apiTokens.secretLabel')}
          secret={secret}
          dismissLabel={t('apiTokens.secretDone')}
          onDismiss={() => setSecret(undefined)}
        />
      ) : null}
      <QueryView
        query={tokens}
        // Revoked tokens are gone for good: the list leaves them out, so revoking one removes its row.
        isEmpty={(data) => listedTokens(data).length === 0}
        empty={
          <EmptyState
            icon={KeyRound}
            title={t('apiTokens.empty')}
            description={t('apiTokens.emptyDescription')}
            action={createButton}
          />
        }
      >
        {(data) => (
          <Table
            tokens={listedTokens(data)}
            roleNames={roleNames}
            draftRoleIds={draftRoleIds}
            siteName={siteName}
            schemaVersions={schemaVersions}
            onEdit={editToken}
            onRevoke={revokeToken}
          />
        )}
      </QueryView>
      <EditSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        token={editing}
        onSaved={() => {
          setEditOpen(false);
          toast.success(t('apiTokens.saved'));
        }}
      />
      <CreateSheet
        open={creating}
        onOpenChange={setCreating}
        onCreated={(created) => {
          setSecret(created.token);
          setCreating(false);
        }}
        // The secret took focus as it appeared; don't hand it back to the "New token" button.
        onCloseAutoFocus={(event) => secret !== undefined && event.preventDefault()}
      />
    </Page>
  );
};
