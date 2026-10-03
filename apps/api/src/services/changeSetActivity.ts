import type { TimelineEvent } from '../deployments/status.js';
import { AppError } from '../helpers/appError.js';
import * as auditLogRepository from '../repositories/auditLog.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import * as deploymentRunsRepository from '../repositories/deploymentRuns.js';
import { findChangeSet, titleOf, type ChangeSetActorView } from './changeSetViews.js';
import type { ContentServiceContext } from './contentAccess.js';

/**
 * A change set's timeline (from its audit rows and its deployment run) and the drafts not yet in any set
 * (the "Unassigned" list on the Changes page).
 */
export type TimelineEventView = {
  at: Date;
  kind: string;
  actor: ChangeSetActorView | null;
  message: string | null;
  snapshot: number | null;
  deploymentRunId: string | null;
  /** `item.changedAfterReview`: the entry whose draft moved between review and a scheduled ship. */
  item: { entryId: string; locale: string; fromVersion: number; toVersion: number } | null;
};

const TIMELINE_LIMIT = 500;

const KIND_BY_ACTION: Readonly<Record<string, string>> = {
  'change_set.create': 'created',
  'change_set.update': 'updated',
  'change_set.item_add': 'item_added',
  'change_set.item_remove': 'item_removed',
  'change_set.schema_draft': 'schema_draft_saved',
  'change_set.schema_draft_remove': 'item_removed',
  'change_set.schedule': 'scheduled',
  'change_set.unschedule': 'unscheduled',
  'change_set.shipping': 'shipping',
  'change_set.discard': 'discarded',
  'change_set.item_changed_after_review': 'item.changedAfterReview',
};

const changedItemOf = (metadata: Record<string, unknown>): TimelineEventView['item'] =>
  typeof metadata.entryId === 'string' &&
  typeof metadata.locale === 'string' &&
  typeof metadata.fromVersion === 'number' &&
  typeof metadata.toVersion === 'number'
    ? {
        entryId: metadata.entryId,
        locale: metadata.locale,
        fromVersion: metadata.fromVersion,
        toVersion: metadata.toVersion,
      }
    : null;

const kindOf = (action: string, outcome: string) => {
  if (action === 'change_set.ship') {
    return outcome === 'failure' ? 'failed' : 'shipped';
  }
  return KIND_BY_ACTION[action] ?? action;
};

const messageOf = (metadata: Record<string, unknown>): string | null => {
  for (const key of ['error', 'title', 'modelKey', 'apiKey', 'at']) {
    const value = metadata[key];
    if (typeof value === 'string' && value !== '') {
      return value;
    }
  }
  return null;
};

const ACTOR_TYPES: ReadonlySet<string> = new Set(['admin', 'token', 'system']);

const actorOf = (row: {
  actor_type: string;
  actor_id: string | null;
  actor_name: string | null;
}): ChangeSetActorView | null =>
  ACTOR_TYPES.has(row.actor_type)
    ? { type: row.actor_type as ChangeSetActorView['type'], id: row.actor_id, name: row.actor_name }
    : null;

const deployEvents = (runId: string, timeline: unknown): TimelineEventView[] =>
  (Array.isArray(timeline) ? (timeline as TimelineEvent[]) : []).map((event) => ({
    at: new Date(event.at),
    kind: `deploy_${event.status}`,
    actor: null,
    message: event.message,
    snapshot: null,
    deploymentRunId: runId,
    item: null,
  }));

export const getTimeline = async (
  context: ContentServiceContext,
  id: string,
): Promise<TimelineEventView[]> => {
  const row = await findChangeSet(context, id);
  const audit = await auditLogRepository.listEvents(
    { targetType: 'change_set', targetId: id },
    undefined,
    TIMELINE_LIMIT,
    context.db,
  );
  // The audit rows come newest first; reversed, the stable sort below keeps equal timestamps in their stored order.
  const events: TimelineEventView[] = [...audit].reverse().map((event) => {
    const metadata = (event.metadata ?? {}) as Record<string, unknown>;
    return {
      at: event.occurred_at,
      kind: kindOf(event.action, event.outcome),
      actor: actorOf(event),
      message: messageOf(metadata),
      snapshot: typeof metadata.snapshot === 'number' ? metadata.snapshot : null,
      deploymentRunId: typeof metadata.deploymentRunId === 'string' ? metadata.deploymentRunId : null,
      item: event.action === 'change_set.item_changed_after_review' ? changedItemOf(metadata) : null,
    };
  });
  const run = row.deployment_run_id
    ? await deploymentRunsRepository.findById(row.deployment_run_id, context.db)
    : undefined;
  return [...events, ...(run ? deployEvents(run.id, run.timeline) : [])].sort(
    (a, b) => a.at.getTime() - b.at.getTime(),
  );
};

export type UnassignedEntryView = {
  entryId: string;
  modelId: string;
  modelKey: string | null;
  title: string | null;
  locale: string;
  status: 'draft' | 'modified';
  updatedAt: Date;
};

type UnassignedCursor = { updatedAt: string; entryId: string; locale: string };

const decodeCursor = (cursor: string | undefined) => {
  if (!cursor) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as UnassignedCursor;
    return { updatedAt: new Date(parsed.updatedAt), entryId: parsed.entryId, locale: parsed.locale };
  } catch {
    throw new AppError(400, 'INVALID_CURSOR', 'The cursor is not valid');
  }
};

/** Drafts of models the caller may publish that no active change set holds yet, newest first. */
export const listUnassigned = async (
  context: ContentServiceContext,
  query: { cursor?: string | undefined; limit?: number | undefined },
): Promise<{ items: UnassignedEntryView[]; nextCursor: string | null }> => {
  const limit = query.limit ?? 50;
  const after = decodeCursor(query.cursor);
  const rows = await changeSetItemsRepository.listUnassigned(
    { siteId: context.site.id, limit: limit + 1, ...(after ? { after } : {}) },
    context.db,
  );
  const page = rows.slice(0, limit);
  const heads = await changeSetItemsRepository.findHeadsForEntries(
    [...new Set(page.map((row) => row.entry_id))],
    context.db,
  );
  const publishable = new Map<string, boolean>();
  for (const modelId of new Set(page.map((row) => row.model_id))) {
    const policy = await context.permissions.evaluate(context.actor, { action: 'publish', modelId });
    publishable.set(modelId, policy.allowed);
  }
  const last = page.at(-1);
  return {
    items: page
      .filter((row) => publishable.get(row.model_id))
      .map((row) => ({
        entryId: row.entry_id,
        modelId: row.model_id,
        modelKey: context.snapshot.byId.get(row.model_id)?.definition.apiKey ?? null,
        title: titleOf(
          context.snapshot,
          row.model_id,
          heads.filter((head) => head.entry_id === row.entry_id),
          row.locale,
        ),
        locale: row.locale,
        status: row.status,
        updatedAt: row.updated_at,
      })),
    nextCursor:
      rows.length > limit && last
        ? Buffer.from(
            JSON.stringify({
              updatedAt: last.updated_at.toISOString(),
              entryId: last.entry_id,
              locale: last.locale,
            }),
          ).toString('base64url')
        : null,
  };
};
