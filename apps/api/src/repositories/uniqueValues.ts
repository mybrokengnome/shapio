import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';
import { entrySiteOf } from './entries.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type UniqueKey = { fieldId: string; locale: string; state: string; valueHash: string };

export const listForEntry = (entryId: string, fieldIds: readonly string[], executor: Executor = db) =>
  fieldIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('unique_values')
        .select(['field_id', 'locale', 'state', 'value_hash'])
        .where('entry_id', '=', entryId)
        .where('field_id', 'in', fieldIds)
        .execute();

export const removeKey = (entryId: string, key: UniqueKey, trx: Executor = db) =>
  trx
    .deleteFrom('unique_values')
    .where('entry_id', '=', entryId)
    .where('field_id', '=', key.fieldId)
    .where('locale', '=', key.locale)
    .where('state', '=', key.state)
    .where('value_hash', '=', key.valueHash)
    .execute();

/**
 * Claims a value for an entry. Returns the owning entry: this one, or the one that already holds it.
 * A concurrent claim of the same key waits on the unique index until the other transaction ends, so two
 * writers can never both own a value.
 */
export const claim = async (
  key: UniqueKey & { entryId: string; modelId: string },
  trx: Executor = db,
): Promise<string> => {
  const inserted = await trx
    .insertInto('unique_values')
    .values({
      // Uniqueness is per site: the key includes the entry's site.
      site_id: entrySiteOf(trx, key.entryId),
      field_id: key.fieldId,
      locale: key.locale,
      state: key.state,
      value_hash: key.valueHash,
      entry_id: key.entryId,
      model_id: key.modelId,
    })
    .onConflict((conflict) => conflict.doNothing())
    .returning('entry_id')
    .executeTakeFirst();
  if (inserted) {
    return inserted.entry_id;
  }
  const owner = await trx
    .selectFrom('unique_values')
    .select('entry_id')
    .where('site_id', '=', entrySiteOf(trx, key.entryId))
    .where('field_id', '=', key.fieldId)
    .where('locale', '=', key.locale)
    .where('state', '=', key.state)
    .where('value_hash', '=', key.valueHash)
    .executeTakeFirst();
  // Deleted in between (the other writer rolled back or moved on): treat as taken; the caller retries.
  return owner?.entry_id ?? '';
};

export const removeForEntry = (entryId: string, trx: Executor = db) =>
  trx.deleteFrom('unique_values').where('entry_id', '=', entryId).execute();

export const removeForEntryState = (
  entryId: string,
  state: string,
  locale: string | null,
  trx: Executor = db,
) => {
  let query = trx.deleteFrom('unique_values').where('entry_id', '=', entryId).where('state', '=', state);
  if (locale !== null) {
    query = query.where('locale', '=', locale);
  }
  return query.execute();
};

/** Replaces a field's rows with the rows staged under `stagingFieldId` (activation of a changed unique field). */
export const replaceField = async (stagingFieldId: string, fieldId: string, trx: Executor = db) => {
  await trx.deleteFrom('unique_values').where('field_id', '=', fieldId).execute();
  await trx
    .updateTable('unique_values')
    .set({ field_id: fieldId })
    .where('field_id', '=', stagingFieldId)
    .execute();
};

export const removeForField = (fieldId: string, trx: Executor = db) =>
  trx.deleteFrom('unique_values').where('field_id', '=', fieldId).executeTakeFirst();

export const removeForLocale = (locale: string, trx: Executor = db) =>
  trx.deleteFrom('unique_values').where('locale', '=', locale).executeTakeFirst();

export const removeForEntryField = (entryId: string, fieldId: string, trx: Executor = db) =>
  trx.deleteFrom('unique_values').where('entry_id', '=', entryId).where('field_id', '=', fieldId).execute();

/** Owners of registry keys other than `entryId` (read-only; the publish pre-flight and health rules). */
export const findOtherOwners = (entryId: string, keys: readonly UniqueKey[], executor: Executor = db) =>
  keys.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('unique_values')
        .select(['field_id', 'locale', 'state', 'value_hash', 'entry_id'])
        .where('entry_id', '!=', entryId)
        .where('site_id', '=', entrySiteOf(executor, entryId))
        .where((eb) =>
          eb.or(
            keys.map((key) =>
              eb.and([
                eb('field_id', '=', key.fieldId),
                eb('locale', '=', key.locale),
                eb('state', '=', key.state),
                eb('value_hash', '=', key.valueHash),
              ]),
            ),
          ),
        )
        .execute();
