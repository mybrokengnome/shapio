import { z } from 'zod';

export const snapshotsSearchSchema = z.object({ cursor: z.string().max(500).optional().catch(undefined) });

export const SNAPSHOT_TABS = ['diff', 'timeline'] as const;
export type SnapshotTab = (typeof SNAPSHOT_TABS)[number];

const seq = z.coerce.number().int().min(0).optional().catch(undefined);

/** `/snapshots/:seq?from=&tab=&at=`: the compare base, the tab, and the scrubber's position. */
export const snapshotSearchSchema = z.object({
  from: seq,
  tab: z.enum(SNAPSHOT_TABS).optional().catch(undefined),
  at: seq,
});
