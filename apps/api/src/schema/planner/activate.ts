import {
  findReferencingDefinitions,
  hashDefinition,
  validateSchema,
  type SchemaDefinition,
  type ValidationIssue,
} from '@shapio/schema';
import type { Transaction } from 'kysely';
import { PRIMARY_SITE_ID } from '../../constants/sites.js';
import type { Database } from '../../db/index.js';
import type { DB } from '../../db/types.js';
import { writeOutboxEvent } from '../../jobs/outbox.js';
import type { Principal } from '../../permissions/types.js';
import { createSeqAllocator } from '../../repositories/publications.js';
import * as schemaChangeJobsRepository from '../../repositories/schemaChangeJobs.js';
import * as schemaModelsRepository from '../../repositories/schemaModels.js';
import * as schemaVersionsRepository from '../../repositories/schemaVersions.js';
import { recordAudit } from '../../services/audit.js';
import { apiKeyTaken, schemaChangeInProgress, schemaInvalid, schemaVersionConflict } from '../errors.js';
import { publishSchemaChanged } from '../notify.js';
import { readStoredDefinition } from '../storedDefinition.js';
import { actorColumns } from './actor.js';
import type { ActivationContext } from './contentPorts.js';
import { lockForActivation } from './locks.js';
import type { ChangePlan } from './plan.js';
import { enqueueFollowUps } from './prerequisites.js';

export type ActivationItem = {
  plan: ChangePlan;
  /** The proposed definition; null deletes it. */
  after: SchemaDefinition | null;
  /** Active per-model version the caller saw (null: the definition must not be active). */
  expectedVersion: number | null;
  /** Activating a change whose revision was written when it was requested (prerequisite path). */
  pending?: { changeJobId: string; revisionId: string | null; version: number | null };
  /**
   * The watermark re-check and the content rewrite (ADR 0002 pipeline); runs under the exclusive locks
   * before the pointer flips and throws to abort the activation.
   */
  recheck?: (trx: Transaction<DB>, activation: ActivationContext) => Promise<void>;
};

/** Runs inside the activation transaction after the pointers flipped (a change set publishes its entries). */
export type AfterFlip = (
  trx: Transaction<DB>,
  flipped: { schemaVersion: number; results: readonly ActivationResult[]; activation: ActivationContext },
) => Promise<void>;

export type ActivationRequest = {
  items: readonly ActivationItem[];
  actor: Principal;
  requestId?: string;
  ip?: string;
  now?: Date;
  /** The change set shipping this activation (publication ledger, audit). */
  changeSetId?: string;
  /**
   * The site whose publication sequence the activation's number comes from: the change set's site. Without
   * one, the primary site. Allocating one number per affected site belongs to the content engine package
   * (sites plan §H, G2); until then conversions on other sites are numbered on this site.
   */
  siteId?: string;
  afterFlip?: AfterFlip;
};

export type ActivationResult = {
  definitionId: string;
  /** New per-model version; null after a delete. */
  version: number | null;
  revisionId: string | null;
  schemaVersion: number;
};

const isUniqueViolation = (error: unknown) =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

const referenceIssues = (
  active: readonly SchemaDefinition[],
  deletedIds: ReadonlySet<string>,
): ValidationIssue[] =>
  [...deletedIds].flatMap((id) =>
    findReferencingDefinitions(active, id)
      .filter((referrer) => !deletedIds.has(referrer.id))
      .map((referrer) => ({
        path: '',
        code: 'REFERENCED_DEFINITION' as const,
        message: `"${referrer.apiKey}" still references a definition being deleted`,
        definitionId: referrer.id,
      })),
  );

