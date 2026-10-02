import { DELIVERY_BODY_LIMIT } from '../constants/publishing.js';
import { describeError } from '../helpers/errors.js';
import { PermanentJobError, type JobHandler } from '../jobs/types.js';
import {
  describeStatus,
  isSuccessStatus,
  sendOutbound,
  type OutboundResponse,
} from '../publishing/outbound/request.js';
import { OutboundBlockedError } from '../publishing/outbound/ssrf.js';
import { redactHeaders } from '../publishing/redact.js';
import { outboundPolicy, type PublishingRuntime } from '../publishing/runtime.js';
import { DELIVERY_HEADER, EVENT_HEADER, signedHeaders } from '../publishing/signature.js';
import * as webhooksRepository from '../repositories/webhooks.js';

/** Response headers worth keeping in the delivery log. */
const KEPT_RESPONSE_HEADERS = ['content-type', 'content-length', 'retry-after', 'location'];

const summarizeResponse = (response: OutboundResponse) => {
  const body = response.body.slice(0, DELIVERY_BODY_LIMIT);
  return {
    status: response.status,
    headers: Object.fromEntries(
      KEPT_RESPONSE_HEADERS.flatMap((name) => {
        const value = response.headers[name];
        return value === undefined ? [] : [[name, Array.isArray(value) ? value.join(', ') : value]];
      }),
    ),
    body,
    truncated: response.truncated || body.length < response.body.length,
  };
};

/**
 * Delivers one webhook delivery (job `webhook.deliver`): a signed POST, at least once. Non-2xx responses and
 * network errors are retried by the queue with exponential backoff up to the webhook's max attempts; then
 * the delivery is dead (dead-lettered). A destination refused by the network policy is dead at once.
 * Every attempt is summarised in the delivery log, with the signature redacted and the body truncated.
 */
export const createWebhookDeliveryHandler =
  (runtime: PublishingRuntime): JobHandler =>
  async (job) => {
    const { deliveryId } = job.payload as { deliveryId: string };
    const delivery = await webhooksRepository.findDelivery(deliveryId, runtime.db);
    if (!delivery || delivery.status === 'succeeded' || delivery.status === 'dead') {
      return { skipped: delivery?.status ?? 'missing' };
    }
    const webhook = await webhooksRepository.findById(delivery.webhook_id, runtime.db);
    if (!webhook || (!webhook.enabled && !delivery.is_test)) {
      const reason = webhook ? 'The webhook is disabled' : 'The webhook was deleted';
      await webhooksRepository.markDeliveryDead(delivery.id, reason, runtime.now(), runtime.db);
      throw new PermanentJobError(reason);
    }
    const body = JSON.stringify(delivery.payload);
    const at = runtime.now();
    const headers = {
      'content-type': 'application/json',
      [EVENT_HEADER]: delivery.event_type,
      [DELIVERY_HEADER]: delivery.id,
      ...signedHeaders(runtime.secrets.decrypt(webhook.secret_encrypted), body, at),
    };
    const attempt = delivery.attempts + 1;
    const request = { method: 'POST', url: webhook.url, headers: redactHeaders(headers) };
    let response: OutboundResponse | undefined;
    let error: string | null = null;
    try {
      response = await sendOutbound({
        url: webhook.url,
        method: 'POST',
        headers,
        body,
        policy: outboundPolicy(runtime, webhook.allow_private_network),
        timeoutMs: runtime.config.outboundTimeoutMs,
        signal: job.signal,
      });
      if (!isSuccessStatus(response.status)) {
        error = describeStatus(response.status);
      }
    } catch (caught) {
      error = describeError(caught);
      if (caught instanceof OutboundBlockedError) {
        await record('dead', caught.message);
        throw new PermanentJobError(caught.message);
      }
    }
    const final = job.attempt >= job.maxAttempts;
    const status = error === null ? 'succeeded' : final ? 'dead' : 'retrying';
    await record(status, error);
    if (error !== null) {
      throw final ? new PermanentJobError(error) : new Error(error);
    }
    return { status: response?.status ?? null, attempt };

    async function record(outcome: 'retrying' | 'succeeded' | 'dead', message: string | null) {
      await webhooksRepository.recordAttempt(
        delivery?.id ?? deliveryId,
        {
          status: outcome,
          attempts: attempt,
          responseStatus: response?.status ?? null,
          error: message,
          summary: {
            attempt,
            at: at.toISOString(),
            durationMs: response?.durationMs ?? runtime.now().getTime() - at.getTime(),
            request,
            response: response ? summarizeResponse(response) : null,
            error: message,
          },
          now: runtime.now(),
        },
        runtime.db,
      );
    }
  };
