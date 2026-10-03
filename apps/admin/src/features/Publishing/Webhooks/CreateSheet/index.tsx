import type { WebhookWithSecret } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { useMe } from '@/api/auth';
import { FormError } from '@/components/FormError';
import { FormRadioGroup } from '@/components/FormRadioGroup';
import { FormSheet } from '@/components/FormSheet';
import { canSeeNetwork } from '@/helpers/sites';
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
  const { data: me } = useMe();
  // A network webhook needs `webhooks.manage` on every site; `me` can't say that exactly, so it is offered to
  // network admins and the server's answer (403) is shown if it refuses.
  const scopeOptions = [
    { value: 'site', label: t('publishing.webhooks.scopeSite', { name: me?.site.name ?? '' }) },
    { value: 'network', label: t('sites.everySite'), description: t('publishing.webhooks.scopeNetwork') },
  ];
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
      {canSeeNetwork(me) ? (
        <FormRadioGroup
          control={form.control}
          name="scope"
          legend={t('publishing.webhooks.scope')}
          options={scopeOptions}
        />
      ) : null}
      <FormError error={createWebhook.error} />
    </FormSheet>
  );
};
