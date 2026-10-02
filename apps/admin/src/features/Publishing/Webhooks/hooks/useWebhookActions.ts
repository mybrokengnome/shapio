import type { Webhook } from '@shapio/client';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useDeleteWebhook, useRotateWebhookSecret, useTestWebhook, useUpdateWebhook } from '@/api/webhooks';

/**
 * Send test, enable/disable, rotate the secret (shown once) and delete, each with its notification. Rotate
 * and delete return their promise, so their inline confirmation stays open until the request settles.
 */
export const useWebhookActions = (webhook: Webhook, onConflict: (error: unknown) => void) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const test = useTestWebhook();
  const update = useUpdateWebhook();
  const rotate = useRotateWebhookSecret();
  const remove = useDeleteWebhook();
  const [secret, setSecret] = useState<string | undefined>(undefined);
  return {
    secret,
    clearSecret: () => setSecret(undefined),
    testing: test.isPending,
    pending: update.isPending || rotate.isPending || remove.isPending,
    sendTest: () =>
      test.mutate(webhook.id, { onSuccess: () => toast.success(t('publishing.webhooks.testQueued')) }),
    toggleEnabled: () =>
      update.mutate(
        { id: webhook.id, input: { enabled: !webhook.enabled, expectedVersion: webhook.version } },
        {
          onSuccess: (saved) =>
            toast.success(
              saved.enabled ? t('publishing.webhooks.enabledToast') : t('publishing.webhooks.disabledToast'),
            ),
          onError: onConflict,
        },
      ),
    rotateSecret: () => rotate.mutateAsync(webhook.id, { onSuccess: (rotated) => setSecret(rotated.secret) }),
    remove: () =>
      remove.mutateAsync(webhook.id, {
        onSuccess: () => {
          toast.success(t('publishing.webhooks.deleted', { name: webhook.name }));
          void navigate({ to: '/publishing/webhooks' });
        },
      }),
  };
};
