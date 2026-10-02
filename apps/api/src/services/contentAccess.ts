import type { Transaction } from 'kysely';
import { assertAllowed, matchesRowFilter } from '../content/compiler/policy.js';
import { entryNotFound } from '../content/errors.js';
import type { ContentHooks } from '../content/hooks.js';
import { resolveModel, type ContentModel } from '../content/model.js';
import type { ReadEnvironment } from '../content/read.js';
import type { Database } from '../db/index.js';
import type { DB } from '../db/types.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import type { ContentAction, PermissionEvaluator, Policy, Principal } from '../permissions/types.js';
import type { EntryRow } from '../repositories/entries.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import { recordAudit } from './audit.js';

/** Everything a content service call needs: no HTTP objects (CONTRIBUTING.md, code organisation). */
export type ContentServiceContext = {
  db: Database;
  /** The request's pinned schema snapshot. */
  snapshot: SchemaSnapshot;
  permissions: PermissionEvaluator;
  actor: Principal;
  hooks: ContentHooks;
  /** Media storage and URL builder (package G): media fields render as asset views with URLs. */
  media?: ReadEnvironment['media'];
  requestId?: string;
  ip?: string;
};

const ACTION_LABELS: Readonly<Record<ContentAction, string>> = {
  read: 'reading',
  create: 'creating',
  update: 'editing',
  delete: 'deleting',
  publish: 'publishing',
  schemaManage: 'managing',
};

/** Resolves the model and the caller's policy for one action; 403 when not allowed (CONTRIBUTING.md rule 5). */
export const modelWithPolicy = async (
  context: ContentServiceContext,
  modelKey: string,
  action: ContentAction,
): Promise<{ model: ContentModel; policy: Policy }> => {
  const model = resolveModel(context.snapshot, modelKey);
  const policy = await context.permissions.evaluate(context.actor, { action, modelId: model.definition.id });
  assertAllowed(policy, `${ACTION_LABELS[action]} "${modelKey}" entries`);
  return { model, policy };
};

/** Entries outside the caller's row filter look like missing entries (no existence oracle). */
export const assertEntryVisible = (
  policy: Policy,
  actor: Principal,
  entry: EntryRow | undefined,
  id: string,
) => {
  if (!entry || !matchesRowFilter(policy.rowFilter, actor, entry)) {
    throw entryNotFound(id);
  }
  return entry;
};

export type EntryEvent =
  | 'entry.created'
  | 'entry.updated'
  | 'entry.deleted'
  | 'entry.published'
  | 'entry.unpublished'
  | 'entry.restored';

/** The outbox event of a content change, in the change's transaction (ADR 0007). */
export const writeEntryEvent = (
  trx: Transaction<DB>,
  model: ContentModel,
  type: EntryEvent,
  entryId: string,
  payload: Record<string, unknown>,
) =>
  writeOutboxEvent(trx, {
    type,
    aggregateType: 'entry',
    aggregateId: entryId,
    payload: { modelId: model.definition.id, modelKey: model.definition.apiKey, entryId, ...payload },
  });

/** Audited content operations (publishing, unpublishing, deletes, restores; build plan §3.11). */
export const auditEntry = (
  trx: Transaction<DB>,
  context: ContentServiceContext,
  model: ContentModel,
  action: string,
  entryId: string,
  metadata: Record<string, unknown>,
) =>
  recordAudit(trx, {
    actor: context.actor,
    action,
    target: { type: 'entry', id: entryId },
    metadata: { modelId: model.definition.id, modelKey: model.definition.apiKey, ...metadata },
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.ip ? { ip: context.ip } : {}),
  });
