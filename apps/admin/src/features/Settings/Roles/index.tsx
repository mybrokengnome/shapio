import type { Role } from '@shapio/client';
import { Plus, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDeleteRole, useRoles } from '@/api/roles';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { Button } from '@/components/ui/button';
import { useConfirmTarget } from '@/hooks/useConfirmTarget';
import { RoleSheet } from './RoleSheet';
import { Table } from './Table';
import { Tabs } from './Tabs';

export const Roles = () => {
  const { t } = useTranslation();
  const roles = useRoles();
  const deleteRole = useDeleteRole();
  const confirmDelete = useConfirmTarget<Role>();
  const [sheet, setSheet] = useState<{ open: boolean; role: Role | undefined }>({
    open: false,
    role: undefined,
  });
  return (
    <Page width="full">
      <PageHeader
        title={t('roles.title')}
        tabs={<Tabs />}
        actions={
          <Button onClick={() => setSheet({ open: true, role: undefined })}>
            <Plus aria-hidden="true" />
            {t('roles.create')}
          </Button>
        }
      />
      <QueryView
        query={roles}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState icon={ShieldCheck} title={t('roles.empty')} />}
      >
        {(data) => (
          <Table
            roles={data}
            onEdit={(role) => setSheet({ open: true, role })}
            onDelete={(role) => confirmDelete.ask(role)}
          />
        )}
      </QueryView>
      <RoleSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((current) => ({ ...current, open }))}
        role={sheet.role}
      />
      <ConfirmDialog
        open={confirmDelete.open}
        onOpenChange={confirmDelete.onOpenChange}
        title={t('roles.deleteTitle', { name: confirmDelete.target?.name ?? '' })}
        description={t('roles.deleteDescription')}
        confirmLabel={t('common.delete')}
        destructive
        onConfirm={() => {
          if (confirmDelete.target) {
            deleteRole.mutate(confirmDelete.target.id, {
              onSuccess: () => toast.success(t('roles.deleted')),
            });
          }
        }}
      />
    </Page>
  );
};
