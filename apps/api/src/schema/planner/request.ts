import { hashDefinition, type SchemaDefinition } from '@shapio/schema';
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

/**
 * Starts a change that needs prerequisites (brief §5 step 6): writes the new revision (inactive), the
 * schema change row and its job in one transaction. The job runs the prerequisites and activates; until
 * then the current revision stays active and serves every read and write.
 */
export const requestChange = (db: Database, request: ChangeRequest): Promise<SchemaChangeJobRow> =>
  db.transaction().execute(async (trx) => {
    const { plan, after, actor } = request;
    await lockSchema(trx);
    const pointers = await verifyChangesUnderLock(trx, [
      { plan, after, expectedVersion: request.expectedVersion },
    ]);
    const change = await insertPendingChange(trx, request, pointers.get(after.id) ?? null);
    const revision = change.to_revision_id
      ? await schemaModelsRepository.findRevisionById(change.to_revision_id, trx)
      : undefined;
    const { job } = await enqueueSchemaChange(trx, change.id);
    await schemaChangeJobsRepository.attachJob(change.id, job.id, trx);
    await recordAudit(trx, {
      actor,
      action: 'schema.change.request',
      target: { type: plan.kind === 'component' ? 'component' : 'model', id: after.id },
      metadata: {
        changeId: change.id,
        fromVersion: request.expectedVersion,
        toVersion: revision?.version ?? null,
        prerequisites: plan.prerequisites.map((step) => step.kind),
      },
      ...(request.requestId ? { requestId: request.requestId } : {}),
      ...(request.ip ? { ip: request.ip } : {}),
    });
    return { ...change, job_id: job.id };
  });
