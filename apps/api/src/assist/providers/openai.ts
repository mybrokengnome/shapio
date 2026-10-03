import { assistDeclined, assistProviderError } from '../errors.js';
import { parseJsonText, postProviderJson, tokens, type ProviderTransport } from './http.js';
import type { AssistProvider, CompletionRequest } from './types.js';

type ChatResponse = {
  model?: unknown;
  choices?: Array<{ message?: { content?: unknown; refusal?: unknown } }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
};

const messagesOf = (request: CompletionRequest, system: string) => [
  { role: 'system', content: system },
  ...request.messages.map((message, index) => {
    const isLast = index === request.messages.length - 1;
    if (!isLast || message.role !== 'user' || !request.images?.length) {
      return { role: message.role, content: message.content };
    }
    return {
      role: message.role,
      content: [
        { type: 'text', text: message.content },
        ...request.images.map((image) => ({
          type: 'image_url',
          image_url: { url: `data:${image.mediaType};base64,${image.data}` },
        })),
      ],
    };
  }),
];

/**
 * Without structured outputs (most OpenAI-compatible servers), the schema goes into the system prompt and
 * the answer is checked like any other (services/assist/completion.ts).
 */
const jsonInstruction = (request: CompletionRequest) =>
  request.json
    ? `\n\nAnswer with one JSON object only, no prose and no code fence, matching this JSON Schema:\n${JSON.stringify(request.json.schema)}`
    : '';

/**
 * Chat Completions (`POST {AI_BASE_URL}/chat/completions`). `openai` uses `response_format` with the
 * schema; `openai-compatible` (Ollama, LM Studio, vLLM) gets the schema in the prompt.
 */
export const createChatCompletionsProvider = (
  transport: ProviderTransport,
  flavour: 'openai' | 'openai-compatible',
): AssistProvider => ({
  id: flavour,
  model: transport.config.model,
  complete: async (request) => {
    const native = flavour === 'openai';
    const system = native ? request.system : `${request.system}${jsonInstruction(request)}`;
    // Compatible servers differ in which `response_format` types they accept, so none is sent to them.
    const responseFormat =
      request.json && native
        ? {
            type: 'json_schema',
            json_schema: { name: request.json.name, schema: request.json.schema, strict: false },
          }
        : undefined;
    const body = {
      model: transport.config.model,
      messages: messagesOf(request, system),
      ...(native
        ? { max_completion_tokens: transport.config.maxTokens }
        : { max_tokens: transport.config.maxTokens, stream: false }),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };
    const response = (await postProviderJson(
      transport,
      '/chat/completions',
      transport.config.apiKey ? { authorization: `Bearer ${transport.config.apiKey}` } : {},
      body,
      { hasImages: Boolean(request.images?.length), signal: request.signal },
    )) as ChatResponse;
    const message = Array.isArray(response.choices) ? response.choices[0]?.message : undefined;
    if (typeof message?.refusal === 'string' && message.refusal !== '') {
      throw assistDeclined();
    }
    if (!message || typeof message.content !== 'string') {
      throw assistProviderError('The model provider sent a response without content');
    }
    return {
      text: message.content,
      json: request.json ? parseJsonText(message.content) : undefined,
      usage: {
        inputTokens: tokens(response.usage?.prompt_tokens),
        outputTokens: tokens(response.usage?.completion_tokens),
      },
      model: typeof response.model === 'string' ? response.model : transport.config.model,
    };
  },
});
