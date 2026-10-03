import { effectiveTitleField } from '@shapio/schema';
import type { Database } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import * as changeSetItemsRepository from '../repositories/changeSetItems.js';
import type { ChangeSetItemRow, EntryHeadRow } from '../repositories/changeSetItems.js';
import * as changeSetsRepository from '../repositories/changeSets.js';
import type { ChangeSetRow } from '../repositories/changeSets.js';
import * as schemaDraftsRepository from '../repositories/schemaDrafts.js';
import type { SchemaDraftRow } from '../repositories/schemaDrafts.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import type { SiteRef } from './actorContext.js';

/**
 * Change set views (the shapes in routes/admin/changeSets/schemas.ts) and the errors every change-set
 * service shares.
 */
export type ChangeSetActorView = {
  type: 'admin' | 'token' | 'system';
  id: string | null;
  name: string | null;
};

export type ChangeSetErrorView = { code: string; message: string; itemId: string | null; details?: unknown };

export type EntryItemView = {
  id: string;
  kind: 'entry';
  position: number;
  entryId: string;
  modelId: string;
  modelKey: string | null;
  title: string | null;
  locale: string;
  action: 'publish' | 'unpublish';
  sourceRevisionId: string | null;
  status: 'pending' | 'done' | 'failed';
  error: string | null;
};

export type SchemaOperation = 'create' | 'update' | 'delete';

export type SchemaItemView = {
  id: string;
  kind: 'schema';
  position: number;
  draftId: string;
  definitionId: string;
  category: 'model' | 'component';
  apiKey: string;
  operation: SchemaOperation;
  baseVersion: number | null;
  draftVersion: number;
  status: 'pending' | 'done' | 'failed';
  error: string | null;
};

export type ChangeSetSummaryView = {
  id: string;
  title: string;
  description: string;
  status: changeSetsRepository.ChangeSetStatus;
  shipPhase: 'preparing' | 'activating' | null;
  source: 'manual' | 'release' | 'restore' | 'builder';
  restoreOfSnapshot: number | null;
  scheduledFor: Date | null;
  deploymentConnectionId: string | null;
  deploymentRunId: string | null;
  shippedAt: Date | null;
  shippedSnapshot: number | null;
  schemaVersionAfter: number | null;
  error: ChangeSetErrorView | null;
  entryItemCount: number;
  schemaItemCount: number;
  createdBy: ChangeSetActorView;
  createdAt: Date;
  updatedAt: Date;
  version: number;
};

export type ChangeSetView = ChangeSetSummaryView & { items: Array<EntryItemView | SchemaItemView> };

export const changeSetNotFound = (id: string) =>
  new AppError(404, 'CHANGE_SET_NOT_FOUND', `No change set ${id}`, { id });

export const changeSetLocked = (status: string) =>
  new AppError(409, 'CHANGE_SET_LOCKED', `A ${status} change set cannot change`, { status });

export const changeSetVersionConflict = (expected: number, current: number) =>
  new AppError(409, 'VERSION_CONFLICT', 'The change set changed since you loaded it. Reload and try again.', {
    expectedVersion: expected,
    currentVersion: current,
  });

/** Sets whose items and drafts can still change. */
export const EDITABLE_STATUSES: ReadonlySet<string> = new Set(['open', 'scheduled', 'failed']);

const toNumber = (value: string | null): number | null => (value === null ? null : Number(value));

export const categoryOfKind = (kind: string): 'model' | 'component' =>
  kind === 'component' ? 'component' : 'model';

export const operationOf = (draft: Pick<SchemaDraftRow, 'base_version' | 'definition'>): SchemaOperation => {
  if (draft.definition === null) {
    return 'delete';
  }
  return draft.base_version === null ? 'create' : 'update';
};

const actorOf = (
  row: Pick<ChangeSetRow, 'created_by' | 'created_by_token'>,
  names: ReadonlyMap<string, string>,
): ChangeSetActorView => {
  if (row.created_by) {
    return { type: 'admin', id: row.created_by, name: names.get(row.created_by) ?? null };
  }
  if (row.created_by_token) {
    return { type: 'token', id: row.created_by_token, name: names.get(row.created_by_token) ?? null };
  }
  return { type: 'system', id: null, name: null };
};

const errorOf = (value: unknown): ChangeSetErrorView | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Partial<ChangeSetErrorView>;
  return {
    code: raw.code ?? 'SHIP_FAILED',
    message: raw.message ?? 'The change set failed to ship',
    itemId: raw.itemId ?? null,
    ...(raw.details !== undefined ? { details: raw.details } : {}),
  };
};

