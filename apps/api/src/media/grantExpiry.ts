import * as mediaUploadGrantsRepository from '../repositories/mediaUploadGrants.js';
import type { MediaJobDependencies } from './process.js';
import type { StorageDriver } from './types.js';

/**
 * The `media.grant.expire` job, scheduled when a grant is issued: if the upload was never confirmed, the
 * object (if any arrived) is deleted and the grant marked expired. Deleting first keeps a retry correct.
 */
export const expireUploadGrant = async (
  deps: MediaJobDependencies,
  payload: { grantId: string },
): Promise<'expired' | 'settled'> => {
  const grant = await mediaUploadGrantsRepository.findById(payload.grantId, deps.db);
  if (grant?.status !== 'pending') {
    return 'settled';
  }
  await deps.storage.get(grant.storage_driver as StorageDriver).delete(grant.storage_key);
  return deps.db.transaction().execute(async (trx) => {
    const locked = await mediaUploadGrantsRepository.lockById(grant.id, trx);
    if (locked?.status !== 'pending') {
      return 'settled';
    }
    await mediaUploadGrantsRepository.setStatus(grant.id, 'expired', trx);
    return 'expired';
  });
};
