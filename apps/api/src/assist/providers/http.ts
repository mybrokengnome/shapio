import type { AssistProviderConfig } from '../../config/assist.js';
import { ASSIST_MAX_RESPONSE_BYTES } from '../../constants/assist.js';
import { sendOutbound } from '../../publishing/outbound/request.js';
import type { OutboundPolicy } from '../../publishing/outbound/ssrf.js';
import {
  assistProviderAuth,
  assistProviderBusy,
  assistProviderError,
  assistVisionUnsupported,
} from '../errors.js';

export type ProviderTransport = {
  config: AssistProviderConfig;
  /** The operator-trusted policy: AI_BASE_URL may be loopback (Ollama) or private. */
  policy: OutboundPolicy;
};

const MAX_PROVIDER_MESSAGE = 300;

/** The provider's own error message (`{ error: { message } }` in every supported format), shortened. */
const providerMessage = (json: unknown): string | undefined => {
  const error = (json as { error?: unknown } | null)?.error;
  const message = typeof error === 'string' ? error : (error as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message.slice(0, MAX_PROVIDER_MESSAGE) : undefined;
};

const parse = (body: string): unknown => {
  try {
    return body.length > 0 ? JSON.parse(body) : undefined;
  } catch {
    return undefined;
  }
};

/**
 * POSTs a JSON body to the provider and returns the parsed JSON of a 2xx answer. Maps failures to assist
 * errors: credentials (401/403), rate limiting (429), a 4xx on a request carrying images (the model has no
 * vision), anything else including timeouts and network errors.
 */
export const postProviderJson = async (
  transport: ProviderTransport,
  path: string,
  headers: Record<string, string>,
  body: unknown,
  { hasImages, signal }: { hasImages: boolean; signal?: AbortSignal | undefined },
): Promise<unknown> => {
  let response;
  try {
    response = await sendOutbound({
      url: `${transport.config.baseUrl}${path}`,
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      policy: transport.policy,
      timeoutMs: transport.config.timeoutMs,
      maxResponseBytes: ASSIST_MAX_RESPONSE_BYTES,
      ...(signal ? { signal } : {}),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw assistProviderError(`The model provider could not be reached: ${reason}`);
  }
  const json = parse(response.body);
  if (response.status >= 200 && response.status < 300) {
    if (json === undefined || response.truncated) {
      throw assistProviderError('The model provider sent a response that is not JSON or is too large');
    }
    return json;
  }
  if (response.status === 401 || response.status === 403) {
    throw assistProviderAuth();
  }
  if (response.status === 429) {
    throw assistProviderBusy();
  }
  if (hasImages && response.status >= 400 && response.status < 500) {
    throw assistVisionUnsupported();
  }
  const detail = providerMessage(json);
  throw assistProviderError(
    `The model provider answered HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
  );
};

/** A number from a usage field, 0 when absent. */
export const tokens = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;

/** JSON text from a model answer: tolerates a fenced block or prose around one JSON object. */
export const parseJsonText = (text: string): unknown => {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed)?.[1];
  const candidates = [fenced ?? trimmed];
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) {
    candidates.push(trimmed.slice(first, last + 1));
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
};
