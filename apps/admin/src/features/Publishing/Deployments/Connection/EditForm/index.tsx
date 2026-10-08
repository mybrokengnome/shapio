import type { DeploymentConnection } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { SubmitButton } from '@/components/SubmitButton';
import { FieldGroup } from '@/components/ui/field';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { ConnectionForm } from '../../ConnectionForm';
import { useEditConnectionForm } from '../../hooks/useEditConnectionForm';

type EditFormProps = {
  connection: DeploymentConnection;
  /** Receives any secret the server generated on this save, to show once. */
  onSaved: (generatedSecrets: Record<string, string> | undefined) => void;
  onConflict: (error: unknown) => void;
};

export const EditForm = ({ connection, onSaved, onConflict }: EditFormProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, update, error } = useEditConnectionForm(connection, onSaved, onConflict);
  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)}>
      <UnsavedChangesGuard when={form.formState.isDirty && !update.isPending} />
      <FieldGroup>
        <ConnectionForm
          control={form.control}
          mode="edit"
          storedSecrets={connection.secrets}
          secretsUnreadable={connection.secretsUnreadable}
        />
        <FormError error={error} />
        <div>
          <SubmitButton pending={update.isPending} pendingLabel={t('common.saving')}>
            {t('common.saveChanges')}
          </SubmitButton>
        </div>
      </FieldGroup>
    </form>
  );
};
