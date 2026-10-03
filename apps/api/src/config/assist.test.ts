import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './index.js';

const BASE = { DATABASE_URL: 'postgres://localhost/shapio', NODE_ENV: 'development' };

const problemsOf = (env: Record<string, string>): readonly string[] => {
  try {
    loadConfig({ ...BASE, ...env });
  } catch (error) {
    if (error instanceof ConfigError) {
      return error.problems;
    }
    throw error;
  }
  return [];
};

describe('assist config', () => {
  it('is off by default, with the documented limits', () => {
    expect(loadConfig(BASE).assist).toEqual({ provider: undefined, rateLimitMax: 20 });
  });

  it('fills the public endpoint and defaults for anthropic and openai', () => {
    expect(
      loadConfig({ ...BASE, AI_PROVIDER: 'anthropic', AI_MODEL: 'm', AI_API_KEY: 'k' }).assist.provider,
    ).toEqual({
      provider: 'anthropic',
      model: 'm',
      apiKey: 'k',
      baseUrl: 'https://api.anthropic.com/v1',
      maxTokens: 8192,
      timeoutMs: 60_000,
    });
    expect(
      loadConfig({ ...BASE, AI_PROVIDER: 'openai', AI_MODEL: 'm', AI_API_KEY: 'k' }).assist.provider?.baseUrl,
    ).toBe('https://api.openai.com/v1');
  });

  it('takes AI_BASE_URL without a trailing slash (Ollama needs no key)', () => {
    expect(
      loadConfig({
        ...BASE,
        AI_PROVIDER: 'openai-compatible',
        AI_MODEL: 'llama3.2-vision',
        AI_BASE_URL: 'http://127.0.0.1:11434/v1/',
      }).assist.provider,
    ).toMatchObject({ baseUrl: 'http://127.0.0.1:11434/v1', apiKey: undefined });
  });

  it('reports what is missing or stray', () => {
    expect(problemsOf({ AI_PROVIDER: 'anthropic' })).toEqual([
      'AI_PROVIDER requires AI_MODEL (the model name your provider expects)',
      'AI_PROVIDER=anthropic requires AI_API_KEY',
    ]);
    expect(problemsOf({ AI_PROVIDER: 'openai-compatible', AI_MODEL: 'm' })).toEqual([
      'AI_PROVIDER=openai-compatible requires AI_BASE_URL, e.g. http://127.0.0.1:11434/v1 for Ollama',
    ]);
    expect(problemsOf({ AI_MODEL: 'm', AI_API_KEY: 'k' })).toEqual([
      'AI_MODEL, AI_API_KEY are set but AI_PROVIDER is not; set AI_PROVIDER to turn assist on, or remove them',
    ]);
    expect(
      problemsOf({
        AI_PROVIDER: 'openai-compatible',
        AI_MODEL: 'm',
        AI_BASE_URL: 'http://user:pass@llm.local/v1',
      }),
    ).toEqual(['AI_BASE_URL must be an http(s) URL without credentials, query or fragment']);
  });
});
