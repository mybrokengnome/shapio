import type { Worker } from '../../src/jobs/worker.js';
import { waitFor } from './waitFor.js';

/** Ticks `worker` until a tick claims nothing, waiting for each batch to finish (one tick claims up to its concurrency). */
export const drainWorker = async (worker: Worker) => {
  for (;;) {
    const claimed = await worker.tick();
    await waitFor(async () => worker.runningJobIds.size === 0);
    if (claimed === 0) {
      return;
    }
  }
};
