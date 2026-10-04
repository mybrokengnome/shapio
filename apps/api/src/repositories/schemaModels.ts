import type { Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, SchemaRevisions } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type SchemaRevisionRow = Selectable<SchemaRevisions>;

/** The active revision of every live (not deleted) model and component. */
export const findActiveDefinitions = (executor: Executor = db) =>
  executor
    .selectFrom('model_active_versions as active')
    .innerJoin('models', 'models.id', 'active.model_id')
    .innerJoin('schema_revisions as revision', 'revision.id', 'active.revision_id')
    .where('models.deleted_at', 'is', null)
    .select([
      'models.id as modelId',
      'models.kind as kind',
      'models.site_id as siteId',
      'active.version as version',
      'active.revision_id as revisionId',
      'active.activated_at as activatedAt',
      'revision.hash as hash',
      'revision.definition as definition',
    ])
    .orderBy('models.created_at')
    .orderBy('models.id')
    .execute();

export type ActiveDefinitionRow = Awaited<ReturnType<typeof findActiveDefinitions>>[number];

export const findModelById = (id: string, executor: Executor = db) =>
  executor.selectFrom('models').selectAll().where('id', '=', id).executeTakeFirst();

/** `siteId` null: a shared definition (every site); otherwise the one site it belongs to. */
export const insertModel = (
  model: { id: string; kind: string; apiKey: string; siteId: string | null },
  trx: Executor = db,
) =>
  trx
    .insertInto('models')
    .values({ id: model.id, kind: model.kind, api_key: model.apiKey, site_id: model.siteId })
    .execute();

/** Definitions of one site that are not deleted (active or still pending their first activation). */
export const countSiteDefinitions = async (siteId: string, executor: Executor = db): Promise<number> => {
  const row = await executor
    .selectFrom('models')
    .select((eb) => eb.fn.countAll<number | string | bigint>().as('count'))
    .where('site_id', '=', siteId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  return Number(row?.count ?? 0);
};

/** A site's deleted definitions (what `deleteSite` purges with the site). */
export const findDeletedIdsOfSite = async (siteId: string, executor: Executor = db): Promise<string[]> =>
  (
    await executor
      .selectFrom('models')
      .select('id')
      .where('site_id', '=', siteId)
      .where('deleted_at', 'is not', null)
      .execute()
  ).map((row) => row.id);

/**
 * Purges deleted definitions with their history (`deleteSite`, once the site has no live definition and the
 * definitions' deleted entries are purged): change rows, revisions, then the models rows.
 */
export const purgeDefinitions = async (ids: readonly string[], trx: Executor = db): Promise<void> => {
  if (ids.length === 0) {
    return;
  }
  await trx.deleteFrom('schema_change_jobs').where('model_id', 'in', ids).execute();
  await trx.deleteFrom('model_active_versions').where('model_id', 'in', ids).execute();
  // Newest first, one row at a time: a revision's parent always has a lower version, and MySQL checks the
  // self-reference row by row.
  const revisions = await trx
    .selectFrom('schema_revisions')
    .select('id')
    .where('model_id', 'in', ids)
    .orderBy('version', 'desc')
    .execute();
  for (const revision of revisions) {
    await trx.deleteFrom('schema_revisions').where('id', '=', revision.id).execute();
  }
  await trx.deleteFrom('models').where('id', 'in', ids).execute();
};

/**
 * Keeps the denormalised kind, API key and scope in step with the active revision; also undeletes. The scope
 * only differs from the stored one for a scope change (`ActivationItem.moveScope`).
 */
export const markModelActive = (
  model: { id: string; kind: string; apiKey: string; siteId: string | null; now: Date },
  trx: Executor = db,
) =>
  trx
    .updateTable('models')
    .set({
      kind: model.kind,
      api_key: model.apiKey,
      site_id: model.siteId,
      updated_at: model.now,
      deleted_at: null,
    })
    .where('id', '=', model.id)
    .execute();

export const softDeleteModel = (id: string, now: Date, trx: Executor = db) =>
  trx.updateTable('models').set({ deleted_at: now, updated_at: now }).where('id', '=', id).execute();

export const findActivePointer = (modelId: string, executor: Executor = db) =>
  executor.selectFrom('model_active_versions').selectAll().where('model_id', '=', modelId).executeTakeFirst();

export const upsertActivePointer = (
  pointer: { modelId: string; revisionId: string; version: number; schemaVersion: number; now: Date },
  trx: Executor = db,
) =>
  trx
    .insertInto('model_active_versions')
    .values({
      model_id: pointer.modelId,
      revision_id: pointer.revisionId,
      version: pointer.version,
      schema_version: pointer.schemaVersion,
      activated_at: pointer.now,
    })
    .onConflict((oc) =>
      oc.column('model_id').doUpdateSet({
        revision_id: pointer.revisionId,
        version: pointer.version,
        schema_version: pointer.schemaVersion,
        activated_at: pointer.now,
      }),
    )
    .execute();

export const deleteActivePointer = (modelId: string, trx: Executor = db) =>
  trx.deleteFrom('model_active_versions').where('model_id', '=', modelId).execute();

export const findLatestRevisionVersion = async (
  modelId: string,
  executor: Executor = db,
): Promise<number> => {
  const row = await executor
    .selectFrom('schema_revisions')
    .select((eb) => eb.fn.max('version').as('version'))
    .where('model_id', '=', modelId)
    .executeTakeFirst();
  return row?.version ?? 0;
};

export type NewRevision = {
  modelId: string;
  version: number;
  definition: unknown;
  hash: string;
  parentRevisionId: string | null;
  createdByType: string;
  createdById: string | null;
};

export const insertRevision = (revision: NewRevision, trx: Executor = db) =>
  trx
    .insertInto('schema_revisions')
    .values({
      model_id: revision.modelId,
      version: revision.version,
      definition: JSON.stringify(revision.definition),
      hash: revision.hash,
      parent_revision_id: revision.parentRevisionId,
      created_by_type: revision.createdByType,
      created_by_id: revision.createdById,
    })
    .returning(['id', 'version', 'created_at'])
    .executeTakeFirstOrThrow();

export const findRevisionById = (id: string, executor: Executor = db) =>
  executor.selectFrom('schema_revisions').selectAll().where('id', '=', id).executeTakeFirst();

/** History of one model, newest first, without the definitions (fetch one revision for its body). */
export const listRevisions = (modelId: string, limit: number, executor: Executor = db) =>
  executor
    .selectFrom('schema_revisions')
    .select(['id', 'version', 'hash', 'parent_revision_id', 'created_by_type', 'created_by_id', 'created_at'])
    .where('model_id', '=', modelId)
    .orderBy('version', 'desc')
    .limit(limit)
    .execute();

/** The newest revision of a model, active or not (used to restore a deleted definition). */
export const findLatestRevision = (modelId: string, executor: Executor = db) =>
  executor
    .selectFrom('schema_revisions')
    .selectAll()
    .where('model_id', '=', modelId)
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirst();
