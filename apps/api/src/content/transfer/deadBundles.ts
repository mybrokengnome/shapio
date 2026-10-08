import type { Database } from '../../db/index.js';
import { describeError } from '../../helpers/errors.js';
import type { JobLogger } from '../../jobs/types.js';
import type { MediaStorage } from '../../media/types.js';
import * as retentionRepository from '../../repositories/retention.js';
import { removeStoredBundle, type StoredBundle } from './bundleFile.js';
import { TRANSFER_IMPORT_JOB } from './job.js';

const PAGE_SIZE = 500;

/** The stored bundle a `transfer.import` payload names; undefined when the payload has none. */
const bundleOf = (payload: unknown): StoredBundle | undefined => {
  const bundle = (payload as { bundle?: Partial<StoredBundle> } | null)?.bundle;
  return typeof bundle?.driver === 'string' && typeof bundle.key === 'string'
    ? { driver: bundle.driver, key: bundle.key }
    : undefined;
};

/**
 * Removes the stored bundles of `transfer.import` jobs that died before `before`. A dead job keeps its bundle
 * for the retention period so an operator's retry can still run; after that the bundle only takes space. The
 * job rows stay. Deleting a missing object succeeds, so bundles already gone (an earlier sweep, a cleanup
 * phase) cost a no-op each. A bundle that cannot be removed is logged and left for the next day's sweep.
 */
export const removeDeadImportBundles = async (
  db: Database,
  storage: MediaStorage,
  before: Date,
  { signal, log }: { signal: AbortSignal; log: JobLogger },
): Promise<number> => {
  let removed = 0;
  let afterId: string | null = null;
  for (;;) {
    const jobs = await retentionRepository.listDeadJobs(TRANSFER_IMPORT_JOB, before, afterId, PAGE_SIZE, db);
    for (const job of jobs) {
      const bundle = bundleOf(job.payload);
      if (!bundle) {
        continue;
      }
      try {
        await removeStoredBundle(storage, bundle);
        removed += 1;
      } catch (error) {
        log.warn(
          { err: describeError(error), jobId: job.id, key: bundle.key },
          'could not remove the bundle of a dead import',
        );
      }
    }
    afterId = jobs.at(-1)?.id ?? afterId;
    if (jobs.length < PAGE_SIZE || signal.aborted) {
      return removed;
    }
  }
};
