import type { AdminSession } from '@shapio/client';
import { MonitorSmartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useRevokeSession, useSessions } from '@/api/sessions';
import { EmptyState } from '@/components/EmptyState';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { QueryView } from '@/components/QueryView';
import { Table } from './Table';

export const Sessions = () => {
  const { t } = useTranslation();
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const revokeSession = async (session: AdminSession) => {
    await revoke.mutateAsync(session.id);
    toast.success(t('sessions.revoked'));
  };
  return (
    <Page width="full">
      <PageHeader title={t('sessions.title')} />
      <QueryView
        query={sessions}
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState icon={MonitorSmartphone} title={t('sessions.empty')} />}
      >
        {(data) => <Table sessions={data} onRevoke={revokeSession} />}
      </QueryView>
    </Page>
  );
};