/** Checks made under the locks: the version guards, one change at a time, and the whole schema still valid. */
export const verifyChangesUnderLock = async (trx: Transaction<DB>, items: readonly ActivationItem[]) => {
  const pointers = new Map<string, string | null>();
  for (const { plan, expectedVersion, pending } of items) {
    const pointer = await schemaModelsRepository.findActivePointer(plan.definitionId, trx);
    const currentVersion = pointer?.version ?? null;
    if (currentVersion !== expectedVersion) {
      throw schemaVersionConflict(expectedVersion, currentVersion);
    }
    const inFlight = await schemaChangeJobsRepository.findInFlight(
      { type: 'model', id: plan.definitionId },
      trx,
    );
    if (inFlight && inFlight.id !== pending?.changeJobId) {
      throw schemaChangeInProgress(inFlight.id);
    }
    pointers.set(plan.definitionId, pointer?.revision_id ?? null);
  }
  const active = (await schemaModelsRepository.findActiveDefinitions(trx)).map((row) =>
    readStoredDefinition(row.definition),
  );
  const touched = new Set(items.map((item) => item.plan.definitionId));
  const deleted = new Set(items.filter((item) => !item.after).map((item) => item.plan.definitionId));
  const proposed = [
    ...active.filter((definition) => !touched.has(definition.id)),
    ...items.flatMap((item) => (item.after ? [item.after] : [])),
  ];
  const issues = [...validateSchema(proposed), ...referenceIssues(proposed, deleted)];
  if (issues.length > 0) {
    throw schemaInvalid(issues);
  }
  return pointers;
};

const writeRevisionAndPointer = async (
  trx: Transaction<DB>,
  item: ActivationItem & { after: SchemaDefinition },
  context: { actor: Principal; parentRevisionId: string | null; schemaVersion: number; now: Date },
) => {
  const { after, pending } = item;
  let revision =
    pending?.revisionId && pending.version !== null
      ? { id: pending.revisionId, version: pending.version }
      : undefined;
  if (!revision) {
    const existing = await schemaModelsRepository.findModelById(after.id, trx);
    if (!existing) {
      await schemaModelsRepository.insertModel({ id: after.id, kind: after.kind, apiKey: after.apiKey }, trx);
    }
    const latest = await schemaModelsRepository.findLatestRevisionVersion(after.id, trx);
    const by = actorColumns(context.actor);
    revision = await schemaModelsRepository.insertRevision(
      {
        modelId: after.id,
        version: latest + 1,
        definition: after,
        hash: await hashDefinition(after),
        parentRevisionId: context.parentRevisionId,
        createdByType: by.type,
        createdById: by.id,
      },
      trx,
    );
  }
  const { now, schemaVersion } = context;
  await schemaModelsRepository.markModelActive(
    { id: after.id, kind: after.kind, apiKey: after.apiKey, now },
    trx,
  );
  await schemaModelsRepository.upsertActivePointer(
    { modelId: after.id, revisionId: revision.id, version: revision.version, schemaVersion, now },
    trx,
  );
  return revision;
};

const recordActivation = async (
  trx: Transaction<DB>,
  item: ActivationItem,
  result: ActivationResult,
  request: ActivationRequest,
) => {
  const { plan, after } = item;
  const isComponent = plan.kind === 'component';
  const metadata = {
    operation: plan.operation,
    apiKey: plan.apiKey,
    fromVersion: item.expectedVersion,
    toVersion: result.version,
    schemaVersion: result.schemaVersion,
    changeJobId: item.pending?.changeJobId ?? null,
    changeSetId: request.changeSetId ?? null,
    breaking: plan.summary.breaking,
    destructive: plan.summary.destructive,
    categories: [...new Set(plan.changes.map((change) => change.category))],
  };
  await recordAudit(trx, {
    actor: request.actor,
    action: after ? 'schema.activate' : 'schema.delete',
    target: { type: isComponent ? 'component' : 'model', id: plan.definitionId },
    metadata,
    ...(request.requestId ? { requestId: request.requestId } : {}),
    ...(request.ip ? { ip: request.ip } : {}),
  });
  await writeOutboxEvent(trx, {
    type: after ? 'schema.activated' : 'schema.deleted',
    aggregateType: isComponent ? 'component' : 'model',
    aggregateId: plan.definitionId,
    payload: metadata,
  });
  await enqueueFollowUps(trx, plan, `${plan.definitionId}:${result.schemaVersion}`);
};

