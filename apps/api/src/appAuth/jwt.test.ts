import { createHmac, randomBytes } from 'node:crypto';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { APP_TOKEN_AUDIENCE } from '../constants/appAuth.js';
import { signAccessToken, verifyAccessToken, type AccessTokenClaims } from './jwt.js';

const key = randomBytes(32);
const NOW = 1_800_000_000;
const claims: AccessTokenClaims = {
  sub: '7c1f8d1e-0000-4000-8000-000000000001',
  aud: APP_TOKEN_AUDIENCE,
  iat: NOW,
  exp: NOW + 900,
  roles: ['r1'],
  pv: 3,
  tv: 0,
  sid: 'family',
};

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const hmac = (input: string) => createHmac('sha256', key).update(input).digest('base64url');

describe('app-user access tokens', () => {
  it('round-trips claims and rejects expired tokens', () => {
    const token = signAccessToken(key, claims);
    expect(verifyAccessToken(key, token, NOW)).toEqual(claims);
    expect(verifyAccessToken(key, token, NOW + 900)).toBeUndefined();
  });

  it('rejects another key, a tampered payload and a different audience', () => {
    const token = signAccessToken(key, claims);
    expect(verifyAccessToken(randomBytes(32), token, NOW)).toBeUndefined();
    const [header, , signature] = token.split('.');
    const forged = `${header}.${b64({ ...claims, sub: 'someone-else' })}.${signature}`;
    expect(verifyAccessToken(key, forged, NOW)).toBeUndefined();
    const otherAudience = signAccessToken(key, { ...claims, aud: 'other' as typeof APP_TOKEN_AUDIENCE });
    expect(verifyAccessToken(key, otherAudience, NOW)).toBeUndefined();
  });

  it('rejects tokens without a token version (issued before it existed)', () => {
    const { tv: _tv, ...withoutVersion } = claims;
    const token = signAccessToken(key, withoutVersion as AccessTokenClaims);
    expect(verifyAccessToken(key, token, NOW)).toBeUndefined();
  });

  it('rejects alg:none and any other header, even when correctly signed', () => {
    for (const header of [
      { alg: 'none', typ: 'JWT' },
      { alg: 'HS512', typ: 'JWT' },
      { typ: 'JWT', alg: 'HS256' },
    ]) {
      const input = `${b64(header)}.${b64(claims)}`;
      expect(verifyAccessToken(key, `${input}.${hmac(input)}`, NOW)).toBeUndefined();
      expect(verifyAccessToken(key, `${input}.`, NOW)).toBeUndefined();
    }
  });

  it('never throws on arbitrary input', () => {
    fc.assert(
      fc.property(fc.string(), (value) => {
        expect(verifyAccessToken(key, value, NOW)).toBeUndefined();
      }),
    );
  });
});
