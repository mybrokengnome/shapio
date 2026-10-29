import { describe, expect, it } from 'vitest';
import type { RequiredGap } from './contentPorts.js';
import { mergeGaps } from './gaps.js';

const gap = (step: string, versions: number, entries: number, samples: string[]): RequiredGap => ({
  step,
  ownerId: 'm1',
  fieldId: 'f1',
  fieldApiKey: 'keywords',
  versions,
  entries,
  sampleEntryIds: samples,
});

describe('mergeGaps', () => {
  it("adds the dry run's and the re-check's counts per step, keeping distinct sample entries", () => {
    expect(
      mergeGaps([gap('a', 4, 3, ['e1', 'e2'])], [gap('a', 1, 1, ['e2', 'e3']), gap('b', 2, 1, ['e4'])]),
    ).toEqual([gap('a', 5, 4, ['e1', 'e2', 'e3']), gap('b', 2, 1, ['e4'])]);
  });

  it('keeps at most ten sample entries, and nothing when neither side had gaps', () => {
    const many = Array.from({ length: 8 }, (_, index) => `e${index}`);
    const more = Array.from({ length: 8 }, (_, index) => `f${index}`);
    expect(mergeGaps([gap('a', 8, 8, many)], [gap('a', 8, 8, more)])[0]?.sampleEntryIds).toHaveLength(10);
    expect(mergeGaps(undefined, undefined)).toEqual([]);
  });
});
