import type { RawConfig } from './schema.js';

export type AiProvider = NonNullable<RawConfig['AI_PROVIDER']>;

/** The model provider assist talks to. Never logged: `apiKey` is a secret. */
export type AssistProviderConfig = {
  provider: AiProvider;
  model: string;
  apiKey: string | undefined;
  /** API base including the version path, without a trailing slash. */
  baseUrl: string;
  maxTokens: number;
  timeoutMs: number;
};

/** Editor assists (plan agentic-ecosystem §A0, §I). `provider` undefined = assist is off. */
export type AssistConfig = {
  provider: AssistProviderConfig | undefined;
  /** Assist requests per minute and actor. */
  rateLimitMax: number;
};

const DEFAULT_BASE_URLS: Readonly<Record<AiProvider, string | undefined>> = {
  anthropic: 'https://api.anthropic.com/v1',
  openai: 'https://api.openai.com/v1',
  'openai-compatible': undefined,
};

export const toAssistConfig = (raw: RawConfig): AssistConfig => {
  const provider = raw.AI_PROVIDER;
  const baseUrl = (raw.AI_BASE_URL ?? (provider ? DEFAULT_BASE_URLS[provider] : undefined))?.replace(
    /\/+$/,
    '',
  );
  return {
    provider:
      provider && raw.AI_MODEL && baseUrl
        ? {
            provider,
            model: raw.AI_MODEL,
            apiKey: raw.AI_API_KEY,
            baseUrl,
            maxTokens: raw.AI_MAX_TOKENS,
            timeoutMs: raw.AI_TIMEOUT_MS,
          }
        : undefined,
    rateLimitMax: raw.AI_RATE_LIMIT_MAX,
  };
};

const SETTINGS_NEEDING_PROVIDER = ['AI_MODEL', 'AI_API_KEY', 'AI_BASE_URL'] as const;

export const assistProblems = (raw: RawConfig): string[] => {
  const problems: string[] = [];
  if (!raw.AI_PROVIDER) {
    const stray = SETTINGS_NEEDING_PROVIDER.filter((name) => raw[name] !== undefined);
    return stray.length > 0
      ? [
          `${stray.join(', ')} ${stray.length > 1 ? 'are' : 'is'} set but AI_PROVIDER is not; set AI_PROVIDER to turn assist on, or remove them`,
        ]
      : [];
  }
  if (!raw.AI_MODEL) {
    problems.push('AI_PROVIDER requires AI_MODEL (the model name your provider expects)');
  }
  if (raw.AI_PROVIDER === 'openai-compatible' && !raw.AI_BASE_URL) {
    problems.push(
      'AI_PROVIDER=openai-compatible requires AI_BASE_URL, e.g. http://127.0.0.1:11434/v1 for Ollama',
    );
  }
  if ((raw.AI_PROVIDER === 'anthropic' || raw.AI_PROVIDER === 'openai') && !raw.AI_API_KEY) {
    problems.push(`AI_PROVIDER=${raw.AI_PROVIDER} requires AI_API_KEY`);
  }
  if (raw.AI_BASE_URL) {
    let url: URL | undefined;
    try {
      url = new URL(raw.AI_BASE_URL);
    } catch {
      url = undefined;
    }
    if (!url || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
      problems.push('AI_BASE_URL must be an http(s) URL without credentials, query or fragment');
    }
  }
  return problems;
};
