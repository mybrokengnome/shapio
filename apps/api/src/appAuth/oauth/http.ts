import { OAUTH_HTTP_TIMEOUT_MS } from '../../constants/appAuth.js';
import { OAuthProviderError } from './types.js';

const readJson = async (response: Response, what: string): Promise<unknown> => {
  if (!response.ok) {
    throw new OAuthProviderError('PROVIDER_ERROR', `${what} failed with HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch (error) {
    throw new OAuthProviderError('PROVIDER_ERROR', `${what} returned invalid JSON`, { cause: error });
  }
};

const send = async (url: string, init: RequestInit, what: string): Promise<unknown> => {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(OAUTH_HTTP_TIMEOUT_MS) });
  } catch (error) {
    throw new OAuthProviderError('PROVIDER_UNREACHABLE', `${what} could not reach the provider`, {
      cause: error,
    });
  }
  return readJson(response, what);
};

/** POSTs a form (OAuth token endpoints) and returns the JSON answer. */
export const postForm = (url: string, form: Record<string, string>, headers: Record<string, string> = {}) =>
  send(
    url,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        ...headers,
      },
      body: new URLSearchParams(form).toString(),
    },
    'The token request',
  );

/** GETs a JSON resource with the provider access token. */
export const getJson = (url: string, accessToken: string, headers: Record<string, string> = {}) =>
  send(
    url,
    { headers: { accept: 'application/json', authorization: `Bearer ${accessToken}`, ...headers } },
    'The profile request',
  );

export const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** The `access_token` of a token response; providers that answer 200 with `{ error }` (GitHub) are failures. */
export const accessTokenOf = (value: unknown): string => {
  const body = asRecord(value);
  if (typeof body.access_token === 'string' && body.access_token.length > 0) {
    return body.access_token;
  }
  const error = typeof body.error === 'string' ? body.error : 'no access_token';
  throw new OAuthProviderError('PROVIDER_REJECTED_CODE', `The provider did not issue a token (${error})`);
};

export const authorizationUrl = (endpoint: string, params: Record<string, string>): string => {
  const url = new URL(endpoint);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};
