import { zodResolver } from '@hookform/resolvers/zod';
import type { Webhook } from '@shapio/client';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { isConflict } from '@/api/errors';
import { useUpdateWebhook } from '@/api/webhooks';
import { settle } from '@/helpers/settle';
import { toWebhookInput, toWebhookValues, webhookSchema, type WebhookFormValues } from '../helpers';

/**
 * Edits one version of a webhook (the form is re-created when the version changes). Saves send the
 * version they started from; a 409 goes to `onConflict`.
 */
export const useEditWebhookForm = (
  webhook: Webhook,
  onSaved: () => void,
  onConflict: (error: unknown) => void,
) => {
  const { t } = useTranslation();
  const update = useUpdateWebhook();
  const form = useForm<WebhookFormValues>({
    resolver: zodResolver(webhookSchema),
    defaultValues: toWebhookValues(webhook),
  });
  const onSubmit = form.handleSubmit(async (values) => {
    const saved = await settle(
      update.mutateAsync(
        { id: webhook.id, input: { ...toWebhookInput(values), expectedVersion: webhook.version } },
        { onError: onConflict },
      ),
    );
    if (saved.ok) {
      toast.success(t('publishing.webhooks.saved'));
      onSaved();
    }
  });
  return { form, onSubmit, update, error: isConflict(update.error) ? undefined : update.error };
};
