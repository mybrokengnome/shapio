import { createHmac, timingSafeEqual } from 'node:crypto';
import { APP_TOKEN_AUDIENCE } from '../constants/appAuth.js';

/**
 * App-user access tokens: compact JWTs signed with HS256 under a key derived from the instance signing
 * secret (appAuth/keys.ts). Shapio both issues and verifies them, so a symmetric key is enough; EdDSA would
 * only pay off if third parties had to verify tokens without being able to mint them, which no Shapio
 * feature needs, and it would add a stored key pair to manage. The header is fixed and checked byte for
 * byte, so `alg: none` or algorithm confusion cannot get past verification.
 */
export type AccessTokenClaims = {
  /** App user ID. */
  sub: string;
  aud: typeof APP_TOKEN_AUDIENCE;
  iat: number;
  exp: number;
  /** Custom app role IDs held at issue time (`authenticated` is implicit). */
  roles: string[];
  /** `system_versions.permissions_version` at issue time: a moved version re-validates against the DB. */
  pv: number;
  /**
   * `app_users.token_version` at issue time. Logout, block, password change or reset and deletion move it,
   * which rejects every access token issued before (checked on each request).
   */
  tv: number;
  /** Refresh-token family (one sign-in). */
  sid: string;
};

const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

const sign = (key: Buffer, input: string): Buffer => createHmac('sha256', key).update(input).digest();

export const signAccessToken = (key: Buffer, claims: AccessTokenClaims): string => {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${HEADER}.${payload}`;
  return `${input}.${sign(key, input).toString('base64url')}`;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const parseClaims = (payload: string): AccessTokenClaims | undefined => {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const claims = value as Record<string, unknown>;
  const valid =
    typeof claims.sub === 'string' &&
    claims.aud === APP_TOKEN_AUDIENCE &&
    Number.isInteger(claims.iat) &&
    Number.isInteger(claims.exp) &&
    isStringArray(claims.roles) &&
    Number.isInteger(claims.pv) &&
    Number.isInteger(claims.tv) &&
    typeof claims.sid === 'string';
  return valid ? (claims as AccessTokenClaims) : undefined;
};

/** The token's claims when it is well-formed, correctly signed, for this audience and unexpired. */
export const verifyAccessToken = (
  key: Buffer,
  token: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): AccessTokenClaims | undefined => {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return undefined;
  }
  const [header, payload, signature] = parts as [string, string, string];
  if (header !== HEADER) {
    return undefined;
  }
  const expected = sign(key, `${header}.${payload}`);
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return undefined;
  }
  const claims = parseClaims(payload);
  return claims && claims.exp > nowSeconds ? claims : undefined;
};

/** Whether a bearer value looks like a JWT (three base64url segments), to route it to this verifier. */
export const looksLikeJwt = (value: string): boolean => /^[\w-]+\.[\w-]+\.[\w-]+$/.test(value);
