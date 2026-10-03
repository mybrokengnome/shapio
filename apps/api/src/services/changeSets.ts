import type { Transaction } from 'kysely';
import { CHANGE_SET_EVENTS } from '../constants/publishing.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import { adminIdOf, tokenIdOf } from '../publishing/principals.js';
import { resolvePublicationTarget, type PublicationTargetInput } from '../publishing/targets.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import type { ChangeSetStatus } from '../repositories/changeSets.js';
import * as deploymentConnectionsRepository from '../repositories/deploymentConnections.js';
import * as schemaDraftsRepository from '../repositories/schemaDrafts.js';
import type { SchemaContentPorts } from '../schema/planner/contentPorts.js';
import { recordAudit } from './audit.js';
import {
  actorNamesFor,
  changeSetLocked,
  changeSetNotFound,
  changeSetVersionConflict,
  EDITABLE_STATUSES,
  loadChangeSetView,
  toSummary,
  type ChangeSetSummaryView,
  type ChangeSetView,
} from './changeSetViews.js';
import type { ContentServiceContext } from './contentAccess.js';

/**
 * Change sets (developer-face plan §5): create, edit, add and remove entry items, discard, list. Schema drafts
 * are in changeSetDrafts.ts, review in changeSetReview.ts, shipping in publishing/changeSetShip.ts.
 * Routes guard with `changes.manage`; entry items need update permission on their model when added and
 * publish permission when the set ships, shipping needs `changes.ship`, schema drafts need schema permission.
 */
export type ChangeSetServiceContext = ContentServiceContext & { ports: SchemaContentPorts };

const DEFAULT_STATUSES: readonly ChangeSetStatus[] = ['open', 'scheduled', 'shipping', 'shipped', 'failed'];
const ALL_STATUSES: ReadonlySet<string> = new Set([...DEFAULT_STATUSES, 'discarded']);

export const auditFields = (context: ContentServiceContext) => ({
  actor: context.actor,
  ...(context.requestId ? { requestId: context.requestId } : {}),
  ...(context.ip ? { ip: context.ip } : {}),
});

/** Records a change-set audit row (the set's timeline is read from these). */
export const auditChangeSet = (
  trx: Transaction<DB>,
  context: ContentServiceContext,
  id: string,
  action: string,
  metadata: Record<string, unknown> = {},
  outcome: 'success' | 'failure' = 'success',
) =>
  recordAudit(trx, {
    ...auditFields(context),
    action,
    target: { type: 'change_set', id },
    metadata,
    outcome,
  });

/** Locks the set and checks its items can still change. */
export const lockEditable = async (trx: Transaction<DB>, id: string) => {
  const row = await changeSetsRepository.lockById(id, trx);
  if (!row) {
    throw changeSetNotFound(id);
  }
  if (!EDITABLE_STATUSES.has(row.status)) {
    throw changeSetLocked(row.status);
  }
  return row;
};

/** Bumps the set's version (any item or draft change counts as a change to the set). */
export const touchChangeSet = (trx: Transaction<DB>, id: string) =>
  changeSetsRepository.update(id, {}, new Date(), trx);

export const getChangeSet = (context: ContentServiceContext, id: string): Promise<ChangeSetView> =>
  loadChangeSetView(context.db, context.snapshot, id);

const parseStatuses = (raw: string | undefined): ChangeSetStatus[] => {
  if (!raw) {
    return [...DEFAULT_STATUSES];
  }
  const statuses = raw.split(',').filter((value) => value !== '');
  const unknown = statuses.find((status) => !ALL_STATUSES.has(status));
  if (unknown) {
    throw new AppError(400, 'INVALID_STATUS', `Unknown change set status "${unknown}"`);
  }
  return statuses as ChangeSetStatus[];
};

type ListCursor = { createdAt: string; id: string };

const decodeCursor = (cursor: string | undefined): { createdAt: Date; id: string } | undefined => {
  if (!cursor) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as ListCursor;
    return { createdAt: new Date(parsed.createdAt), id: parsed.id };
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'The cursor is not valid');
  }
};

const encodeCursor = (row: { created_at: Date; id: string }) =>
  Buffer.from(JSON.stringify({ createdAt: row.created_at.toISOString(), id: row.id })).toString('base64url');

export const listChangeSets = async (
  context: ContentServiceContext,
  query: { status?: string | undefined; cursor?: string | undefined; limit?: number | undefined },
): Promise<{ items: ChangeSetSummaryView[]; nextCursor: string | null }> => {
  const limit = query.limit ?? 50;
  const after = decodeCursor(query.cursor);
  const rows = await changeSetsRepository.list(
    { statuses: parseStatuses(query.status), limit: limit + 1, ...(after ? { after } : {}) },
    context.db,
  );
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const names = await actorNamesFor(context.db, page);
  return {
    items: page.map((row) =>
      toSummary(row, { entries: Number(row.entry_items ?? 0), schema: Number(row.schema_items ?? 0) }, names),
    ),
    nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
  };
};

