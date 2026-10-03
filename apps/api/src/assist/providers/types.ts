import type { TSchema } from 'typebox';
import type { AiProvider } from '../../config/assist.js';

/** A JPEG image for a vision model, base64-encoded. */
export type AssistImage = { mediaType: 'image/jpeg'; data: string };

export type AssistMessage = { role: 'user' | 'assistant'; content: string };

export type CompletionRequest = {
  system: string;
  messages: readonly AssistMessage[];
  /** Attached to the last user message. */
  images?: readonly AssistImage[];
  /** Ask for JSON matching this schema (a closed object). The adapter returns it parsed but unchecked. */
  json?: { name: string; schema: TSchema };
  signal?: AbortSignal;
};

export type CompletionUsage = { inputTokens: number; outputTokens: number };

export type CompletionResult = {
  text: string;
  /** The parsed JSON when `json` was requested and the text parsed; undefined otherwise. */
  json: unknown;
  usage: CompletionUsage;
  /** The model that answered, as the provider reports it. */
  model: string;
};

/**
 * One model provider behind one contract (plan §I). Adapters speak the provider's wire format through
 * `sendOutbound` only; no vendor SDKs, no streaming. They throw AppErrors (assist/errors.ts).
 */
export type AssistProvider = {
  id: AiProvider;
  model: string;
  complete: (request: CompletionRequest) => Promise<CompletionResult>;
};
