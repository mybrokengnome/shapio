import { describe, expect, it } from 'vitest';
import { computeRetryDelayMs } from './backoff.js';

describe('computeRetryDelayMs', () => {
  it('grows exponentially between half and all of the ceiling', () => {
    expect(computeRetryDelayMs(1, () => 0)).toBe(500);
    expect(computeRetryDelayMs(1, () => 1)).toBe(1000);
    expect(computeRetryDelayMs(4, () => 1)).toBe(8000);
  });

  it('caps at ten minutes', () => {
    expect(computeRetryDelayMs(50, () => 1)).toBe(600_000);
  });
});
