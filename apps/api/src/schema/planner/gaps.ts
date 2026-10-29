import type { RequiredGap } from './contentPorts.js';

/**
 * Stored with an activated change: what it left for people to do. `requiredGaps` lists, per field made
 * required, the entry versions without a value (listed in the Inbox until filled in).
 */
export type ChangeResult = { requiredGaps: RequiredGap[] };

/** Entries named per gap, as the dry run keeps them. */
const MAX_SAMPLES = 10;

/**
 * Adds up a change's required-value gaps, step by step: the dry run's and the activation re-check's (each
 * counts its own entries; see `gapsOf` in content/migration/checks.ts for why the totals may run high).
 */
export const mergeGaps = (...lists: ReadonlyArray<readonly RequiredGap[] | undefined>): RequiredGap[] => {
  const merged = new Map<string, RequiredGap>();
  for (const gap of lists.flatMap((list) => list ?? [])) {
    const known = merged.get(gap.step);
    if (!known) {
      merged.set(gap.step, { ...gap, sampleEntryIds: gap.sampleEntryIds.slice(0, MAX_SAMPLES) });
      continue;
    }
    known.versions += gap.versions;
    known.entries += gap.entries;
    known.sampleEntryIds = [...new Set([...known.sampleEntryIds, ...gap.sampleEntryIds])].slice(
      0,
      MAX_SAMPLES,
    );
  }
  return [...merged.values()];
};
