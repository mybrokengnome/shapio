import { accessTokenOf, asRecord, authorizationUrl, getJson, postForm } from './http.js';
import { OAuthProviderError, type OAuthEndpoints, type OAuthProviderAdapter } from './types.js';

export const GITHUB_ENDPOINTS: OAuthEndpoints = {
  authorize: 'https://github.com/login/oauth/authorize',
  // Answers 200 with `{ error, error_description }` on failure, hence accessTokenOf's check.
  token: 'https://github.com/login/oauth/access_token',
  // { id: number, login, name, email (public email or null), … }
  userInfo: 'https://api.github.com/user',
  // [{ email, primary, verified, visibility }]
  emails: 'https://api.github.com/user/emails',
};

const API_HEADERS = {
  accept: 'application/vnd.github+json',
  'x-github-api-version': '2022-11-28',
  // GitHub's API rejects requests without a User-Agent.
  'user-agent': 'Shapio',
};

type GitHubEmail = { email: string; primary: boolean; verified: boolean };

const toEmails = (value: unknown): GitHubEmail[] =>
  Array.isArray(value)
    ? value
        .map(asRecord)
        .flatMap((row) =>
          typeof row.email === 'string'
            ? [{ email: row.email, primary: row.primary === true, verified: row.verified === true }]
            : [],
        )
    : [];

/** The primary address if GitHub verified it, else any verified one; unverified addresses are never used. */
const pickEmail = (emails: readonly GitHubEmail[]): { email: string | null; verified: boolean } => {
  const chosen =
    emails.find((entry) => entry.primary && entry.verified) ?? emails.find((entry) => entry.verified);
  if (chosen) {
    return { email: chosen.email, verified: true };
  }
  const primary = emails.find((entry) => entry.primary);
  return { email: primary?.email ?? null, verified: false };
};

/** GitHub OAuth app with PKCE (S256). Scopes: `read:user user:email` (the emails endpoint needs the latter). */
export const createGitHubAdapter = (endpoints: OAuthEndpoints = GITHUB_ENDPOINTS): OAuthProviderAdapter => ({
  id: 'github',
  authorizationUrl: ({ client, redirectUri, state, codeChallenge }) =>
    authorizationUrl(endpoints.authorize, {
      client_id: client.clientId,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      allow_signup: 'true',
    }),
  fetchProfile: async ({ client, redirectUri, code, codeVerifier }) => {
    const accessToken = accessTokenOf(
      await postForm(endpoints.token, {
        client_id: client.clientId,
        client_secret: client.clientSecret,
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    );
    const user = asRecord(await getJson(endpoints.userInfo, accessToken, API_HEADERS));
    if (typeof user.id !== 'number' && typeof user.id !== 'string') {
      throw new OAuthProviderError('PROVIDER_ERROR', 'GitHub returned a profile without an id');
    }
    const { email, verified } = pickEmail(
      endpoints.emails ? toEmails(await getJson(endpoints.emails, accessToken, API_HEADERS)) : [],
    );
    const name = typeof user.name === 'string' && user.name ? user.name : user.login;
    return {
      providerUserId: String(user.id),
      email,
      emailVerified: verified,
      name: typeof name === 'string' ? name : '',
    };
  },
});
