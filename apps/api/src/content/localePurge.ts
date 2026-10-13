import { isModelDefinition, type ModelDefinition } from '@shapio/schema';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/index.js';
import type { DB } from '../db/types.js';
import * as contentPurgeRepository from '../repositories/contentPurge.js';
import * as entriesRepository from '../repositories/entries.js';
import * as entryHeadsRepository from '../repositories/entryHeads.js';
import * as publicationsRepository from '../repositories/publications.js';
import * as uniqueValuesRepository from '../repositories/uniqueValues.js';
import { readSnapshot } from '../schema/loadSnapshot.js';
import type { LocaleRemovalImpact } from '../schema/planner/contentPorts.js';
import { lockSchema } from '../schema/planner/locks.js';
import type { SchemaById } from '../schema/snapshot.js';
import { writeEntryEvent } from '../services/contentAccess.js';
import { isLocalizedField } from './model.js';
import { releaseUnheldUniqueValues, uniqueFields } from './unique.js';

/**
 * Removing a locale's content (ADR 0004). Entries of localized models lose that locale; those that only
 * existed in it are deleted like a normal delete (registry released, `entry.deleted` event). Entries of
 * non-localized models keep their heads in the locale they were created in, so when that locale goes they move
 * to the default locale instead.
 */

const modelsOf = (schema: SchemaById): ModelDefinition[] =>
  schema.definitions.map((active) => active.definition).filter(isModelDefinition);

const nonLocalizedModelIds = (schema: SchemaById) =>
  modelsOf(schema)
    .filter((model) => !model.localized)
    .map((model) => model.id);

/** Localized models with unique shared fields: the registry rows (`*`) their entries hold outlive one locale. */
const sharedUniqueFieldsByModel = (schema: SchemaById) =>
  new Map(
    modelsOf(schema)
      .filter((model) => model.localized)
      .map(
        (model) => [model, uniqueFields(model).filter((field) => !isLocalizedField(model, field))] as const,
      )
      .filter(([, fields]) => fields.length > 0)
      .map(([model, fields]) => [model.id, { model, fields }]),
  );

const impactOf = async (
  executor: Kysely<DB> | Transaction<DB>,
  schema: SchemaById,
  code: string,
): Promise<LocaleRemovalImpact & { movableEntryIds: string[] }> => {
  const nonLocalized = nonLocalizedModelIds(schema);
  const movableHeads = await contentPurgeRepository.findMovableHeads(
    code,
    schema.defaultLocale,
    nonLocalized,
    executor,
  );
  const movableEntryIds = [...new Set(movableHeads)];
  return {
    affectedHeads: (await entryHeadsRepository.countForLocale(code, executor)) - movableHeads.length,
    // An entry of a non-localized model that is only in this locale is moved, not deleted.
    deletedEntries: await contentPurgeRepository.countEntriesOnlyIn(code, nonLocalized, executor),
    movedEntries: movableEntryIds.length,
    movableEntryIds,
  };
};

/** What deleting `code` would do to content, for the plan shown before acknowledging. */
export const countLocaleRemoval = async (database: Database, code: string): Promise<LocaleRemovalImpact> => {
  const { affectedHeads, deletedEntries, movedEntries } = await impactOf(
    database,
    await readSnapshot(database),
    code,
  );
  return { affectedHeads, deletedEntries, movedEntries };
};

/** Releases the shared unique values that entries losing this locale held only through it. */
const releaseSurvivorsUniqueValues = async (trx: Transaction<DB>, schema: SchemaById, code: string) => {
  const byModel = sharedUniqueFieldsByModel(schema);
  const survivors = await contentPurgeRepository.findEntriesAlsoElsewhere(code, [...byModel.keys()], trx);
  for (const { entry_id: entryId, model_id: modelId } of survivors) {
    const unique = byModel.get(modelId);
    if (!unique) {
      continue;
    }
    const heads = (await entryHeadsRepository.findForEntry(entryId, trx)).filter(
      (head) => head.locale !== code,
    );
    await releaseUnheldUniqueValues(trx, { entryId, model: unique.model, fields: unique.fields, heads });
  }
};

/** Deletes the removed locale's content, under the schema lock so the default and `localized` flags hold still. */
export const purgeLocale = (database: Database, code: string) =>
  database.transaction().execute(async (trx) => {
    await lockSchema(trx);
    const schema = await readSnapshot(trx);
    const { movableEntryIds, ...impact } = await impactOf(trx, schema, code);
    await contentPurgeRepository.moveEntriesToLocale(movableEntryIds, code, schema.defaultLocale, trx);
    const deleted = await contentPurgeRepository.findEntriesOnlyIn(code, trx);
    await releaseSurvivorsUniqueValues(trx, schema, code);

    await publicationsRepository.removeForLocale(code, trx);
    await contentPurgeRepository.removeMediaReferencesForLocale(code, trx);
    await entryHeadsRepository.removeForLocale(code, trx);
    await uniqueValuesRepository.removeForLocale(code, trx);
    await contentPurgeRepository.removeRevisionsForLocale(code, movableEntryIds, trx);

    // Entries that existed only in that locale go with it, like a normal delete.
    await contentPurgeRepository.removeUniqueValuesForEntries(
      deleted.map((entry) => entry.id),
      trx,
    );
    await entriesRepository.softDeleteHeadless(null, new Date(), trx);
    for (const entry of deleted) {
      const model = schema.resolve(entry.model_id);
      // A model that is no longer active has no API to announce the deletion to.
      if (model) {
        await writeEntryEvent(trx, entry.site_id, { definition: model }, 'entry.deleted', entry.id, {
          wasPublished: entry.was_published,
          snapshot: null,
          locale: code,
          reason: 'localeRemoved',
        });
      }
    }
    return impact;
  });
