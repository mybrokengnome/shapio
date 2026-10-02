const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 10 * 60 * 1000;

/**
 * Exponential backoff with equal jitter: attempt n waits between half and all of min(1s * 2^(n-1), 10 min).
 * `random` is injectable for tests.
 */
export const computeRetryDelayMs = (attempt: number, random: () => number = Math.random): number => {
  const ceiling = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
};
