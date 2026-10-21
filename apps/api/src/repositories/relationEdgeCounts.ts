import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

export type RelationValueQuery = {
  /** Relation fields (stable IDs, top level or inside components) whose values are counted. */
  fieldIds: readonly string[];
  /** The models whose entries the values point at. */
  targetModelIds: readonly string[];
};

/**
 * Live entries holding a relation value, in any locale or state, on one of these fields that points at a live
 * entry of one of these models (plan interfaces, Q1: a model leaving a relation's targets). A value pointing at
 * a deleted entry is already unresolvable and is not counted.
 */
export const countReferringEntries = async (
  { fieldIds, targetModelIds }: RelationValueQuery,
  executor: Executor = db,
): Promise<number> => {
  if (fieldIds.length === 0 || targetModelIds.length === 0) {
    return 0;
  }
  const row = await executor
    .selectFrom('relation_edges')
    .innerJoin('entries as target', 'target.id', 'relation_edges.target_entry_id')
    .innerJoin('entries as source', 'source.id', 'relation_edges.source_entry_id')
    .select(({ fn }) => fn.count<string>('relation_edges.source_entry_id').distinct().as('count'))
    .where('relation_edges.field_id', 'in', fieldIds)
    .where('target.model_id', 'in', targetModelIds)
    .where('target.deleted_at', 'is', null)
    .where('source.deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
  return Number(row.count);
};
