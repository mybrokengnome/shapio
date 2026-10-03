import type { AssistProviderConfig } from '../../config/assist.js';
import { trustedOutboundPolicy, type HostResolver } from '../../publishing/outbound/ssrf.js';
import { createAnthropicProvider } from './anthropic.js';
import { createChatCompletionsProvider } from './openai.js';
import type { AssistProvider } from './types.js';

export type { AssistProvider } from './types.js';

/** The adapter for the configured provider (AI_PROVIDER); every request goes through `sendOutbound`. */
export const createAssistProvider = (config: AssistProviderConfig, resolve: HostResolver): AssistProvider => {
  const transport = { config, policy: trustedOutboundPolicy(resolve) };
  switch (config.provider) {
    case 'anthropic':
      return createAnthropicProvider(transport);
    case 'openai':
    case 'openai-compatible':
      return createChatCompletionsProvider(transport, config.provider);
  }
};
