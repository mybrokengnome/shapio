import type { Kysely, Transaction } from 'kysely';
import type { HeadState } from '../content/model.js';
import type { RelationEdge } from '../content/relations.js';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/** Replaces one head's edges (derived from its JSON, ADR 0001). Deleting a head cascades its edges. */
export const replaceForHead = async (
  head: { entryId: string; locale: string; state: HeadState },
  edges: readonly RelationEdge[],
  trx: Executor = db,
) => {
  await trx
    .deleteFrom('relation_edges')
    .where('source_entry_id', '=', head.entryId)
    .where('locale', '=', head.locale)
    .where('state', '=', head.state)
    .execute();
  if (edges.length === 0) {
    return;
  }
  await trx
    .insertInto('relation_edges')
    .values(
      edges.map((edge) => ({
        source_entry_id: head.entryId,
        locale: head.locale,
        state: head.state,
        field_id: edge.fieldId,
        position: edge.position,
        target_entry_id: edge.targetEntryId,
      })),
    )
    .execute();
};

/** Other entries whose heads point at this entry ("used in", delete protection). */
export const findReferrers = (targetEntryId: string, limit: number, executor: Executor = db) =>
  executor
    .selectFrom('relation_edges')
    .innerJoin('entries', 'entries.id', 'relation_edges.source_entry_id')
    .select([
      'relation_edges.source_entry_id',
      'entries.model_id',
      'relation_edges.locale',
      'relation_edges.state',
    ])
    .distinct()
    .where('relation_edges.target_entry_id', '=', targetEntryId)
    .where('relation_edges.source_entry_id', '!=', targetEntryId)
    .where('entries.deleted_at', 'is', null)
    .limit(limit)
    .execute();

/** One head's outgoing edges (content health: links to deleted or unpublished entries). */
export const listForEntryState = (entryId: string, state: HeadState, executor: Executor = db) =>
  executor
    .selectFrom('relation_edges')
    .select(['locale', 'field_id', 'position', 'target_entry_id'])
    .where('source_entry_id', '=', entryId)
    .where('state', '=', state)
    .orderBy('locale')
    .orderBy('field_id')
    .orderBy('position')
    .execute();
