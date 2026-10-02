import type { Webhook } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { SubmitButton } from '@/components/SubmitButton';
import { FieldGroup } from '@/components/ui/field';
import { UnsavedChangesGuard } from '@/components/UnsavedChangesGuard';
import { Fields } from '../../Fields';
import { useEditWebhookForm } from '../../hooks/useEditWebhookForm';

type EditFormProps = { webhook: Webhook; onSaved: () => void; onConflict: (error: unknown) => void };

export const EditForm = ({ webhook, onSaved, onConflict }: EditFormProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, update, error } = useEditWebhookForm(webhook, onSaved, onConflict);
  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)}>
      <UnsavedChangesGuard when={form.formState.isDirty && !update.isPending} />
      <FieldGroup>
        <Fields control={form.control} />
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