/**
 * Activates (or deletes) one or more definitions atomically (brief §5 step 7). Under the global schema
 * lock and the exclusive locks of every affected model it re-checks each version guard, re-validates the
 * whole resulting schema, runs the watermark re-checks, flips the active pointers, bumps the global schema
 * version once, runs `afterFlip` (a change set's publications), takes the activation's one publication
 * sequence number, and writes audit rows, outbox events, follow-up jobs and the change notification, all in
 * one transaction. If anything fails, everything rolls back and the previous revisions stay active.
 */
export const activateDefinitions = async (
  db: Database,
  request: ActivationRequest,
): Promise<ActivationResult[]> => {
  const now = request.now ?? new Date();
  const { items } = request;
  try {
    return await db.transaction().execute(async (trx) => {
      await lockForActivation(
        trx,
        items.flatMap((item) => [item.plan.definitionId, ...item.plan.affectedModelIds]),
      );
      const pointers = await verifyChangesUnderLock(trx, items);
      const { activation, finish } = createActivationContext(trx, request);
      for (const item of items) {
        await item.recheck?.(trx, activation);
      }
      const schemaVersion = await schemaVersionsRepository.bumpSchemaVersion(trx, now);
      const results: ActivationResult[] = [];
      for (const item of items) {
        results.push(await flipItem(trx, item, { request, pointers, schemaVersion, now }));
      }
      await request.afterFlip?.(trx, { schemaVersion, results, activation });
      await finish();
      await publishSchemaChanged(trx, schemaVersion);
      return results;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw apiKeyTaken(items.map((item) => item.plan.apiKey).join(', '));
    }
    throw error;
  }
};

/**
 * An activation that changes live content (converted published heads roll their log rows) or ships a change
 * set is a publication snapshot (ledger row `schema` or `change_set`, with the schema version it activated).
 * The number is taken on first use (a change set's publications, an entry-level conversion) or at the end,
 * and deferred work then runs with it. A metadata-only activation (a label rename) takes no number: live
 * content and every API response stay exactly as they were (brief §10).
 */
const createActivationContext = (trx: Transaction<DB>, request: ActivationRequest) => {
  const deferred: Array<(seq: number) => Promise<void>> = [];
  const activation: ActivationContext = {
    seq: createSeqAllocator(trx, request.siteId ?? PRIMARY_SITE_ID, {
      source: request.changeSetId ? 'change_set' : 'schema',
      changeSetId: request.changeSetId ?? null,
      actor: actorColumns(request.actor),
    }),
    atSeq: (work) => {
      deferred.push(work);
    },
  };
  const finish = async () => {
    if (deferred.length === 0 && !request.changeSetId && activation.seq.taken() === undefined) {
      return;
    }
    const seq = await activation.seq.next();
    for (const work of deferred) {
      await work(seq);
    }
  };
  return { activation, finish };
};

const flipItem = async (
  trx: Transaction<DB>,
  item: ActivationItem,
  context: {
    request: ActivationRequest;
    pointers: ReadonlyMap<string, string | null>;
    schemaVersion: number;
    now: Date;
  },
): Promise<ActivationResult> => {
  const { request, pointers, schemaVersion, now } = context;
  const { plan, after } = item;
  let revision: { id: string; version: number } | undefined;
  if (after) {
    const parentRevisionId = pointers.get(plan.definitionId) ?? null;
    revision = await writeRevisionAndPointer(
      trx,
      { ...item, after },
      { actor: request.actor, parentRevisionId, schemaVersion, now },
    );
  } else {
    await schemaModelsRepository.softDeleteModel(plan.definitionId, now, trx);
    await schemaModelsRepository.deleteActivePointer(plan.definitionId, trx);
  }
  if (item.pending) {
    await schemaChangeJobsRepository.finish(item.pending.changeJobId, { status: 'activated', now }, trx);
  }
  const result = {
    definitionId: plan.definitionId,
    version: revision?.version ?? null,
    revisionId: revision?.id ?? null,
    schemaVersion,
  };
  await recordActivation(trx, item, result, request);
  return result;
};

export const activateDefinition = async (
  db: Database,
  item: ActivationItem,
  request: Omit<ActivationRequest, 'items'>,
): Promise<ActivationResult> => {
  const [result] = await activateDefinitions(db, { ...request, items: [item] });
  return result as ActivationResult;
};
