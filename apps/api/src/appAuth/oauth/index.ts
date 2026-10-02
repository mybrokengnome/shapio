import type { AppAuthConfig, OAuthClientConfig } from '../../config/index.js';
import { createGitHubAdapter } from './github.js';
import { createGoogleAdapter } from './google.js';
import {
  OAUTH_PROVIDERS,
  type OAuthEndpoints,
  type OAuthProviderAdapter,
  type OAuthProviderId,
} from './types.js';

export type ConfiguredProvider = { adapter: OAuthProviderAdapter; client: OAuthClientConfig };

/** Configured providers only: a provider without a client ID and secret does not exist for the API. */
export type OAuthProviderRegistry = {
  get: (id: string) => ConfiguredProvider | undefined;
  enabled: () => OAuthProviderId[];
};

const ADAPTERS: Record<OAuthProviderId, (endpoints?: OAuthEndpoints) => OAuthProviderAdapter> = {
  google: createGoogleAdapter,
  github: createGitHubAdapter,
};

export const createOAuthProviderRegistry = (
  config: AppAuthConfig['oauth'],
  endpointOverrides: Partial<Record<OAuthProviderId, OAuthEndpoints>> = {},
): OAuthProviderRegistry => {
  const providers = new Map<string, ConfiguredProvider>();
  for (const id of OAUTH_PROVIDERS) {
    const client = config[id];
    if (client) {
      providers.set(id, { adapter: ADAPTERS[id](endpointOverrides[id]), client });
    }
  }
  return {
    get: (id) => providers.get(id),
    enabled: () => OAUTH_PROVIDERS.filter((id) => providers.has(id)),
  };
};
