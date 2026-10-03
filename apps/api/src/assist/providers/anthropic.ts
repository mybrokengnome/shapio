import { assistDeclined, assistProviderError } from '../errors.js';
import { parseJsonText, postProviderJson, tokens, type ProviderTransport } from './http.js';
import type { AssistProvider, CompletionRequest } from './types.js';

const API_VERSION = '2023-06-01';

type MessagesResponse = {
  model?: unknown;
  content?: Array<{ type?: unknown; text?: unknown }>;
  stop_reason?: unknown;
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
};

const messagesOf = (request: CompletionRequest) =>
  request.messages.map((message, index) => {
    const isLast = index === request.messages.length - 1;
    if (!isLast || message.role !== 'user' || !request.images?.length) {
      return { role: message.role, content: message.content };
    }
    return {
      role: message.role,
      content: [
        ...request.images.map((image) => ({
          type: 'image',
          source: { type: 'base64', media_type: image.mediaType, data: image.data },
        })),
        { type: 'text', text: message.content },
      ],
    };
  });

/** The Messages API (`POST {AI_BASE_URL}/messages`); JSON through structured outputs (`output_config`). */
export const createAnthropicProvider = (transport: ProviderTransport): AssistProvider => ({
  id: 'anthropic',
  model: transport.config.model,
  complete: async (request) => {
    const body = {
      model: transport.config.model,
      max_tokens: transport.config.maxTokens,
      system: request.system,
      messages: messagesOf(request),
      ...(request.json
        ? { output_config: { format: { type: 'json_schema', schema: request.json.schema } } }
        : {}),
    };
    const response = (await postProviderJson(
      transport,
      '/messages',
      {
        'anthropic-version': API_VERSION,
        ...(transport.config.apiKey ? { 'x-api-key': transport.config.apiKey } : {}),
      },
      body,
      { hasImages: Boolean(request.images?.length), signal: request.signal },
    )) as MessagesResponse;
    if (response.stop_reason === 'refusal') {
      throw assistDeclined();
    }
    if (!Array.isArray(response.content)) {
      throw assistProviderError('The model provider sent a response without content');
    }
    const text = response.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('');
    return {
      text,
      json: request.json ? parseJsonText(text) : undefined,
      usage: {
        inputTokens: tokens(response.usage?.input_tokens),
        outputTokens: tokens(response.usage?.output_tokens),
      },
      model: typeof response.model === 'string' ? response.model : transport.config.model,
    };
  },
});
