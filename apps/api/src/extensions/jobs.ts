import { EXTENSION_JOB_PREFIX } from '../constants/extensions.js';
import type { JobHandler } from '../jobs/types.js';
import type { ExtensionJobHandler, ExtensionServices } from './public.js';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The project's job handlers, registered as `ext.<name>` so they never collide with Shapio's job types. */
export const createExtensionJobHandlers = (
  jobs: Readonly<Record<string, ExtensionJobHandler>>,
  services: ExtensionServices,
): Array<[string, JobHandler]> =>
  Object.entries(jobs).map(([name, handler]) => [
    `${EXTENSION_JOB_PREFIX}${name}`,
    (job) =>
      handler({
        jobId: job.id,
        payload: isRecord(job.payload) ? job.payload : {},
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        idempotencyKey: job.idempotencyKey,
        services,
        logger: job.log,
        signal: job.signal,
      }),
  ]);
