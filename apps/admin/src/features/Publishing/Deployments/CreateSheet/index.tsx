import type { DeploymentConnectionCreated } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormSheet } from '@/components/FormSheet';
import { ConnectionForm } from '../ConnectionForm';
import { useCreateConnectionForm } from '../hooks/useCreateConnectionForm';

type CreateSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lets the page keep focus on the secret it reveals when the sheet closes. */
  onCloseAutoFocus: (event: Event) => void;
  onCreated: (created: DeploymentConnectionCreated) => void;
};

export const CreateSheet = ({ open, onOpenChange, onCloseAutoFocus, onCreated }: CreateSheetProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, createConnection } = useCreateConnectionForm(open, onCreated);
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('publishing.deployments.createTitle')}
      dirty={form.formState.isDirty}
      pending={createConnection.isPending}
      submitLabel={t('common.create')}
      pendingLabel={t('common.saving')}
      onSubmit={(event) => void onSubmit(event)}
    >
      <ConnectionForm control={form.control} mode="create" />
      <FormError error={createConnection.error} />
    </FormSheet>
  );
};