export const createChangeSet = async (
  context: ContentServiceContext,
  input: { title: string; description?: string | undefined; source?: 'manual' | 'builder' | undefined },
): Promise<ChangeSetView> => {
  const row = await context.db.transaction().execute(async (trx) => {
    const inserted = await changeSetsRepository.insert(
      {
        site_id: context.site.id,
        title: input.title.trim(),
        description: input.description ?? '',
        source: input.source ?? 'manual',
        created_by: adminIdOf(context.actor),
        created_by_token: tokenIdOf(context.actor),
      },
      trx,
    );
    await auditChangeSet(trx, context, inserted.id, 'change_set.create', { title: inserted.title });
    return inserted;
  });
  return getChangeSet(context, row.id);
};

const assertConnection = async (context: ContentServiceContext, connectionId: string | null | undefined) => {
  if (connectionId && !(await deploymentConnectionsRepository.findById(connectionId, context.db))) {
    throw new AppError(404, 'DEPLOYMENT_CONNECTION_NOT_FOUND', `No deployment connection ${connectionId}`);
  }
};

export const updateChangeSet = async (
  context: ContentServiceContext,
  id: string,
  input: {
    title?: string | undefined;
    description?: string | undefined;
    deploymentConnectionId?: string | null | undefined;
    expectedVersion: number;
  },
): Promise<ChangeSetView> => {
  await assertConnection(context, input.deploymentConnectionId);
  await context.db.transaction().execute(async (trx) => {
    const current = await lockEditable(trx, id);
    const updated = await changeSetsRepository.update(
      id,
      {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.deploymentConnectionId !== undefined
          ? { deployment_connection_id: input.deploymentConnectionId }
          : {}),
      },
      new Date(),
      trx,
      input.expectedVersion,
    );
    if (!updated) {
      throw changeSetVersionConflict(input.expectedVersion, current.version);
    }
    await auditChangeSet(trx, context, id, 'change_set.update', {
      title: updated.title,
      deploymentConnectionId: updated.deployment_connection_id,
    });
  });
  return getChangeSet(context, id);
};

/** Keeps the set as history and deletes its drafts; a scheduled set's job finds it discarded and stops. */
export const discardChangeSet = async (
  context: ContentServiceContext,
  id: string,
): Promise<ChangeSetView> => {
  await context.db.transaction().execute(async (trx) => {
    const row = await lockEditable(trx, id);
    await changeSetsRepository.update(
      id,
      { status: 'discarded', schedule_job_id: null, scheduled_for: null },
      new Date(),
      trx,
    );
    await schemaDraftsRepository.deleteForSet(id, trx);
    await writeOutboxEvent(trx, {
      type: CHANGE_SET_EVENTS.discarded,
      aggregateType: 'change_set',
      aggregateId: id,
      payload: { changeSetId: id, title: row.title },
    });
    await auditChangeSet(trx, context, id, 'change_set.discard', { title: row.title });
  });
  return getChangeSet(context, id);
};

/**
 * Adds an (entry, locale) publication. Proposing needs `update` on the model; the ship checks `publish`
 * (and `changes.ship`) for whoever ships it.
 */
export const addEntryItem = async (
  context: ContentServiceContext,
  id: string,
  input: PublicationTargetInput,
): Promise<ChangeSetView> => {
  const target = await resolvePublicationTarget(context, input, 'update');
  await context.db.transaction().execute(async (trx) => {
    await lockEditable(trx, id);
    const inserted = await changeSetItemsRepository.insertEntryItem(
      {
        changeSetId: id,
        entryId: target.entryId,
        modelId: target.model.definition.id,
        locale: target.locale,
        action: target.action,
      },
      trx,
    );
    if (!inserted) {
      throw new AppError(
        409,
        'CHANGE_SET_ITEM_EXISTS',
        'This entry and locale are already in the change set',
        {
          entryId: target.entryId,
          locale: target.locale,
        },
      );
    }
    await changeSetItemsRepository.recordReviewedDraftVersions(id, trx, inserted.id);
    await touchChangeSet(trx, id);
    await auditChangeSet(trx, context, id, 'change_set.item_add', {
      itemId: inserted.id,
      entryId: target.entryId,
      modelKey: target.model.definition.apiKey,
      locale: target.locale,
      action: target.action,
    });
  });
  return getChangeSet(context, id);
};

/** Removes an item; a schema item takes its draft with it. */
export const removeItem = async (
  context: ContentServiceContext,
  id: string,
  itemId: string,
): Promise<ChangeSetView> => {
  await context.db.transaction().execute(async (trx) => {
    await lockEditable(trx, id);
    const removed = await changeSetItemsRepository.deleteItem(id, itemId, trx);
    if (!removed) {
      throw new AppError(404, 'CHANGE_SET_ITEM_NOT_FOUND', `No item ${itemId} in this change set`);
    }
    if (removed.schema_draft_id) {
      await schemaDraftsRepository.deleteById(removed.schema_draft_id, trx);
    }
    await touchChangeSet(trx, id);
    await auditChangeSet(trx, context, id, 'change_set.item_remove', {
      itemId,
      kind: removed.kind,
      entryId: removed.entry_id,
      locale: removed.locale,
    });
  });
  return getChangeSet(context, id);
};
