import type { Transaction } from 'kysely';
import { LOCK_NAMESPACE } from '../../constants/lockKeys.js';
import { acquireXactLock, lockKeyFromId } from '../../db/advisoryLocks.js';
import type { DB } from '../../db/types.js';

/**
 * Serialises every schema activation (and the start of every planned change) instance-wide. Activations are
 * rare, and holding this lock while re-validating the whole schema closes races between changes to
 * *different* definitions (e.g. two renames to colliding GraphQL names). It lives in the model namespace;
 * a collision with a model's hash only costs extra serialisation.
 */
export const SCHEMA_ACTIVATION_LOCK_KEY = lockKeyFromId('shapio:schema-activation');

/**
 * Takes the global schema lock, then the exclusive per-model lock of each affected model in key order (the
 * same order entry writes use for their shared locks, so no deadlock). Entry writes to these models wait
 * until the activation commits (ADR 0002, transitional write policy).
 */
export const lockForActivation = async (trx: Transaction<DB>, modelIds: readonly string[]): Promise<void> => {
  await acquireXactLock(trx, LOCK_NAMESPACE.model, SCHEMA_ACTIVATION_LOCK_KEY);
  const keys = [...new Set(modelIds.map(lockKeyFromId))].sort((a, b) => a - b);
  for (const key of keys) {
    await acquireXactLock(trx, LOCK_NAMESPACE.model, key);
  }
};

export const lockSchema = (trx: Transaction<DB>) =>
  acquireXactLock(trx, LOCK_NAMESPACE.model, SCHEMA_ACTIVATION_LOCK_KEY);
