import { useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Page } from '@/components/Page';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { CreateSheet } from './CreateSheet';
import { useDevelopPermissions } from './hooks/useDevelopPermissions';
import { NoAccess } from './NoAccess';
import { OpenSets } from './OpenSets';
import { Scheduled } from './Scheduled';
import { Unassigned } from './Unassigned';

/** Changes: open change sets (pull-request shaped), drafts not in a set yet, and scheduled publications. */
export const Changes = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { canManageChanges } = useDevelopPermissions();
  const [creating, setCreating] = useState(false);
  return (
    <Page>
      <PageHeader
        title={t('changes.title')}
        actions={
          canManageChanges ? (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              {t('changes.create')}
            </Button>
          ) : undefined
        }
      />
      {canManageChanges ? (
        <>
          <OpenSets />
          <Unassigned />
          <Scheduled />
          <CreateSheet
            open={creating}
            onOpenChange={setCreating}
            onCreated={(set) => {
              setCreating(false);
              void navigate({ to: '/changes/$changeSetId', params: { changeSetId: set.id } });
            }}
          />
        </>
      ) : (
        <NoAccess />
      )}
    </Page>
  );
};
