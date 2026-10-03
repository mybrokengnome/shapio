import { zodResolver } from '@hookform/resolvers/zod';
import type { WebhookWithSecret } from '@shapio/client';
import { useForm } from 'react-hook-form';
import { useCreateWebhook } from '@/api/webhooks';
import { settle } from '@/helpers/settle';
import { useResetOnOpen } from '../../hooks/useResetOnOpen';
import { EMPTY_WEBHOOK, toWebhookInput, webhookSchema, type WebhookFormValues } from '../helpers';

export const useCreateWebhookForm = (open: boolean, onCreated: (created: WebhookWithSecret) => void) => {
  const createWebhook = useCreateWebhook();
  const form = useForm<WebhookFormValues>({
    resolver: zodResolver(webhookSchema),
    defaultValues: EMPTY_WEBHOOK,
  });
  useResetOnOpen(open, form.reset, EMPTY_WEBHOOK, createWebhook.reset);
  const onSubmit = form.handleSubmit(async (values) => {
    const created = await settle(
      createWebhook.mutateAsync({ ...toWebhookInput(values), network: values.scope === 'network' }),
    );
    if (created.ok) {
      form.reset(EMPTY_WEBHOOK);
      onCreated(created.value);
    }
  });
  return { form, onSubmit, createWebhook };
};
