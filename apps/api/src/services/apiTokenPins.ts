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

export const invalidPinnedSchemaVersion = (value: unknown, current: number) =>
  new AppError(
    400,
    'INVALID_PINNED_SCHEMA_VERSION',
    `The pinned schema version must be a whole number from 1 to the current schema version (${current}); got ${JSON.stringify(value)}.`,
    { pinnedSchemaVersion: value, currentVersion: current },
  );

/**
 * The pin a request sends, checked strictly: null clears it; anything else must be a JSON number that is an
 * integer from 1 to the current global schema version. The route schema leaves the field untyped so no
 * coercion runs first (a boolean or a numeric string is refused, never read as a number).
 */
export const parsePinnedSchemaVersion = async (
  value: unknown,
  executor: Database,
): Promise<number | null> => {
  if (value === null) {
    return null;
  }
  const current = await schemaVersionsRepository.getSchemaVersion(executor);
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > current) {
    throw invalidPinnedSchemaVersion(value, current);
  }
  return value;
};

export type PinnedToken = { siteId: string | null; pinnedSchemaVersion: number | null };

/**
 * Whether reads at each token's pinned version are served for every definition of its workspace (shared ones
 * included); a network token (no workspace) counts every workspace's. A pin ahead of the current version
 * (after a restore to an earlier point) is never served (`SCHEMA_VERSION_AHEAD`). Tokens without a pin are
 * always available. Two small queries, made only when some token is pinned.
 */
export const pinnedVersionsAvailable = async (
  tokens: readonly PinnedToken[],
  executor: Database,
): Promise<boolean[]> => {
  if (tokens.every((token) => token.pinnedSchemaVersion === null)) {
    return tokens.map(() => true);
  }
  const [current, earliest] = await Promise.all([
    schemaVersionsRepository.getSchemaVersion(executor),
    schemaActivationsRepository.findEarliest(executor),
  ]);
  const incomplete = earliest.filter(historyIsIncomplete);
  return tokens.map(({ siteId, pinnedSchemaVersion }) => {
    if (pinnedSchemaVersion === null) {
      return true;
    }
    if (pinnedSchemaVersion > current) {
      return false;
    }
    return !incomplete.some(
      (row) =>
        row.schemaVersion > pinnedSchemaVersion &&
        (siteId === null || row.siteId === null || row.siteId === siteId),
    );
  });
};
