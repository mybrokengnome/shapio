import {
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
  type WebhookEventBody,
} from '@shapio/client';

export type WebhookEventRead =
  { ok: true; event: WebhookEventBody } | { ok: false; status: 400 | 401 | 503; reason: string };

const isEventBody = (value: unknown): value is WebhookEventBody =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { id?: unknown }).id === 'string' &&
  typeof (value as { type?: unknown }).type === 'string';

/**
 * Reads a Shapio webhook delivery: checks `X-Shapio-Signature` over the raw body with the webhook's secret
 * (and the timestamp's freshness), then parses the event. Nothing in the body is trusted before that.
 */
export const readWebhookEvent = async (
  request: Request,
  secret: string | undefined,
  now = new Date(),
): Promise<WebhookEventRead> => {
  if (!secret) {
    return { ok: false, status: 503, reason: 'SHAPIO_WEBHOOK_SECRET is not set' };
  }
  const body = await request.text();
  const check = await verifyWebhookSignature({
    secret,
    signature: request.headers.get(WEBHOOK_SIGNATURE_HEADER),
    timestamp: request.headers.get(WEBHOOK_TIMESTAMP_HEADER),
    body,
    now,
  });
  if (!check.ok) {
    return { ok: false, status: 401, reason: check.reason };
  }
  let event: unknown;
  try {
    event = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, reason: 'the body is not JSON' };
  }
  return isEventBody(event) ? { ok: true, event } : { ok: false, status: 400, reason: 'not a Shapio event' };
};
