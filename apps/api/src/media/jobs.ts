import {
  MEDIA_GRANT_EXPIRE_JOB,
  MEDIA_PROCESS_JOB,
  MEDIA_PURGE_JOB,
  MEDIA_RELOCATE_JOB,
} from '../constants/media.js';
import { PermanentJobError, type JobHandler } from '../jobs/types.js';
import { expireUploadGrant } from './grantExpiry.js';
import { markProcessingFailed, processAsset, type MediaJobDependencies } from './process.js';
import { purgeObjects } from './purge.js';
import { relocateAsset } from './relocate.js';

const readString = (payload: unknown, key: string): string => {
  const value =
    typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)[key] : undefined;
  if (typeof value !== 'string') {
    throw new PermanentJobError(`Job payload is missing "${key}"`);
  }
  return value;
};

/** Job handlers for media: processing (checksum, size, variants), purges, visibility moves, grant expiry. */
export const createMediaJobHandlers = (deps: Omit<MediaJobDependencies, 'log'>): [string, JobHandler][] => [
  [
    MEDIA_PROCESS_JOB,
    async ({ payload, attempt, maxAttempts, log }) => {
      const input = {
        assetId: readString(payload, 'assetId'),
        storageKey: readString(payload, 'storageKey'),
      };
      try {
        return { outcome: await processAsset({ ...deps, log }, input) };
      } catch (error) {
        if (attempt >= maxAttempts || error instanceof PermanentJobError) {
          await markProcessingFailed({ ...deps, log }, input, error);
        }
        throw error;
      }
    },
  ],
  [MEDIA_PURGE_JOB, async ({ payload }) => purgeObjects(deps.storage, payload)],
  [
    MEDIA_RELOCATE_JOB,
    async ({ payload, log }) => ({
      outcome: await relocateAsset({ ...deps, log }, { assetId: readString(payload, 'assetId') }),
    }),
  ],
  [
    MEDIA_GRANT_EXPIRE_JOB,
    async ({ payload, log }) => ({
      outcome: await expireUploadGrant({ ...deps, log }, { grantId: readString(payload, 'grantId') }),
    }),
  ],
];
