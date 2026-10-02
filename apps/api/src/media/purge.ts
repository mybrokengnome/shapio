import type { Transaction } from 'kysely';
import { MEDIA_JOB_MAX_ATTEMPTS, MEDIA_PURGE_JOB } from '../constants/media.js';
import type { DB } from '../db/types.js';
import { enqueueJob } from '../jobs/queue.js';
import { PermanentJobError } from '../jobs/types.js';
import { STORAGE_DRIVERS, type MediaStorage, type StorageDriver } from './types.js';

export type StoredObject = { driver: StorageDriver; key: string };

/** Deletes objects once the transaction that stopped using them commits (retried while storage is down). */
export const enqueuePurge = async (trx: Transaction<DB>, objects: readonly StoredObject[]) => {
  if (objects.length > 0) {
    await enqueueJob(
      { type: MEDIA_PURGE_JOB, payload: { objects }, maxAttempts: MEDIA_JOB_MAX_ATTEMPTS },
      trx,
    );
  }
};

const isStoredObject = (value: unknown): value is StoredObject => {
  const object = value as Partial<StoredObject> | null;
  return typeof object?.key === 'string' && STORAGE_DRIVERS.includes(object.driver as StorageDriver);
};

/** Job handler body: deletes each object (deleting a missing object succeeds, so retries are safe). */
export const purgeObjects = async (storage: MediaStorage, payload: unknown): Promise<{ deleted: number }> => {
  const objects = (payload as { objects?: unknown } | null)?.objects;
  if (!Array.isArray(objects) || !objects.every(isStoredObject)) {
    throw new PermanentJobError('Purge payload needs objects: [{ driver, key }]');
  }
  for (const object of objects) {
    if (!storage.has(object.driver)) {
      throw new PermanentJobError(
        `Cannot purge ${object.key}: storage driver ${object.driver} is not configured`,
      );
    }
    await storage.get(object.driver).delete(object.key);
  }
  return { deleted: objects.length };
};
