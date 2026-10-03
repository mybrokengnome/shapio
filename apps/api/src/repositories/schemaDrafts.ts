import type { Kysely, Selectable, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB, SchemaDrafts } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * Mutable schema drafts of a change set (developer-face plan §5). The immutable `schema_revisions` row is
 * only written when the set ships.
 */
export type SchemaDraftRow = Selectable<SchemaDrafts>;

export type SchemaDraftWrite = {
  changeSetId: string;
  definitionId: string;
  kind: string;
  apiKey: string;
  baseVersion: number | null;
  /** Null: the draft deletes the definition. */
  definition: unknown;
  updatedByType: string;
  updatedById: string | null;
};

const definitionJson = (definition: unknown) => (definition === null ? null : JSON.stringify(definition));

export const findForSet = (changeSetId: string, definitionId: string, executor: Executor = db) =>
  executor
    .selectFrom('schema_drafts')
    .selectAll()
    .where('change_set_id', '=', changeSetId)
    .where('definition_id', '=', definitionId)
    .executeTakeFirst();

export const findById = (id: string, executor: Executor = db) =>
  executor.selectFrom('schema_drafts').selectAll().where('id', '=', id).executeTakeFirst();

export const listForSet = (changeSetId: string, executor: Executor = db) =>
  executor.selectFrom('schema_drafts').selectAll().where('change_set_id', '=', changeSetId).execute();

export const insert = (draft: SchemaDraftWrite, trx: Executor = db) =>
  trx
    .insertInto('schema_drafts')
    .values({
      change_set_id: draft.changeSetId,
      definition_id: draft.definitionId,
      kind: draft.kind,
      api_key: draft.apiKey,
      base_version: draft.baseVersion,
      definition: definitionJson(draft.definition),
      updated_by_type: draft.updatedByType,
      updated_by_id: draft.updatedById,
    })
    .onConflict((oc) => oc.columns(['change_set_id', 'definition_id']).doNothing())
    .returningAll()
    .executeTakeFirst();

/** Replaces the draft if it is still at `expectedVersion`; undefined when it moved. */
export const update = (
  id: string,
  draft: SchemaDraftWrite,
  expectedVersion: number,
  now: Date,
  trx: Executor = db,
) =>
  trx
    .updateTable('schema_drafts')
    .set((eb) => ({
      kind: draft.kind,
      api_key: draft.apiKey,
      base_version: draft.baseVersion,
      definition: definitionJson(draft.definition),
      updated_by_type: draft.updatedByType,
      updated_by_id: draft.updatedById,
      version: eb('version', '+', eb.lit(1)),
      updated_at: now,
    }))
    .where('id', '=', id)
    .where('version', '=', expectedVersion)
    .returningAll()
    .executeTakeFirst();

export const deleteById = (id: string, trx: Executor = db) =>
  trx.deleteFrom('schema_drafts').where('id', '=', id).executeTakeFirst();

export const deleteForSet = (changeSetId: string, trx: Executor = db) =>
  trx.deleteFrom('schema_drafts').where('change_set_id', '=', changeSetId).execute();

/** Other active sets with a draft of these definitions ("also changed in"). */
export const findOtherActiveSets = (
  definitionIds: readonly string[],
  changeSetId: string,
  executor: Executor = db,
) =>
  definitionIds.length === 0
    ? Promise.resolve([])
    : executor
        .selectFrom('schema_drafts as d')
        .innerJoin('change_sets as s', 's.id', 'd.change_set_id')
        .select(['d.definition_id', 's.id', 's.title'])
        .where('d.definition_id', 'in', definitionIds)
        .where('d.change_set_id', '<>', changeSetId)
        .where('s.status', 'in', ['open', 'scheduled', 'shipping', 'failed'])
        .execute();
