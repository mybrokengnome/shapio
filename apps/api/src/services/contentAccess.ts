import { routeKeyOf } from '@shapio/schema';
import type { Transaction } from 'kysely';
import { allowsNewEntry, assertAllowed, forbidden, matchesRowFilter } from '../content/compiler/policy.js';
import { entryNotFound } from '../content/errors.js';
import type { ContentHooks } from '../content/hooks.js';
import { resolveModel, resolveModelById, type ContentModel } from '../content/model.js';
import type { ReadEnvironment } from '../content/read.js';
import type { Database } from '../db/index.js';
import type { DB } from '../db/types.js';
import { writeOutboxEvent } from '../jobs/outbox.js';
import type {
  ContentAction,
  PermissionEvaluator,
  PermissionExecutor,
  Policy,
  Principal,
} from '../permissions/types.js';
import * as entriesRepository from '../repositories/entries.js';
import type { EntryRow } from '../repositories/entries.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import type { SiteRef } from './actorContext.js';
import { recordAudit } from './audit.js';

/** Everything a content service call needs: no HTTP objects (CONTRIBUTING.md, code organisation). */
export type ContentServiceContext = {
  db: Database;
  /** The request's pinned schema snapshot. */
  snapshot: SchemaSnapshot;
  permissions: PermissionEvaluator;
  actor: Principal;
  /** The site the call is about (sites plan §H): every content query and write is scoped to it. */
  site: SiteRef;
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

/**
 * Resolves the model and the caller's policy for one action; 403 when not allowed (CONTRIBUTING.md rule 5).
 * `executor`: the caller's open transaction, when there is one.
 */
export const modelWithPolicy = async (
  context: ContentServiceContext,
  modelKey: string,
  action: ContentAction,
  executor?: PermissionExecutor,
): Promise<{ model: ContentModel; policy: Policy }> => {
  const model = resolveModel(context.snapshot, modelKey);
  const policy = await context.permissions.evaluate(
    context.actor,
    { action, modelId: model.definition.id },
    executor,
  );
  assertAllowed(policy, `${ACTION_LABELS[action]} "${modelKey}" entries`);
  return { model, policy };
};

/**
 * The model an entry-by-ID call acts on, with the caller's policy for `action`. A route reads its model's
 * family (plan polymorphic-types), so `PUT /products/:id` on a Digital acts on the Digital: the entry's own
 * model, validated against its own fields, under its own policy. An entry of a kind the caller may not `action`
 * reads as missing (404), never as forbidden, so a family route is no existence oracle for hidden kinds. The
 * write re-reads the entry under its own model, so a kind change in between is a 404 there.
 */
export const entryModelWithPolicy = async (
  context: ContentServiceContext,
  modelKey: string,
  id: string,
  action: ContentAction,
  executor?: PermissionExecutor,
): Promise<{ model: ContentModel; policy: Policy }> => {
  const route = resolveModel(context.snapshot, modelKey);
  const family = context.snapshot.family(route.definition.id);
  if (family.length <= 1) {
    return modelWithPolicy(context, modelKey, action, executor);
  }
  const entry = await entriesRepository.findLive(id, family, context.site.id, executor ?? context.db);
  const actual = entry ? resolveModelById(context.snapshot, entry.model_id) : undefined;
  if (!actual || actual.definition.id === route.definition.id) {
    return modelWithPolicy(context, modelKey, action, executor);
  }
  const policy = await context.permissions.evaluate(
    context.actor,
    { action, modelId: actual.definition.id },
    executor,
  );
  if (!policy.allowed) {
    throw entryNotFound(id);
  }
  return { model: actual, policy };
};

/**
 * The create policy, refused (403) before any write when its row filter cannot hold for the new entry: a
 * create granted only on own entries, for a caller that owns nothing it creates (issue #105).
 */
export const modelWithCreatePolicy = async (
  context: ContentServiceContext,
  modelKey: string,
): Promise<{ model: ContentModel; policy: Policy }> => {
  const result = await modelWithPolicy(context, modelKey, 'create');
  if (!allowsNewEntry(result.policy, context.actor)) {
    throw forbidden(`Your role does not allow ${ACTION_LABELS.create} "${modelKey}" entries`);
  }
  return result;
};

/**
 * Entries outside the caller's row filter look like missing entries (no existence oracle). Another site's
 * entry never gets here: every lookup that feeds this is scoped to the request's site and reads it as missing.
 */
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
  | 'entry.restored'
  | 'entry.kind_changed';

/**
 * Where a model is served: its route key (`products/digital`) and its ancestors' API IDs, root first (plan
 * polymorphic-types), so a subscriber can revalidate every list the entry appears in. A model built by hand
 * (no `route`) is a root at its plural.
 */
export const routeFieldsOf = (model: Pick<ContentModel, 'definition' | 'route'>) => ({
  routeKey: model.route?.key ?? routeKeyOf(model.definition),
  ancestors: model.route?.ancestors ?? [],
});

/** The outbox event of a content change on a site, in the change's transaction (ADR 0007). */
export const writeEntryEvent = (
  trx: Transaction<DB>,
  siteId: string,
  model: Pick<ContentModel, 'definition' | 'route'>,
  type: EntryEvent,
  entryId: string,
  payload: Record<string, unknown>,
) =>
  writeOutboxEvent(trx, {
    siteId,
    type,
    aggregateType: 'entry',
    aggregateId: entryId,
    payload: {
      modelId: model.definition.id,
      modelKey: model.definition.apiKey,
      ...routeFieldsOf(model),
      entryId,
      ...payload,
    },
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
    metadata: {
      modelId: model.definition.id,
      modelKey: model.definition.apiKey,
      routeKey: routeFieldsOf(model).routeKey,
      ...metadata,
    },
    site: context.site,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.ip ? { ip: context.ip } : {}),
  });
