import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { safeEqual } from '../../helpers/tokens.js';

/**
 * The OAuth round trip's state, kept in a short-lived signed httpOnly cookie on the browser that started
 * it: the `state` parameter (CSRF on the callback), the PKCE verifier, where to send the app afterwards and
 * the app's own S256 challenge (bound to the one-time login code, so only the app that started the sign-in
 * can exchange it) and the site the sign-in is for (the provider's redirect names no site, so the callback
 * takes it from here). Binding to the browser stops login CSRF (an attacker's callback URL is useless in a
 * victim's browser).
 */
export type OAuthState = {
  provider: string;
  siteId: string;
  state: string;
  codeVerifier: string;
  redirectTo: string;
  appCodeChallenge: string;
  expiresAt: number;
};

const randomValue = () => randomBytes(32).toString('base64url');

/** PKCE S256 challenge of a verifier (RFC 7636). */
export const codeChallengeOf = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

export type NewOAuthStateInput = Pick<OAuthState, 'provider' | 'siteId' | 'redirectTo' | 'appCodeChallenge'>;

export const newOAuthState = (input: NewOAuthStateInput, ttlMs: number, now = Date.now()): OAuthState => ({
  ...input,
  state: randomValue(),
  codeVerifier: randomValue(),
  expiresAt: now + ttlMs,
});

const mac = (key: Buffer, payload: string) => createHmac('sha256', key).update(payload).digest();

export const sealOAuthState = (key: Buffer, value: OAuthState): string => {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${mac(key, payload).toString('base64url')}`;
};

const parse = (payload: string): OAuthState | undefined => {
  try {
    const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<OAuthState>;
    const valid =
      typeof value.provider === 'string' &&
      typeof value.siteId === 'string' &&
      typeof value.state === 'string' &&
      typeof value.codeVerifier === 'string' &&
      typeof value.redirectTo === 'string' &&
      typeof value.appCodeChallenge === 'string' &&
      typeof value.expiresAt === 'number';
    return valid ? (value as OAuthState) : undefined;
  } catch {
    return undefined;
  }
};

/** The cookie's state when it is authentic, unexpired, for this provider and matches the callback's `state`. */
export const openOAuthState = (
  key: Buffer,
  cookie: string | undefined,
  expected: { provider: string; state: string },
  now = Date.now(),
): OAuthState | undefined => {
  const [payload, signature, ...rest] = (cookie ?? '').split('.');
  if (!payload || !signature || rest.length > 0) {
    return undefined;
  }
  const actual = Buffer.from(signature, 'base64url');
  const wanted = mac(key, payload);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
    return undefined;
  }
  const value = parse(payload);
  if (!value || value.expiresAt <= now || value.provider !== expected.provider) {
    return undefined;
  }
  return safeEqual(value.state, expected.state) ? value : undefined;
};
