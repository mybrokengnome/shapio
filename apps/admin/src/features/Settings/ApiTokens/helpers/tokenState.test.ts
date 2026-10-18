import type { ApiToken } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { listedTokens, tokenStateOf } from './tokenState';

const NOW = Date.parse('2026-10-18T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const at = (offset: number) => new Date(NOW + offset).toISOString();
const state = (expiresAt: string | null, creatorDisabled = false) =>
  tokenStateOf({ expiresAt, creatorDisabled }, NOW);

describe('tokenStateOf', () => {
  it('is active without an expiry or with one more than 14 days away', () => {
    expect(state(null)).toEqual({ kind: 'active' });
    expect(state(at(365 * DAY))).toEqual({ kind: 'active' });
    expect(state(at(14 * DAY + 1))).toEqual({ kind: 'active' });
  });

  it('counts the days left, rounded up, within 14 days of expiry', () => {
    expect(state(at(14 * DAY))).toEqual({ kind: 'expiring', days: 14 });
    expect(state(at(5 * DAY))).toEqual({ kind: 'expiring', days: 5 });
    expect(state(at(3 * 60 * 60 * 1000))).toEqual({ kind: 'expiring', days: 1 });
  });

  it('is expired at and after the expiry, ahead of paused (expired is final)', () => {
    expect(state(at(0))).toEqual({ kind: 'expired' });
    expect(state(at(-DAY), true)).toEqual({ kind: 'expired' });
  });

  it('is paused while its creator is disabled, even when expiring soon', () => {
    expect(state(null, true)).toEqual({ kind: 'paused' });
    expect(state(at(5 * DAY), true)).toEqual({ kind: 'paused' });
  });
});

describe('listedTokens', () => {
  it('leaves revoked tokens out', () => {
    const tokens = [
      { id: 'live', revokedAt: null },
      { id: 'gone', revokedAt: at(-DAY) },
    ] as ApiToken[];
    expect(listedTokens(tokens).map((token) => token.id)).toEqual(['live']);
  });
});
