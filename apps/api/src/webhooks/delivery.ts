import { DELIVERY_BODY_LIMIT, WEBHOOK_SECRET_UNREADABLE } from '../constants/publishing.js';
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
import { decryptIfReadable } from '../publishing/secretBox.js';
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
 * the delivery is dead (dead-lettered). A destination refused by the network policy, or a signing secret that
 * can no longer be decrypted (SESSION_SECRET changed; rotate it to repair), is dead at once.
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
    const attempt = delivery.attempts + 1;
    const unsigned = {
      'content-type': 'application/json',
      [EVENT_HEADER]: delivery.event_type,
      [DELIVERY_HEADER]: delivery.id,
    };
    let request = { method: 'POST', url: webhook.url, headers: redactHeaders(unsigned) };
    let response: OutboundResponse | undefined;
    let error: string | null = null;
    let thrown: Error | undefined;
    const secret = decryptIfReadable(runtime.secrets, webhook.secret_encrypted);
    if (secret === undefined) {
      // No retry can help until the secret is rotated: record why, as one attempt, and stop.
      await record('dead', WEBHOOK_SECRET_UNREADABLE);
      throw new PermanentJobError(WEBHOOK_SECRET_UNREADABLE);
    }
    const headers = { ...unsigned, ...signedHeaders(secret, body, at) };
    request = { ...request, headers: redactHeaders(headers) };
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
      thrown = caught instanceof Error ? caught : new Error(String(caught));
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
      // The worker describes the failure once: a thrown error goes on as it is (its message alone when it
      // becomes permanent), never wrapped in a new error whose message already starts with its name.
      if (thrown) {
        throw final ? new PermanentJobError(thrown.message) : thrown;
      }
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
