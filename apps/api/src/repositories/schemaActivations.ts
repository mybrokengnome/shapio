import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * Activation history (plan schema-lenses): which revision of each definition, in which scope, every global
 * schema version made active. `revisionId` null: the definition was deleted at that version. Rows are written
 * by activation in its own transaction; `backfilled` rows were rebuilt afterwards (the migration's baseline
 * and the `schema.lensHistoryBackfill` job).
 */
export type NewSchemaActivation = {
  modelId: string;
  schemaVersion: number;
  siteId: string | null;
  revisionId: string | null;
  backfilled?: boolean;
  createdAt?: Date;
};

const toRow = (row: NewSchemaActivation) => ({
  model_id: row.modelId,
  schema_version: row.schemaVersion,
  site_id: row.siteId,
  revision_id: row.revisionId,
  backfilled: row.backfilled ?? false,
  ...(row.createdAt ? { created_at: row.createdAt } : {}),
});

export const insert = (row: NewSchemaActivation, trx: Executor = db) =>
  trx.insertInto('schema_activations').values(toRow(row)).execute();

/** Rows a model already has at a version are kept (the backfill runs again after a crash). */
export const insertMissing = async (
  rows: readonly NewSchemaActivation[],
  trx: Executor = db,
): Promise<number> => {
  if (rows.length === 0) {
    return 0;
  }
  const result = await trx
    .insertInto('schema_activations')
    .values(rows.map(toRow))
    .onConflict((oc) => oc.columns(['model_id', 'schema_version']).doNothing())
    .executeTakeFirst();
  return Number(result.numInsertedOrUpdatedRows ?? 0n);
};

/** Per model, the row with the greatest `schema_version` at or below `version`, with its revision. */
export const findAt = (version: number, executor: Executor = db) =>
  executor
    .selectFrom('schema_activations as activation')
    .innerJoin(
      (eb) =>
        eb
          .selectFrom('schema_activations')
          .select((inner) => ['model_id', inner.fn.max('schema_version').as('schema_version')])
          .where('schema_version', '<=', version)
          .groupBy('model_id')
          .as('latest'),
      (join) =>
        join
          .onRef('latest.model_id', '=', 'activation.model_id')
          .onRef('latest.schema_version', '=', 'activation.schema_version'),
    )
    .innerJoin('models', 'models.id', 'activation.model_id')
    .leftJoin('schema_revisions as revision', 'revision.id', 'activation.revision_id')
    .select([
      'activation.model_id as modelId',
      'activation.site_id as siteId',
      'activation.revision_id as revisionId',
      'activation.schema_version as schemaVersion',
      'activation.backfilled as backfilled',
      'activation.created_at as activatedAt',
      'revision.version as version',
      'revision.hash as hash',
      'revision.definition as definition',
    ])
    // The registry's order (`findActiveDefinitions`): route key collisions resolve the same way.
    .orderBy('models.created_at')
    .orderBy('models.id')
    .execute();

export type ActivationAtRow = Awaited<ReturnType<typeof findAt>>[number];

/**
 * Per model, its earliest row with the revision's definition and whether that revision was the model's
 * first activation (no parent): a model whose earliest row is a backfilled later revision has unknown
 * history before it.
 */
export const findEarliest = (executor: Executor = db) =>
  executor
    .selectFrom('schema_activations as activation')
    .innerJoin(
      (eb) =>
        eb
          .selectFrom('schema_activations')
          .select((inner) => ['model_id', inner.fn.min('schema_version').as('schema_version')])
          .groupBy('model_id')
          .as('earliest'),
      (join) =>
        join
          .onRef('earliest.model_id', '=', 'activation.model_id')
          .onRef('earliest.schema_version', '=', 'activation.schema_version'),
    )
    .innerJoin('models', 'models.id', 'activation.model_id')
    .leftJoin('schema_revisions as revision', 'revision.id', 'activation.revision_id')
    .select([
      'activation.model_id as modelId',
      'activation.site_id as siteId',
      'activation.revision_id as revisionId',
      'activation.schema_version as schemaVersion',
      'activation.backfilled as backfilled',
      'activation.created_at as activatedAt',
      'revision.version as version',
      'revision.hash as hash',
      'revision.definition as definition',
      'revision.parent_revision_id as parentRevisionId',
    ])
    // The registry's order (`findActiveDefinitions`): route key collisions resolve the same way.
    .orderBy('models.created_at')
    .orderBy('models.id')
    .execute();

export type EarliestActivationRow = Awaited<ReturnType<typeof findEarliest>>[number];

/** The (model, schema version) pairs that already have a row, as `<modelId>:<schemaVersion>`. */
export const findKeys = async (executor: Executor = db): Promise<Set<string>> =>
  new Set(
    (await executor.selectFrom('schema_activations').select(['model_id', 'schema_version']).execute()).map(
      (row) => `${row.model_id}:${row.schema_version}`,
    ),
  );

export const deleteForModels = async (ids: readonly string[], trx: Executor = db): Promise<void> => {
  if (ids.length === 0) {
    return;
  }
  await trx.deleteFrom('schema_activations').where('model_id', 'in', ids).execute();
};

/** Every revision's ID and per-model version, for the models given (the backfill maps audit rows to them). */
export const findRevisionVersions = (modelIds: readonly string[], executor: Executor = db) =>
  modelIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('schema_revisions')
        .select(['id', 'model_id as modelId', 'version'])
        .where('model_id', 'in', modelIds)
        .execute();

/** The current scope of the models given that still exist, deleted ones included. */
export const findModelScopes = async (
  modelIds: readonly string[],
  executor: Executor = db,
): Promise<Map<string, string | null>> =>
  modelIds.length === 0
    ? new Map()
    : new Map(
        (
          await executor.selectFrom('models').select(['id', 'site_id']).where('id', 'in', modelIds).execute()
        ).map((row) => [row.id, row.site_id]),
      );
