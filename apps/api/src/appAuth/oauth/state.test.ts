import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { codeChallengeOf, newOAuthState, openOAuthState, sealOAuthState } from './state.js';

const key = randomBytes(32);
const NOW = 1_800_000_000_000;

describe('OAuth state cookie', () => {
  const state = newOAuthState('google', 'https://app.example.com/after', 'app-challenge', 60_000, NOW);
  const cookie = sealOAuthState(key, state);

  it('opens only for the same provider and state, before expiry', () => {
    expect(openOAuthState(key, cookie, { provider: 'google', state: state.state }, NOW)).toEqual(state);
    expect(openOAuthState(key, cookie, { provider: 'github', state: state.state }, NOW)).toBeUndefined();
    expect(openOAuthState(key, cookie, { provider: 'google', state: 'other' }, NOW)).toBeUndefined();
    expect(
      openOAuthState(key, cookie, { provider: 'google', state: state.state }, NOW + 60_000),
    ).toBeUndefined();
  });

  it('rejects a cookie signed with another key, tampered or missing', () => {
    expect(
      openOAuthState(randomBytes(32), cookie, { provider: 'google', state: state.state }, NOW),
    ).toBeUndefined();
    const [, signature] = cookie.split('.');
    const forged = `${Buffer.from(JSON.stringify({ ...state, redirectTo: 'https://evil.example' })).toString('base64url')}.${signature}`;
    expect(openOAuthState(key, forged, { provider: 'google', state: state.state }, NOW)).toBeUndefined();
    expect(openOAuthState(key, undefined, { provider: 'google', state: state.state }, NOW)).toBeUndefined();
  });

  it('derives the RFC 7636 S256 challenge', () => {
    // RFC 7636 appendix B.
    expect(codeChallengeOf('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    expect(codeChallengeOf(state.codeVerifier)).toBe(
      createHash('sha256').update(state.codeVerifier).digest('base64url'),
    );
  });
});
