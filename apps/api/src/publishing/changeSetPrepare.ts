import type { Transaction } from 'kysely';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import type { ChangeSetItemRow } from '../repositories/changeSetItems.js';
import type { ChangeSetRow } from '../repositories/changeSets.js';
import * as schemaDraftsRepository from '../repositories/schemaDrafts.js';
import { schemaInvalid, schemaVersionConflict } from '../schema/errors.js';
import { verifyChangesUnderLock, type ActivationItem } from '../schema/planner/activate.js';
import { lockSchema } from '../schema/planner/locks.js';
import type { ChangePlan } from '../schema/planner/plan.js';
import { insertPendingChange } from '../schema/planner/request.js';
import { draftScopeOf, planDrafts, type DraftPlan } from '../services/changeSetPlanning.js';
import type { ChangeSetServiceContext } from '../services/changeSets.js';
import { assertCanCreate, assertCanManage } from '../services/schemaAccess.js';
import { assertAcknowledged, assertWritable, type Acknowledgement } from '../services/schemaDefinitions.js';
import type { PublicationItem } from './publicationBatch.js';

/**
 * Before a change set ships (developer-face plan §5): everything that can be checked without changing
 * anything. Drafts are planned with the builder's planner against the schema they will form together; a
 * draft based on an older active version, an invalid proposal or a missing acknowledgement refuses the ship
 * (409/422) and leaves the set as it was.
 */
export type ShipPlan = {
  row: ChangeSetRow;
  entryItems: ChangeSetItemRow[];
  /** Drafts that change something (an update with no changes is skipped). */
  schema: Array<DraftPlan & { plan: ChangePlan; item: ChangeSetItemRow }>;
  /** Some schema item needs prerequisites (dry runs, index builds): the ship runs as a job. */
  needsJob: boolean;
};

export const changeSetEmpty = () =>
  new AppError(422, 'CHANGE_SET_EMPTY', 'Add at least one entry or schema change to the change set first');

const staleDraft = (plans: readonly DraftPlan[]) => {
  const stale = plans.find((planned) => planned.stale);
  if (!stale) {
    return undefined;
  }
  const error = schemaVersionConflict(stale.draft.base_version, stale.activeVersion);
  return new AppError(
    error.statusCode,
    error.code,
    `The draft of "${stale.draft.api_key}" is based on an older version`,
    {
      definitionId: stale.draft.definition_id,
      baseVersion: stale.draft.base_version,
      activeVersion: stale.activeVersion,
    },
  );
};

const authorizeDrafts = async (
  context: ChangeSetServiceContext,
  plans: readonly DraftPlan[],
  executor: Transaction<DB>,
) => {
  for (const planned of plans) {
    await (planned.activeVersion === null
      ? assertCanCreate(context, draftScopeOf(context, planned.draft), executor)
      : assertCanManage(context, planned.draft.definition_id, executor));
  }
};

/** Loads and checks a set's items for shipping, with the acknowledgements given (interactive or stored). */
/**
 * Shipping (and scheduling a ship) needs `changes.ship` on top of `changes.manage` (agentic plan §I): a role
 * can prepare change sets without making them live. Checked here so interactive, scheduled and job-run
 * ships all check it, with the actor that asked for the ship.
 */
const assertCanShip = async (context: ChangeSetServiceContext, executor: Transaction<DB>) => {
  if (!(await context.permissions.canPerform(context.actor, 'changes.ship', executor))) {
    throw new AppError(403, 'FORBIDDEN', 'Your role does not allow changes.ship');
  }
};

export const planShip = async (
  context: ChangeSetServiceContext,
  row: ChangeSetRow,
  ack: Acknowledgement,
  executor: Transaction<DB>,
): Promise<ShipPlan> => {
  await assertCanShip(context, executor);
  const items = await changeSetItemsRepository.listForSet(row.id, executor);
  const entryItems = items.filter((item) => item.kind === 'entry');
  const drafts = await schemaDraftsRepository.listForSet(row.id, executor);
  if (entryItems.length === 0 && drafts.length === 0) {
    throw changeSetEmpty();
  }
  if (drafts.length === 0) {
    return { row, entryItems, schema: [], needsJob: false };
  }
  // The checks and plans below read through the ship's transaction, never a second pooled connection.
  const inTransaction: ChangeSetServiceContext = { ...context, db: executor };
  await assertWritable(inTransaction);
  const plans = await planDrafts(inTransaction, drafts);
  await authorizeDrafts(context, plans, executor);
  const stale = staleDraft(plans);
  if (stale) {
    throw stale;
  }
  const invalid = plans.flatMap((planned) => planned.issues);
  if (invalid.length > 0) {
    throw schemaInvalid(invalid);
  }
  const changing = plans.flatMap((planned) => {
    const item = items.find((candidate) => candidate.schema_draft_id === planned.draft.id);
    const plan = planned.plan;
    if (!item || !plan || (plan.operation === 'update' && plan.changes.length === 0)) {
      return [];
    }
    return [{ ...planned, plan, item }];
  });
  assertAcknowledged(
    changing.map((planned) => planned.plan),
    ack,
  );
  if (entryItems.length === 0 && changing.length === 0) {
    throw changeSetEmpty();
  }
  return {
    row,
    entryItems,
    schema: changing,
    needsJob: changing.some((planned) => planned.after !== null && planned.plan.prerequisites.length > 0),
  };
};

