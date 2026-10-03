import type { CreateWebhookInput, Webhook } from '@shapio/client';
import { z } from 'zod';
import { requiredText } from '@/helpers/validation';

export const MAX_ATTEMPTS_RANGE = { min: 1, max: 20 } as const;

const DEFAULT_MAX_ATTEMPTS = 8;

const inRange = (value: string) =>
  /^\d+$/.test(value) && Number(value) >= MAX_ATTEMPTS_RANGE.min && Number(value) <= MAX_ATTEMPTS_RANGE.max;

export const webhookSchema = z.object({
  name: requiredText().max(200, 'validation.tooLong'),
  url: z
    .string()
    .trim()
    .min(1, 'validation.required')
    .pipe(z.url({ protocol: /^https?$/, error: 'validation.url' })),
  events: z.array(z.string()).min(1, 'validation.selectEvents'),
  enabled: z.boolean(),
  allowPrivateNetwork: z.boolean(),
  maxAttempts: z.string().trim().refine(inRange, 'validation.maxAttempts'),
  /** Chosen on create only (fixed afterwards): `site` this site's events, `network` every site's. */
  scope: z.enum(['site', 'network']),
});

export type WebhookFormValues = z.infer<typeof webhookSchema>;

export const EMPTY_WEBHOOK: WebhookFormValues = {
  name: '',
  url: '',
  events: [],
  enabled: true,
  allowPrivateNetwork: false,
  maxAttempts: String(DEFAULT_MAX_ATTEMPTS),
  scope: 'site',
};

export const toWebhookValues = (webhook: Webhook): WebhookFormValues => ({
  name: webhook.name,
  url: webhook.url,
  events: webhook.events,
  enabled: webhook.enabled,
  allowPrivateNetwork: webhook.allowPrivateNetwork,
  maxAttempts: String(webhook.maxAttempts),
  scope: webhook.site === null ? 'network' : 'site',
});

export const toWebhookInput = (values: WebhookFormValues): CreateWebhookInput => ({
  name: values.name.trim(),
  url: values.url.trim(),
  events: values.events,
  enabled: values.enabled,
  allowPrivateNetwork: values.allowPrivateNetwork,
  maxAttempts: Number(values.maxAttempts),
});
