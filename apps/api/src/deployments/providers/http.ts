import { describeStatus, isSuccessStatus, sendOutbound } from '../../publishing/outbound/request.js';
import type { OutboundPolicy } from '../../publishing/outbound/ssrf.js';
import type { PublishingRuntime } from '../../publishing/runtime.js';

export type JsonResponse = {
  status: number;
  ok: boolean;
  json: unknown;
  text: string;
  /** The `Location` header, which tells a real redirect apart from a 3xx such as 304 Not Modified. */
  location: string | undefined;
};

/** A JSON request through the SSRF-safe outbound client. Never throws on HTTP status; network errors throw. */
export const requestJson = async (
  runtime: PublishingRuntime,
  input: {
    url: string;
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    headers?: Record<string, string>;
    body?: unknown;
    policy: OutboundPolicy;
    signal?: AbortSignal | undefined;
  },
): Promise<JsonResponse> => {
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  const response = await sendOutbound({
    url: input.url,
    method: input.method,
    headers: {
      accept: 'application/json',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...input.headers,
    },
    ...(body !== undefined ? { body } : {}),
    policy: input.policy,
    timeoutMs: runtime.config.outboundTimeoutMs,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  let json: unknown;
  try {
    json = response.body.length > 0 ? JSON.parse(response.body) : undefined;
  } catch {
    json = undefined;
  }
  return {
    status: response.status,
    ok: isSuccessStatus(response.status),
    json,
    text: response.body,
    location: response.headers.location,
  };
};

/** A short, safe description of a failed provider response (status plus the provider's own message). */
export const describeFailure = (response: JsonResponse, providerMessage?: string): string =>
  [describeStatus(response.status), providerMessage].filter(Boolean).join(': ');