/**
 * Writes the pending revisions and schema change rows of a set that ships through a job, under the schema
 * lock and the version guards (the in-flight index then blocks other changes to those definitions until
 * the set ships or fails).
 */
export const writePendingChanges = async (
  context: ChangeSetServiceContext,
  trx: Transaction<DB>,
  ship: ShipPlan,
): Promise<void> => {
  await lockSchema(trx);
  const pointers = await verifyChangesUnderLock(
    trx,
    ship.schema.map((planned) => ({
      plan: planned.plan,
      after: planned.after,
      expectedVersion: planned.activeVersion,
    })),
  );
  for (const planned of ship.schema) {
    await insertPendingChange(
      trx,
      {
        plan: planned.plan,
        after: planned.after,
        expectedVersion: planned.activeVersion,
        actor: context.actor,
        changeSetId: ship.row.id,
      },
      pointers.get(planned.plan.definitionId) ?? null,
    );
  }
};

/** Entry items as publication items; strict ships check each listed item's draft version. */
export const publicationItemsOf = (
  entryItems: readonly ChangeSetItemRow[],
  expectedDraftVersions: ReadonlyMap<string, number>,
): PublicationItem[] =>
  entryItems.map((item) => {
    const expected = expectedDraftVersions.get(item.id);
    return {
      ref: item.id,
      entryId: item.entry_id ?? '',
      modelId: item.model_id ?? '',
      locale: item.locale ?? '',
      action: item.action as 'publish' | 'unpublish',
      sourceRevisionId: item.source_revision_id,
      ...(expected !== undefined ? { expectedDraftVersion: expected } : {}),
    };
  });

/** Draft versions a strict ship stored on its items (for the job that finishes it). */
export const storedDraftVersions = (entryItems: readonly ChangeSetItemRow[]): Map<string, number> =>
  new Map(
    entryItems.flatMap((item) => {
      const state = item.ship_state as { expectedDraftVersion?: unknown } | null;
      return typeof state?.expectedDraftVersion === 'number' ? [[item.id, state.expectedDraftVersion]] : [];
    }),
  );

/** Activation items of a set that ships without prerequisites (revisions are written at activation). */
export const activationItemsOf = (ship: ShipPlan): ActivationItem[] =>
  ship.schema.map((planned) => ({
    plan: planned.plan,
    after: planned.after,
    expectedVersion: planned.activeVersion,
  }));

/**
 * Strict ships: refuses (409 CHANGE_SET_STALE) when an entry item's draft moved since the review the client
 * shipped from. Checked before a ship with prerequisites answers 202, and again in the final transaction.
 */
export const assertReviewedDraftVersions = async (
  trx: Transaction<DB>,
  entryItems: readonly ChangeSetItemRow[],
  expected: ReadonlyMap<string, number>,
) => {
  const listed = entryItems.filter((item) => expected.has(item.id));
  const heads = await changeSetItemsRepository.findHeadsForEntries(
    listed.flatMap((item) => (item.entry_id ? [item.entry_id] : [])),
    trx,
  );
  for (const item of listed) {
    const draft = heads.find(
      (head) => head.entry_id === item.entry_id && head.locale === item.locale && head.state === 'draft',
    );
    const version = expected.get(item.id);
    if (draft?.version !== version) {
      throw new AppError(
        409,
        'CHANGE_SET_STALE',
        `The draft of entry ${item.entry_id ?? ''} (${item.locale ?? ''}) changed since the review`,
        {
          itemId: item.id,
          entryId: item.entry_id,
          locale: item.locale,
          expectedDraftVersion: version,
          currentDraftVersion: draft?.version ?? null,
        },
      );
    }
  }
};
