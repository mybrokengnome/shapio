import { compileLens, isInterfaceDefinition, routeKeyOf } from '@shapio/schema';
import type { Transaction } from 'kysely';
import { schemaVersionToken } from '../constants/schemaLens.js';
import { allowsNewEntry, assertAllowed, forbidden, matchesRowFilter } from '../content/compiler/policy.js';
import { entryNotFound } from '../content/errors.js';
import type { ContentHooks } from '../content/hooks.js';
import { resolveModel, resolveModelById, type ContentModel } from '../content/model.js';
import type { ReadEnvironment } from '../content/read.js';
import type { Database } from '../db/index.js';
import type { DB } from '../db/types.js';
import { AppError } from '../helpers/appError.js';
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
import * as schemaVersionsRepository from '../repositories/schemaVersions.js';
import { lensBudgetKeyOf } from '../schema/lens/budget.js';
import { loadRequestLens, parseSchemaVersionToken, type RequestLens } from '../schema/lens/views.js';
import type { SchemaSnapshot } from '../schema/snapshot.js';
import type { SiteRef } from './actorContext.js';
import { recordAudit } from './audit.js';

/** Everything a content service call needs: no HTTP objects (CONTRIBUTING.md, code organization). */
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
  /**
   * Schema lenses (plan schema-lenses): the schema version the call names, and its lens. Absent: today's
   * shape. An `identity` lens (nothing in the view changed since) reads exactly as without one.
   */
  lens?: RequestLens;
  /**
   * The client fields a lensed `fields=` named, by stable ID (gone ones included: they read null); null when
   * it named none. Set with the lensed query (`services/contentDeliveryLens.ts`).
   */
  lensSelection?: readonly string[] | null;
  /** This instance's schema ID (`<schemaId>:<version>` tokens); set on delivery contexts. */
  schemaId?: string;
};

const schemaIds = new WeakMap<Database, Promise<string>>();

/** The instance's schema ID: written once by a migration, so read once per database handle. */
export const schemaIdOf = (db: Database): Promise<string> => {
  let schemaId = schemaIds.get(db);
  if (!schemaId) {
    schemaId = schemaVersionsRepository.getSchemaId(db);
    schemaIds.set(db, schemaId);
    schemaId.catch(() => schemaIds.delete(db));
  }
  return schemaId;
};

/** The lens of a call naming today's version: nothing to translate. */
const currentVersionLens = (snapshot: SchemaSnapshot): RequestLens => {
  const side = { get: (id: string) => snapshot.byId.get(id)?.definition, resolve: snapshot.resolve };
  return {
    requested: snapshot.version,
    current: snapshot.version,
    view: snapshot,
    identity: true,
    lensFor: (id) => compileLens(side, side, id),
  };
};

/** The schema version an API token is pinned to (plan schema-lenses); null for every other caller. */
export const pinnedSchemaVersionOf = (actor: Principal): number | null =>
  actor.kind === 'token' ? (actor.pinnedSchemaVersion ?? null) : null;

/**
 * The `<schemaId>:<version>` a call names, or the one of the API token's pin when it names none; null when
 * neither. For callers that take the token rather than a content context (the generated contracts).
 */
export const schemaVersionTokenWithPin = async (
  db: Database,
  actor: Principal,
  token: string | null,
): Promise<string | null> => {
  const pinned = token === null ? pinnedSchemaVersionOf(actor) : null;
  return pinned === null ? token : schemaVersionToken(await schemaIdOf(db), pinned);
};

/**
 * The context with the schema ID and, when the call names a schema version (`<schemaId>:<version>`), its lens:
 * `SCHEMA_VERSION_INVALID`, `SCHEMA_VERSION_FOREIGN` or `SCHEMA_VERSION_AHEAD` when it cannot be served. A call
 * that names none, made with an API token pinned to a version, is served as if it had named the pin; a version
 * the call names wins over the pin.
 */
export const withSchemaLens = async (
  context: ContentServiceContext,
  token: string | null,
): Promise<ContentServiceContext> => {
  const schemaId = await schemaIdOf(context.db);
  const version =
    token === null ? pinnedSchemaVersionOf(context.actor) : parseSchemaVersionToken(token, schemaId);
  if (version === null) {
    return { ...context, schemaId };
  }
  const lens =
    (await loadRequestLens(
      context.db,
      context.snapshot,
      version,
      lensBudgetKeyOf(context.actor, context.snapshot.siteId),
    )) ?? currentVersionLens(context.snapshot);
  return { ...context, schemaId, lens };
};

/** Whether the call reads through a lens that translates anything (not today's version, not an identity). */
export const activeLens = (context: Pick<ContentServiceContext, 'lens'>): RequestLens | undefined =>
  context.lens && !context.lens.identity ? context.lens : undefined;

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
/**
 * An interface has no entries of its own (plan interfaces, D6): writing through its route is refused (405),
 * naming the members' routes, where entries are created and changed. Reads keep their own handling.
 */
export const refuseInterfaceWrite = (snapshot: SchemaSnapshot, modelKey: string, action: ContentAction) => {
  const contract = snapshot.interfacesByApiKey.get(modelKey)?.definition;
  if (
    action === 'read' ||
    !contract ||
    !isInterfaceDefinition(contract) ||
    snapshot.modelsByApiKey.has(modelKey)
  ) {
    return;
  }
  const routes = snapshot.implementedBy(contract.id).flatMap((id) => {
    const member = resolveModelById(snapshot, id);
    return member?.route ? [`/api/content/${member.route.key}`] : [];
  });
  throw new AppError(
    405,
    'METHOD_NOT_ALLOWED',
    `"${routeKeyOf(contract)}" is an interface and has no entries of its own; ${
      routes.length > 0
        ? `write to a member's route instead: ${routes.join(', ')}`
        : 'no type implements it yet'
    }`,
    { interface: contract.apiKey, memberRoutes: routes },
  );
};

export const modelWithPolicy = async (
  context: ContentServiceContext,
  modelKey: string,
  action: ContentAction,
  executor?: PermissionExecutor,
): Promise<{ model: ContentModel; policy: Policy }> => {
  refuseInterfaceWrite(context.snapshot, modelKey, action);
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
  refuseInterfaceWrite(context.snapshot, modelKey, action);
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
 * Where a model is served: its route key (`products/digital`), its ancestors' API IDs, root first (plan
 * polymorphic-types), and the route keys of the interfaces it implements (plan interfaces), so a subscriber
 * can revalidate every list the entry appears in. A model built by hand (no `route`) is a root at its plural.
 */
export const routeFieldsOf = (model: Pick<ContentModel, 'definition' | 'route'>) => ({
  routeKey: model.route?.key ?? routeKeyOf(model.definition),
  ancestors: model.route?.ancestors ?? [],
  interfaces: model.route?.interfaces ?? [],
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
