import type { Database } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import * as schemaActivationsRepository from '../repositories/schemaActivations.js';
import * as schemaVersionsRepository from '../repositories/schemaVersions.js';
import { historyIsIncomplete } from '../schema/lens/views.js';

/**
 * Pinning an API token to a schema version (plan schema-lenses): a request made with the token that names no
 * schema version is served as if it had named the pinned one. These helpers validate a pin and tell, cheaply,
 * whether the activation history reaches it.
 */

export const invalidPinnedSchemaVersion = (value: number, current: number) =>
  new AppError(
    400,
    'INVALID_PINNED_SCHEMA_VERSION',
    `The pinned schema version must be a whole number from 1 to the current schema version (${current}); got ${value}.`,
    { pinnedSchemaVersion: value, currentVersion: current },
  );

/** Null clears the pin; anything else must be an integer from 1 to the current global schema version. */
export const assertPinnedSchemaVersion = async (value: number | null, executor: Database): Promise<void> => {
  if (value === null) {
    return;
  }
  const current = await schemaVersionsRepository.getSchemaVersion(executor);
  if (!Number.isSafeInteger(value) || value < 1 || value > current) {
    throw invalidPinnedSchemaVersion(value, current);
  }
};

export type PinnedToken = { siteId: string | null; pinnedSchemaVersion: number | null };

/**
 * Whether reads at each token's pinned version are served for every definition of its workspace (shared ones
 * included); a network token (no workspace) counts every workspace's. Tokens without a pin are always
 * available. One query, made only when some token is pinned.
 */
export const pinnedVersionsAvailable = async (
  tokens: readonly PinnedToken[],
  executor: Database,
): Promise<boolean[]> => {
  if (tokens.every((token) => token.pinnedSchemaVersion === null)) {
    return tokens.map(() => true);
  }
  const incomplete = (await schemaActivationsRepository.findEarliest(executor)).filter(historyIsIncomplete);
  return tokens.map(({ siteId, pinnedSchemaVersion }) => {
    if (pinnedSchemaVersion === null) {
      return true;
    }
    return !incomplete.some(
      (row) =>
        row.schemaVersion > pinnedSchemaVersion &&
        (siteId === null || row.siteId === null || row.siteId === siteId),
    );
  });
};
