import { LOCK_NAMESPACE } from '../../constants/lockKeys.js';
import { acquireXactLock, lockKeyFromId } from '../../db/advisoryLocks.js';
import type { Database } from '../../db/index.js';
import * as entryHeadsRepository from '../../repositories/entryHeads.js';
import type { ScannedHead } from '../../repositories/entryHeads.js';

/**
 * Resumable scans over entries for schema prerequisites (ADR 0002 transitional write policy).
 *
 * The watermark is read while holding the models' exclusive advisory locks for an instant: no entry write
 * (which holds the shared lock for its whole transaction) is in flight then, so every head with
 * `change_seq <= watermark` is committed and every later write gets a higher number. The dry run covers
 * entries whose heads are all at or below the watermark while writes continue; activation re-checks the
 * entries with a head above it.
 */
export const ENTRY_BATCH_SIZE = 200;

export const acquireWatermark = (database: Database, modelIds: readonly string[]): Promise<string> =>
  database.transaction().execute(async (trx) => {
    const keys = [...new Set(modelIds.map(lockKeyFromId))].sort((a, b) => a - b);
    for (const key of keys) {
      await acquireXactLock(trx, LOCK_NAMESPACE.model, key);
    }
    return entryHeadsRepository.maxChangeSeq(modelIds, trx);
  });

/** True when one of the heads was written after the watermark. */
export const changedAfter = (heads: readonly ScannedHead[], watermark: string) =>
  heads.some((head) => BigInt(head.change_seq) > BigInt(watermark));

export type EntryCursor = string | null;

export type EntryScanOptions = {
  modelIds: readonly string[];
  /** Only entries with a head changed after this sequence number. */
  changedAfterSeq?: string;
  cursor: EntryCursor;
  signal?: AbortSignal;
  /** Called after each batch with the cursor to resume from. */
  onBatchDone?: (cursor: EntryCursor) => Promise<void>;
};

const groupByEntry = (heads: readonly ScannedHead[]): ScannedHead[][] => {
  const groups = new Map<string, ScannedHead[]>();
  for (const head of heads) {
    const group = groups.get(head.entry_id);
    if (group) {
      group.push(head);
    } else {
      groups.set(head.entry_id, [head]);
    }
  }
  return [...groups.values()];
};

/** Visits entries (all their heads at once) in key order, batch by batch. */
export const scanEntries = async (
  executor: Parameters<typeof entryHeadsRepository.scanEntryBatch>[1],
  options: EntryScanOptions,
  visit: (heads: ScannedHead[]) => Promise<void>,
): Promise<void> => {
  let cursor = options.cursor;
  if (options.modelIds.length === 0) {
    return;
  }
  for (;;) {
    options.signal?.throwIfAborted();
    const entries = groupByEntry(
      await entryHeadsRepository.scanEntryBatch(
        {
          modelIds: options.modelIds,
          afterEntryId: cursor,
          limit: ENTRY_BATCH_SIZE,
          ...(options.changedAfterSeq !== undefined ? { changedAfterSeq: options.changedAfterSeq } : {}),
        },
        executor,
      ),
    );
    for (const heads of entries) {
      await visit(heads);
    }
    const last = entries.at(-1)?.[0];
    if (!last) {
      return;
    }
    cursor = last.entry_id;
    await options.onBatchDone?.(cursor);
    if (entries.length < ENTRY_BATCH_SIZE) {
      return;
    }
  }
};
