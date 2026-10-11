/** A slot taken by `reserve`; hand it back to `release` if the attempt should not count. */
export type WindowReservation = { readonly key: string; readonly resetAt: number };

export type ReserveResult =
  { ok: true; reservation: WindowReservation } | { ok: false; retryAfterSeconds: number };

export type WindowCounter = {
  /** Takes a slot for `key` if fewer than `max` are taken in its window; checking and counting is one step. */
  reserve: (key: string, now?: number) => ReserveResult;
  /** Gives a slot back. Does nothing once the window it came from has ended. */
  release: (reservation: WindowReservation) => void;
  /** Number of keys held (for tests). */
  size: () => number;
};

type WindowCounterOptions = {
  max: number;
  /** Window length in ms; a key's window starts at its first hit (a fixed window, as @fastify/rate-limit). */
  timeWindow: number;
  /** Keys held at most; past it the oldest are dropped, as the rate-limit plugin's LRU store does. */
  maxKeys?: number;
};

type Entry = { count: number; resetAt: number };

/**
 * An in-process fixed-window counter whose check and increment happen together, so requests in flight at the
 * same time can never all pass the check before any of them is counted. Per process, like the rate-limit
 * plugin's own store (ADR 0008).
 */
export const createWindowCounter = ({
  max,
  timeWindow,
  maxKeys = 10_000,
}: WindowCounterOptions): WindowCounter => {
  const entries = new Map<string, Entry>();
  let nextSweepAt = 0;

  const sweep = (now: number) => {
    if (now < nextSweepAt && entries.size < maxKeys) {
      return;
    }
    nextSweepAt = now + timeWindow;
    for (const [key, entry] of entries) {
      if (entry.resetAt <= now) {
        entries.delete(key);
      }
    }
    // Still full of live keys: drop the oldest (a Map iterates in insertion order).
    for (const key of entries.keys()) {
      if (entries.size < maxKeys) {
        break;
      }
      entries.delete(key);
    }
  };

  return {
    reserve: (key, now = Date.now()) => {
      sweep(now);
      let entry = entries.get(key);
      if (!entry || entry.resetAt <= now) {
        entries.delete(key);
        entry = { count: 0, resetAt: now + timeWindow };
        entries.set(key, entry);
      }
      if (entry.count >= max) {
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)) };
      }
      entry.count += 1;
      return { ok: true, reservation: { key, resetAt: entry.resetAt } };
    },
    release: ({ key, resetAt }) => {
      const entry = entries.get(key);
      if (entry && entry.resetAt === resetAt && entry.count > 0) {
        entry.count -= 1;
      }
    },
    size: () => entries.size,
  };
};
