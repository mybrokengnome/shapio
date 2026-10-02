import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { OAuthEndpoints, OAuthProviderId } from '../../src/appAuth/oauth/types.js';

/**
 * A local stand-in for Google's and GitHub's token and profile endpoints. Response bodies follow the real
 * providers' documented shapes (recorded below), including GitHub's habit of answering a bad code with
 * HTTP 200 and `{ error }`. The fake checks the client credentials, the redirect URI and the PKCE verifier.
 */

/** Google OpenID Connect userinfo (https://openidconnect.googleapis.com/v1/userinfo). */
export type GoogleUserInfo = {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  email?: string;
  email_verified?: boolean;
  hd?: string;
};

/** GitHub GET /user (subset) and GET /user/emails entries. */
export type GitHubUser = { login: string; id: number; name: string | null; email: string | null };
export type GitHubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: 'public' | 'private' | null;
};

type Grant = {
  provider: OAuthProviderId;
  codeChallenge: string;
  redirectUri: string;
  google?: GoogleUserInfo;
  github?: { user: GitHubUser; emails: GitHubEmail[] };
};

export const FAKE_CLIENT = { id: 'test-client-id', secret: 'test-client-secret' };

export type FakeOAuthProviders = {
  endpoints: Record<OAuthProviderId, OAuthEndpoints>;
  /** Simulates the user approving at the provider: returns the authorization code the provider would send. */
  approve: (
    authorizationUrl: string,
    profile: Omit<Grant, 'provider' | 'codeChallenge' | 'redirectUri'>,
  ) => string;
  close: () => Promise<void>;
};

const readBody = async (request: IncomingMessage): Promise<URLSearchParams> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
};

const send = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
};

export const startFakeOAuthProviders = async (): Promise<FakeOAuthProviders> => {
  const grants = new Map<string, Grant>();
  const tokens = new Map<string, Grant>();

  const exchange = async (provider: OAuthProviderId, request: IncomingMessage, response: ServerResponse) => {
    const form = await readBody(request);
    const grant = grants.get(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    const valid =
      grant !== undefined &&
      grant.provider === provider &&
      form.get('client_id') === FAKE_CLIENT.id &&
      form.get('client_secret') === FAKE_CLIENT.secret &&
      form.get('redirect_uri') === grant.redirectUri &&
      createHash('sha256').update(verifier).digest('base64url') === grant.codeChallenge;
    if (!valid || !grant) {
      if (provider === 'github') {
        // GitHub: HTTP 200 with an error body.
        send(response, 200, {
          error: 'bad_verification_code',
          error_description: 'The code passed is incorrect or expired.',
          error_uri:
            'https://docs.github.com/apps/managing-oauth-apps/troubleshooting-oauth-app-access-token-request-errors/#bad-verification-code',
        });
      } else {
        send(response, 400, { error: 'invalid_grant', error_description: 'Bad Request' });
      }
      return;
    }
    grants.delete(form.get('code') ?? '');
    const accessToken =
      provider === 'github'
        ? `gho_${randomBytes(18).toString('hex')}`
        : `ya29.${randomBytes(24).toString('base64url')}`;
    tokens.set(accessToken, grant);
    send(
      response,
      200,
      provider === 'github'
        ? { access_token: accessToken, token_type: 'bearer', scope: 'read:user,user:email' }
        : {
            access_token: accessToken,
            expires_in: 3599,
            scope:
              'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
            token_type: 'Bearer',
            id_token: 'eyJhbGciOiJSUzI1NiJ9.e30.signature',
          },
    );
  };

  const profile = (request: IncomingMessage, response: ServerResponse, path: string) => {
    const token = /^Bearer (.+)$/.exec(request.headers.authorization ?? '')?.[1] ?? '';
    const grant = tokens.get(token);
    if (!grant) {
      send(response, 401, { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest' });
      return;
    }
    if (path === '/google/userinfo' && grant.google) {
      send(response, 200, grant.google);
    } else if (path === '/github/user' && grant.github) {
      send(response, 200, {
        ...grant.github.user,
        node_id: 'MDQ6VXNlcjE=',
        avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
        type: 'User',
        site_admin: false,
      });
    } else if (path === '/github/user/emails' && grant.github) {
      send(response, 200, grant.github.emails);
    } else {
      send(response, 404, { message: 'Not Found' });
    }
  };

  const server: Server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://fake.invalid').pathname;
    if (request.method === 'POST' && path === '/google/token') {
      void exchange('google', request, response);
    } else if (request.method === 'POST' && path === '/github/token') {
      void exchange('github', request, response);
    } else {
      profile(request, response, path);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    endpoints: {
      google: {
        authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
        token: `${base}/google/token`,
        userInfo: `${base}/google/userinfo`,
      },
      github: {
        authorize: 'https://github.com/login/oauth/authorize',
        token: `${base}/github/token`,
        userInfo: `${base}/github/user`,
        emails: `${base}/github/user/emails`,
      },
    },
    approve: (authorizationUrl, details) => {
      const url = new URL(authorizationUrl);
      const provider: OAuthProviderId = url.hostname === 'github.com' ? 'github' : 'google';
      const code = randomBytes(16).toString('hex');
      grants.set(code, {
        ...details,
        provider,
        codeChallenge: url.searchParams.get('code_challenge') ?? '',
        redirectUri: url.searchParams.get('redirect_uri') ?? '',
      });
      return code;
    },
    close: () =>
      new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};
