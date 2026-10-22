import { categoryOfKind, hashDefinition, type SchemaDefinition } from '@shapio/schema';
import type { Transaction } from 'kysely';
import type { Database } from '../../db/index.js';
import type { DB } from '../../db/types.js';
import type { Principal } from '../../permissions/types.js';
import * as schemaChangeJobsRepository from '../../repositories/schemaChangeJobs.js';
import type { SchemaChangeJobRow } from '../../repositories/schemaChangeJobs.js';
import * as schemaModelsRepository from '../../repositories/schemaModels.js';
import { recordAudit } from '../../services/audit.js';
import { verifyChangesUnderLock } from './activate.js';
import { actorColumns } from './actor.js';
import { lockSchema } from './locks.js';
import { scopeOfPlan, type ChangePlan } from './plan.js';
import { enqueueSchemaChange } from './prerequisites.js';

export type ChangeRequest = {
  plan: ChangePlan;
  after: SchemaDefinition;
  expectedVersion: number | null;
  actor: Principal;
  requestId?: string;
  ip?: string;
};

/**
 * Writes a planned change inside the caller's transaction (which holds the schema lock and has verified the
 * version guards): the new revision (inactive; null `after` writes none, a deletion) and the schema change
 * row. A change set links its changes with `changeSetId` and runs them in its own job.
 */
export const insertPendingChange = async (
  trx: Transaction<DB>,
  request: Omit<ChangeRequest, 'after'> & { after: SchemaDefinition | null; changeSetId?: string },
  parentRevisionId: string | null,
): Promise<SchemaChangeJobRow> => {
  const { plan, after, actor } = request;
  const by = actorColumns(actor);
  let revisionId: string | null = null;
  if (after) {
    if (!(await schemaModelsRepository.findModelById(after.id, trx))) {
      await schemaModelsRepository.insertModel(
        { id: after.id, kind: after.kind, apiKey: after.apiKey, siteId: scopeOfPlan(plan) },
        trx,
      );
    }
    const latest = await schemaModelsRepository.findLatestRevisionVersion(after.id, trx);
    const revision = await schemaModelsRepository.insertRevision(
      {
        modelId: after.id,
        version: latest + 1,
        definition: after,
        hash: await hashDefinition(after),
        parentRevisionId,
        createdByType: by.type,
        createdById: by.id,
      },
      trx,
    );
    revisionId = revision.id;
  }
  return schemaChangeJobsRepository.insert(
    {
      target: { type: 'model', id: plan.definitionId },
      modelId: plan.definitionId,
      fromRevisionId: parentRevisionId,
      toRevisionId: revisionId,
      plan,
      requestedByType: by.type,
      requestedById: by.id,
      changeSetId: request.changeSetId ?? null,
    },
    trx,
  );
};

/** A change of a group that activates together; null `after` deletes the definition. */
export type GroupedChangeRequest = Omit<ChangeRequest, 'after'> & { after: SchemaDefinition | null };

const recordRequest = async (
  trx: Transaction<DB>,
  request: GroupedChangeRequest,
  change: SchemaChangeJobRow,
) => {
  const { plan, actor } = request;
  const revision = change.to_revision_id
    ? await schemaModelsRepository.findRevisionById(change.to_revision_id, trx)
    : undefined;
  await recordAudit(trx, {
    actor,
    action: 'schema.change.request',
    target: { type: categoryOfKind(plan.kind), id: plan.definitionId },
    metadata: {
      changeId: change.id,
      fromVersion: request.expectedVersion,
      toVersion: revision?.version ?? null,
      prerequisites: plan.prerequisites.map((step) => step.kind),
    },
    ...(request.requestId ? { requestId: request.requestId } : {}),
    ...(request.ip ? { ip: request.ip } : {}),
  });
};

/**
 * Starts changes that need prerequisites (brief §5 step 6) and activate together: writes the new revisions
 * (inactive), the schema change rows and one job in one transaction, after validating the schema they form
 * together. The job runs every change's prerequisites, then activates them all at once, so none goes live
 * before the definitions it references (a parent, an interface, a relation target, a component). Until then
 * the current revisions stay active and serve every read and write.
 */
export const requestChanges = (
  db: Database,
  requests: readonly [GroupedChangeRequest, ...GroupedChangeRequest[]],
): Promise<SchemaChangeJobRow[]> =>
  db.transaction().execute(async (trx) => {
    await lockSchema(trx);
    const pointers = await verifyChangesUnderLock(
      trx,
      requests.map(({ plan, after, expectedVersion }) => ({ plan, after, expectedVersion })),
    );
    const changes: SchemaChangeJobRow[] = [];
    for (const request of requests) {
      changes.push(await insertPendingChange(trx, request, pointers.get(request.plan.definitionId) ?? null));
    }
    const changeIds = changes.map((change) => change.id) as [string, ...string[]];
    const { job } = await enqueueSchemaChange(trx, changeIds);
    for (const [index, change] of changes.entries()) {
      await schemaChangeJobsRepository.attachJob(change.id, job.id, trx);
      await recordRequest(trx, requests[index] as GroupedChangeRequest, change);
    }
    return changes.map((change) => ({ ...change, job_id: job.id }));
  });

/** Starts one change that needs prerequisites (see `requestChanges`). */
export const requestChange = async (db: Database, request: ChangeRequest): Promise<SchemaChangeJobRow> => {
  const [change] = await requestChanges(db, [request]);
  return change as SchemaChangeJobRow;
};
