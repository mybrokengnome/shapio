import type { AppRole } from '@shapio/client';
import { useNavigate } from '@tanstack/react-router';
import { Info, Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAppRoles, useDeleteAppRole } from '@/api/appRoles';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Tabs } from '../Tabs';
import { CreateSheet } from './CreateSheet';
import { readsAllModels, useGrantReadAll } from './hooks/useGrantReadAll';
import { Table } from './Table';

/** Settings → Roles → App roles: what anonymous callers and signed-in app users may do with content. */
export const AppRoles = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const roles = useAppRoles();
  const deleteAppRole = useDeleteAppRole();
  const [creating, setCreating] = useState(false);
  const { grantReadAll, pendingRoleId } = useGrantReadAll();
  const deleteRole = async (role: AppRole) => {
    await deleteAppRole.mutateAsync(role.id);
    toast.success(t('roles.deleted'));
  };
  return (
    <Page width="full">
      <PageHeader
        title={t('appRoles.title')}
        tabs={<Tabs />}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t('appRoles.create')}
          </Button>
        }
      />
      <QueryView
        query={roles}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState icon={ShieldCheck} title={t('roles.empty')} />}
      >
        {(data) => (
          <div className="space-y-4">
            {data.some((role) => role.isSystem && !readsAllModels(role)) ? (
              <Alert variant="info" role="note">
                <Info aria-hidden="true" />
                <AlertDescription>{t('appRoles.denyByDefault')}</AlertDescription>
              </Alert>
            ) : null}
            <Table
              roles={data}
              onDelete={deleteRole}
              onGrantReadAll={grantReadAll}
              pendingRoleId={pendingRoleId}
            />
          </div>
        )}
      </QueryView>
      <CreateSheet
        open={creating}
        onOpenChange={setCreating}
        onCreated={(role) => {
          setCreating(false);
          void navigate({ to: '/network/roles/app/$roleId', params: { roleId: role.id } });
        }}
      />
    </Page>
  );
};
