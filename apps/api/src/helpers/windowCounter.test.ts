import { describe, expect, it } from 'vitest';
import { createWindowCounter } from './windowCounter.js';

describe('createWindowCounter', () => {
  it('takes up to max slots per key in a window, then refuses with the time left', () => {
    const counter = createWindowCounter({ max: 2, timeWindow: 60_000 });
    expect(counter.reserve('a', 0).ok).toBe(true);
    expect(counter.reserve('a', 1_000).ok).toBe(true);
    expect(counter.reserve('a', 1_500)).toEqual({ ok: false, retryAfterSeconds: 59 });
    expect(counter.reserve('b', 1_500).ok).toBe(true);
  });

  it('frees a slot on release', () => {
    const counter = createWindowCounter({ max: 1, timeWindow: 60_000 });
    const first = counter.reserve('a', 0);
    expect(first.ok).toBe(true);
    expect(counter.reserve('a', 10).ok).toBe(false);
    if (first.ok) counter.release(first.reservation);
    expect(counter.reserve('a', 20).ok).toBe(true);
  });

  it('starts a new window once the old one ends, and a late release does not touch it', () => {
    const counter = createWindowCounter({ max: 1, timeWindow: 1_000 });
    const old = counter.reserve('a', 0);
    expect(counter.reserve('a', 999).ok).toBe(false);
    expect(counter.reserve('a', 1_000).ok).toBe(true);
    if (old.ok) counter.release(old.reservation);
    expect(counter.reserve('a', 1_001).ok).toBe(false);
  });

  it('never reports less than one second to wait', () => {
    const counter = createWindowCounter({ max: 1, timeWindow: 1_000 });
    counter.reserve('a', 0);
    expect(counter.reserve('a', 999)).toEqual({ ok: false, retryAfterSeconds: 1 });
  });

  it('drops expired keys, and the oldest live keys once it holds maxKeys', () => {
    const counter = createWindowCounter({ max: 1, timeWindow: 1_000, maxKeys: 3 });
    counter.reserve('a', 0);
    counter.reserve('b', 0);
    counter.reserve('c', 0);
    // Full: reserving a fourth key drops the oldest one.
    counter.reserve('d', 10);
    expect(counter.size()).toBe(3);
    expect(counter.reserve('a', 20).ok).toBe(true);
    // Once their windows end, sweeping removes them all.
    counter.reserve('e', 5_000);
    expect(counter.size()).toBe(1);
  });
});