export const toSummary = (
  row: ChangeSetRow,
  counts: { entries: number; schema: number },
  names: ReadonlyMap<string, string>,
): ChangeSetSummaryView => ({
  id: row.id,
  title: row.title,
  description: row.description,
  status: row.status as ChangeSetSummaryView['status'],
  shipPhase: row.ship_phase as ChangeSetSummaryView['shipPhase'],
  source: row.source as ChangeSetSummaryView['source'],
  restoreOfSnapshot: toNumber(row.restore_of_seq),
  scheduledFor: row.scheduled_for,
  deploymentConnectionId: row.deployment_connection_id,
  deploymentRunId: row.deployment_run_id,
  shippedAt: row.shipped_at,
  shippedSnapshot: toNumber(row.shipped_seq),
  schemaVersionAfter: row.schema_version_after,
  error: errorOf(row.error),
  entryItemCount: counts.entries,
  schemaItemCount: counts.schema,
  createdBy: actorOf(row, names),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  version: row.version,
});

export const actorNamesFor = (
  database: Database,
  rows: ReadonlyArray<Pick<ChangeSetRow, 'created_by' | 'created_by_token'>>,
) =>
  changeSetsRepository.findActorNames(
    {
      adminIds: [...new Set(rows.flatMap((row) => (row.created_by ? [row.created_by] : [])))],
      tokenIds: [...new Set(rows.flatMap((row) => (row.created_by_token ? [row.created_by_token] : [])))],
    },
    database,
  );

/** The entry's title (the model's title field, draft first, then published); null without one. */
export const titleOf = (
  snapshot: SchemaSnapshot,
  modelId: string,
  heads: readonly EntryHeadRow[],
  locale: string,
): string | null => {
  const definition = snapshot.byId.get(modelId)?.definition;
  const field = definition ? effectiveTitleField(definition) : undefined;
  if (!field) {
    return null;
  }
  // This locale's draft, its published head, then other locales.
  const rank = (head: EntryHeadRow) => (head.locale === locale ? 0 : 2) + (head.state === 'draft' ? 0 : 1);
  const ordered = [...heads].sort((a, b) => rank(a) - rank(b));
  for (const head of ordered) {
    const value = (head.data as Record<string, unknown>)[field.id];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
    if (typeof value === 'number') {
      return String(value);
    }
  }
  return null;
};

const toEntryItem = (
  snapshot: SchemaSnapshot,
  item: ChangeSetItemRow,
  heads: readonly EntryHeadRow[],
): EntryItemView => ({
  id: item.id,
  kind: 'entry',
  position: item.position,
  entryId: item.entry_id ?? '',
  modelId: item.model_id ?? '',
  modelKey: snapshot.byId.get(item.model_id ?? '')?.definition.apiKey ?? null,
  title: titleOf(
    snapshot,
    item.model_id ?? '',
    heads.filter((head) => head.entry_id === item.entry_id),
    item.locale ?? '',
  ),
  locale: item.locale ?? '',
  action: item.action as EntryItemView['action'],
  sourceRevisionId: item.source_revision_id,
  status: item.status as EntryItemView['status'],
  error: item.error,
});

const toSchemaItem = (item: ChangeSetItemRow, draft: SchemaDraftRow): SchemaItemView => ({
  id: item.id,
  kind: 'schema',
  position: item.position,
  draftId: draft.id,
  definitionId: draft.definition_id,
  category: categoryOfKind(draft.kind),
  apiKey: draft.api_key,
  operation: operationOf(draft),
  baseVersion: draft.base_version,
  draftVersion: draft.version,
  status: item.status as SchemaItemView['status'],
  error: item.error,
});

/** The site-scoped part of a service context a set is read with. */
export type ChangeSetReadContext = { db: Database; snapshot: SchemaSnapshot; site: SiteRef };

/** One set of the context's site; another site's set is not found (sites plan §H). */
export const findChangeSet = async (context: ChangeSetReadContext, id: string): Promise<ChangeSetRow> => {
  const row = await changeSetsRepository.findOnSite(context.site.id, id, context.db);
  if (!row) {
    throw changeSetNotFound(id);
  }
  return row;
};

/** Loads a set with its items (titles from the entries' heads, schema items from their drafts). */
export const loadChangeSetView = async (
  context: ChangeSetReadContext,
  id: string,
): Promise<ChangeSetView> => {
  const { db: database, snapshot } = context;
  const row = await findChangeSet(context, id);
  const items = await changeSetItemsRepository.listForSet(id, database);
  const drafts = new Map(
    (await schemaDraftsRepository.listForSet(id, database)).map((draft) => [draft.id, draft]),
  );
  const heads = await changeSetItemsRepository.findHeadsForEntries(
    [...new Set(items.flatMap((item) => (item.entry_id ? [item.entry_id] : [])))],
    database,
  );
  const views = items.flatMap((item): Array<EntryItemView | SchemaItemView> => {
    if (item.kind === 'entry') {
      return [toEntryItem(snapshot, item, heads)];
    }
    const draft = drafts.get(item.schema_draft_id ?? '');
    return draft ? [toSchemaItem(item, draft)] : [];
  });
  const counts = {
    entries: views.filter((view) => view.kind === 'entry').length,
    schema: views.filter((view) => view.kind === 'schema').length,
  };
  return { ...toSummary(row, counts, await actorNamesFor(database, [row])), items: views };
};
