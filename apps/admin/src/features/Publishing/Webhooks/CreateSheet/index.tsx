import type { WebhookWithSecret } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { FormError } from '@/components/FormError';
import { FormSheet } from '@/components/FormSheet';
import { Fields } from '../Fields';
import { useCreateWebhookForm } from '../hooks/useCreateWebhookForm';

type CreateSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lets the page keep focus on the secret it reveals when the sheet closes. */
  onCloseAutoFocus: (event: Event) => void;
  onCreated: (created: WebhookWithSecret) => void;
};

export const CreateSheet = ({ open, onOpenChange, onCloseAutoFocus, onCreated }: CreateSheetProps) => {
  const { t } = useTranslation();
  const { form, onSubmit, createWebhook } = useCreateWebhookForm(open, onCreated);
  return (
    <FormSheet
      open={open}
      onOpenChange={onOpenChange}
      size="md"
      onCloseAutoFocus={onCloseAutoFocus}
      title={t('publishing.webhooks.createTitle')}
      dirty={form.formState.isDirty}
      pending={createWebhook.isPending}
      submitLabel={t('common.create')}
      pendingLabel={t('common.saving')}
      onSubmit={(event) => void onSubmit(event)}
    >
      <Fields control={form.control} />
      <FormError error={createWebhook.error} />
    </FormSheet>
  );
};
