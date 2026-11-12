import type { Kysely, Transaction } from 'kysely';
import { db } from '../db/index.js';
import type { DB } from '../db/types.js';

type Executor = Kysely<DB> | Transaction<DB>;

/**
 * The activations of one definition after a schema version, oldest first, with the revision each made live
 * (plan schema-lenses: what happened to stored values between an older client's version and now). A row with
 * no revision deleted the definition at that version. At most `limit` rows: callers ask for one more than
 * they walk, to know the history is longer.
 */
export const findStepsAfter = (
  modelId: string,
  afterVersion: number,
  upToVersion: number,
  limit: number,
  executor: Executor = db,
) =>
  executor
    .selectFrom('schema_activations as activation')
    .leftJoin('schema_revisions as revision', 'revision.id', 'activation.revision_id')
    .select([
      'activation.schema_version as schemaVersion',
      'activation.revision_id as revisionId',
      'revision.definition as definition',
    ])
    .where('activation.model_id', '=', modelId)
    .where('activation.schema_version', '>', afterVersion)
    .where('activation.schema_version', '<=', upToVersion)
    .orderBy('activation.schema_version')
    .limit(limit)
    .execute();

export type ActivationStepRow = Awaited<ReturnType<typeof findStepsAfter>>[number];
