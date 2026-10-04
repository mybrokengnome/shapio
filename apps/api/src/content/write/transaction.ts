import type { Transaction } from 'kysely';
import { LOCK_NAMESPACE } from '../../constants/lockKeys.js';
import { acquireXactLockShared, lockKeyFromId } from '../../db/advisoryLocks.js';
import type { Database } from '../../db/index.js';
import type { DB } from '../../db/types.js';
import * as contentGuardsRepository from '../../repositories/contentGuards.js';
import { schemaChanged, unknownLocale } from '../errors.js';
import type { ContentModel } from '../model.js';

/**
 * Steps 1 and 2 of the write policy (see `runEntryWrite`) for one or several models: their shared advisory
 * locks in key order (the order activations use, so two writers never wait on each other in a cycle),
 * then a re-check that each model and every component it embeds are still at the versions the request
 * validated against. Throws 409 SCHEMA_CHANGED otherwise.
 */
export const guardModelVersions = async (
  trx: Transaction<DB>,
  models: readonly ContentModel[],
  /** The site the write is on: a definition that is no longer in its view counts as changed. */
  siteId: string,
): Promise<void> => {
  const keys = [...new Set(models.map((model) => lockKeyFromId(model.definition.id)))].sort((a, b) => a - b);
  for (const key of keys) {
    await acquireXactLockShared(trx, LOCK_NAMESPACE.model, key);
  }
  const expected = new Map<string, number>();
  for (const model of models) {
    expected.set(model.definition.id, model.version);
    for (const [id, component] of model.components) {
      expected.set(id, component.version);
    }
  }
  const active = await contentGuardsRepository.findActiveVersions([...expected.keys()], siteId, trx);
  if (active.length !== expected.size || active.some((row) => expected.get(row.model_id) !== row.version)) {
    throw schemaChanged();
  }
};

/**
 * Step 3: holds the locale rows FOR SHARE, so a locale cannot be deleted under the write. Returns the first
 * code that does not exist (the caller reports it), or undefined.
 */
export const lockWriteLocales = async (
  trx: Transaction<DB>,
  locales: readonly string[],
): Promise<string | undefined> => {
  const unique = [...new Set(locales)];
  const present = await contentGuardsRepository.lockLocales(unique, trx);
  return unique.find((code) => !present.includes(code));
};

/**
 * Every entry write is one transaction under the transitional write policy (ADR 0002):
 * 1. the shared advisory lock of the model (the same key the planner's activation takes exclusively, so an
 *    activation waits for in-flight writes and blocks new ones while it re-checks and flips the pointer);
 * 2. a re-check that the model and every component it embeds are still at the versions this request
 *    validated against, and still in the site's view (an activation or scope change that committed before
 *    the lock was granted is detected here);
 * 3. the target locale rows held FOR SHARE, so a locale cannot be deleted under the write.
 * Component activations lock every dependent model, so the model's own key covers them too.
 * Scheduled and release publications (publishing/publicationBatch.ts) apply the same guard to several models.
 */
export const runEntryWrite = <T>(
  database: Database,
  model: ContentModel,
  siteId: string,
  locales: readonly string[],
  write: (trx: Transaction<DB>) => Promise<T>,
): Promise<T> =>
  database.transaction().execute(async (trx) => {
    await guardModelVersions(trx, [model], siteId);
    const missing = await lockWriteLocales(trx, locales);
    if (missing !== undefined) {
      throw unknownLocale(missing);
    }
    return write(trx);
  });
