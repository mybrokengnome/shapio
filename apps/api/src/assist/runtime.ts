import type { AssistConfig, AssistProviderConfig } from '../config/assist.js';
import type { HostResolver } from '../publishing/outbound/ssrf.js';
import { createAssistProvider } from './providers/index.js';
import type { AssistProvider } from './providers/types.js';

/** The configured model provider. Absent when assist is off (AI_PROVIDER unset). */
export type AssistRuntime = { provider: AssistProvider; config: AssistProviderConfig };

/** Built once for the API and once for the worker, from the same config. */
export const createAssistRuntime = (
  config: AssistConfig,
  resolve: HostResolver,
): AssistRuntime | undefined =>
  config.provider
    ? { provider: createAssistProvider(config.provider, resolve), config: config.provider }
    : undefined;
