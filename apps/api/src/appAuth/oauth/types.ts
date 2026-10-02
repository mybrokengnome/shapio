import type { OAuthClientConfig } from '../../config/index.js';

/** OAuth providers app users can sign in with (build plan §7, decision 6). */
export const OAUTH_PROVIDERS = ['google', 'github'] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

/** Where a provider lives. Real endpoints by default; tests point them at a local fake. */
export type OAuthEndpoints = {
  authorize: string;
  token: string;
  userInfo: string;
  /** GitHub only: the account's email addresses with their verification state. */
  emails?: string;
};

/** What Shapio needs from a provider account. `emailVerified` is the provider's word, never assumed. */
export type OAuthProfile = {
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  name: string;
};

export type AuthorizationRequest = {
  client: OAuthClientConfig;
  redirectUri: string;
  state: string;
  codeChallenge: string;
};

export type CodeExchange = {
  client: OAuthClientConfig;
  redirectUri: string;
  code: string;
  codeVerifier: string;
};

/** One provider: builds the authorization URL and turns an authorization code into a profile. */
export type OAuthProviderAdapter = {
  id: OAuthProviderId;
  authorizationUrl: (request: AuthorizationRequest) => string;
  fetchProfile: (exchange: CodeExchange) => Promise<OAuthProfile>;
};

/** The provider refused or answered with something unusable. `code` is safe to show to the app. */
export class OAuthProviderError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OAuthProviderError';
    this.code = code;
  }
}
