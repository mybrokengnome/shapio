import { parseDefinition, type SchemaDefinition } from '@shapio/schema';
import { AppError } from '../helpers/appError.js';
import * as schemaChangeJobsRepository from '../repositories/schemaChangeJobs.js';
import * as schemaModelsRepository from '../repositories/schemaModels.js';
import * as schemaSettingsRepository from '../repositories/schemaSettings.js';
import {
  acknowledgementRequired,
  definitionNotFound,
  schemaChangeUnsupported,
  schemaInvalid,
  schemaReadOnly,
  schemaVersionConflict,
} from '../schema/errors.js';
import { activateDefinition } from '../schema/planner/activate.js';
import { computeImpact, type PlanImpact } from '../schema/planner/impact.js';
import { buildChangePlan, type ChangePlan } from '../schema/planner/plan.js';
import { requestChange } from '../schema/planner/request.js';
import { scopedDefinitionsOf } from '../schema/scopedValidation.js';
import { loadSiteKeys } from '../schema/siteKeys.js';
import type { ActiveDefinition } from '../schema/snapshot.js';
import { readStoredDefinition, readStoredRevision } from '../schema/storedDefinition.js';
import {
  assertCanCreate,
  assertCanManage,
  canReadDefinition,
  filterReadable,
  type SchemaServiceContext,
} from './schemaAccess.js';

/** Models (collections and singletons) and components share the machinery; routes are per kind. */
export type DefinitionCategory = 'model' | 'component';

const categoryOf = (definition: Pick<SchemaDefinition, 'kind'>): DefinitionCategory =>
  definition.kind === 'component' ? 'component' : 'model';

export type Acknowledgement = { acknowledgeBreaking?: boolean; acknowledgeDestructive?: boolean };

/** Where a new definition goes: the request's site, or every site (`network`, a shared definition). */
export type DefinitionScope = 'network' | 'site';

export type ProposedChange = {
  category: DefinitionCategory;
  /** The definition being edited; absent for a create. */
  id?: string;
  definition: unknown;
  /** The active version the caller edited; null (or absent) for a create. */
  expectedVersion: number | null;
  /** For a create: where it goes (default `site`). An existing definition keeps its scope. */
  scope?: DefinitionScope;
};

export type PreparedChange = {
  plan: ChangePlan;
  before: SchemaDefinition | null;
  after: SchemaDefinition | null;
  expectedVersion: number | null;
};

export type ChangeOutcome =
  | { status: 'activated'; definitionId: string; version: number | null; schemaVersion: number }
  | { status: 'unchanged'; definitionId: string; version: number }
  | { status: 'pending'; definitionId: string; changeId: string; toVersion: number | null };

export const activeOf = (
  context: SchemaServiceContext,
  id: string,
  category: DefinitionCategory,
): ActiveDefinition => {
  // The request's view: another site's definition reads as not found.
  const active = context.snapshot.byId.get(id);
  if (!active || categoryOf(active.definition) !== category) {
    throw definitionNotFound(id);
  }
  return active;
};

/**
 * The scope a create lands in: the request's site unless `network` (shared) is asked for. On a network
 * route (no site) only shared definitions can be created.
 */
export const scopeForCreate = (
  context: SchemaServiceContext,
  scope: DefinitionScope | undefined,
): string | null => {
  if (scope === 'network') {
    return null;
  }
  if (context.snapshot.siteId === null) {
    throw new AppError(
      400,
      'SITE_REQUIRED',
      'A site definition is created on a site: name one, or ask for scope "network"',
    );
  }
  return context.snapshot.siteId;
};

/**
 * The definition a create restores: the last revision of a deleted model with this ID, if any. A deleted
 * definition is restored in its own scope only, so a restore by ID can never move another site's
 * definition onto this one (or share it).
 */
export const findDeletedDefinition = async (
  context: SchemaServiceContext,
  id: string,
  scope: string | null,
): Promise<SchemaDefinition | null> => {
  const model = await schemaModelsRepository.findModelById(id, context.db);
  if (!model?.deleted_at) {
    return null;
  }
  if (model.site_id !== scope) {
    // Another site's deleted definition is not this site's to see; a shared one is restored shared.
    if (model.site_id !== null && model.site_id !== context.snapshot.siteId) {
      throw definitionNotFound(id);
    }
    throw scopeMismatch(id, model.site_id === null ? 'network' : 'site');
  }
  const revision = await schemaModelsRepository.findLatestRevision(id, context.db);
  return revision ? readStoredDefinition(revision.definition) : null;
};

/** A change names another scope than the definition's: scopes change only through the scope endpoint. */
export const scopeMismatch = (id: string, scope: DefinitionScope) =>
  new AppError(
    409,
    'SCOPE_MISMATCH',
    scope === 'network'
      ? 'This definition is shared with all sites; restore or change it with scope "network", or change its scope first'
      : 'This definition belongs to one site; restore or change it with scope "site", or change its scope first',
    { definitionId: id, scope },
  );

/** A definition ID that is active on another site is not this request's to touch. */
const assertNotOnAnotherSite = (context: SchemaServiceContext, id: string | undefined) => {
  if (id && !context.snapshot.byId.has(id) && context.snapshot.network.byId.has(id)) {
    throw definitionNotFound(id);
  }
};

/** The planner's view of every site's definitions at the request's pinned version. */
export const plannerInputOf = async (context: SchemaServiceContext) => ({
  active: scopedDefinitionsOf(context.snapshot.network.definitions),
  siteKeys: await loadSiteKeys(context.db),
});

const rawId = (raw: unknown): string | undefined => {
  const id = (raw as { id?: unknown } | null)?.id;
  return typeof id === 'string' ? id : undefined;
};

/**
 * Validates a proposal and plans it against the pinned snapshot (brief §5 steps 1–4). Throws on stale
 * versions, invalid definitions and unsupported conversions; never writes.
 */
export const prepareChange = async (
  context: SchemaServiceContext,
  input: ProposedChange,
): Promise<PreparedChange> => {
  const definitionId = input.id ?? rawId(input.definition);
  assertNotOnAnotherSite(context, definitionId);
  const active = definitionId ? context.snapshot.byId.get(definitionId) : undefined;
  if (input.id) {
    activeOf(context, input.id, input.category);
  }
  const currentVersion = active?.version ?? null;
  if (currentVersion !== input.expectedVersion) {
    throw schemaVersionConflict(input.expectedVersion, currentVersion);
  }
  const siteId = active ? active.siteId : scopeForCreate(context, input.scope);
  const before =
    active?.definition ?? (definitionId ? await findDeletedDefinition(context, definitionId, siteId) : null);
  const parsed = parseDefinition(input.definition, before ? { previous: before } : {});
  if (!parsed.ok) {
    throw schemaInvalid(parsed.issues);
  }
  const after = parsed.definition;
  if (input.id && after.id !== input.id) {
    throw schemaInvalid([
      { path: '/id', code: 'INVALID_ID', message: 'does not match the definition being edited' },
    ]);
  }
  if (categoryOf(after) !== input.category) {
    throw schemaInvalid([
      { path: '/kind', code: 'INVALID_STRUCTURE', message: `must be a ${input.category} kind` },
    ]);
  }
  const plan = buildChangePlan({
    before,
    after,
    fromVersion: currentVersion,
    ...(await plannerInputOf(context)),
    siteId,
    hasContent: before !== null,
  });
  if (plan.issues.length > 0) {
    throw schemaInvalid(plan.issues);
  }
  if (!plan.summary.supported) {
    throw schemaChangeUnsupported(plan.changes.filter((change) => !change.supported));
  }
  return { plan, before, after, expectedVersion: currentVersion };
};

export const assertAcknowledged = (plans: readonly ChangePlan[], ack: Acknowledgement) => {
  const needsBreaking = plans.some((plan) => plan.summary.breaking) && !ack.acknowledgeBreaking;
  const needsDestructive = plans.some((plan) => plan.summary.destructive) && !ack.acknowledgeDestructive;
  if (needsBreaking || needsDestructive) {
    throw acknowledgementRequired(plans.length === 1 ? plans[0] : plans);
  }
};

/** The opt-in read-only lock (ADR 0002): only `shapio schema apply` may change definitions. */
export const assertWritable = async (context: SchemaServiceContext) => {
  const settings = await schemaSettingsRepository.get(context.db);
  if (settings.read_only) {
    throw schemaReadOnly(settings.read_only_reason);
  }
};

/** Editing needs schema permission on the definition; a create (or restore by ID) on its scope. */
const authorize = async (context: SchemaServiceContext, input: ProposedChange) => {
  const id = input.id ?? rawId(input.definition);
  const active = id ? context.snapshot.byId.get(id) : undefined;
  return input.id || active
    ? assertCanManage(context, (input.id ?? id) as string)
    : assertCanCreate(context, scopeForCreate(context, input.scope));
};

/** Plan preview (brief §5 step 5): classification, impact and prerequisites, with nothing written. */
export const previewChange = async (
  context: SchemaServiceContext,
  input: ProposedChange,
): Promise<{ plan: ChangePlan; impact: PlanImpact }> => {
  await authorize(context, input);
  const { plan } = await prepareChange(context, input);
  return { plan, impact: await computeImpact(plan, context.ports) };
};

/**
 * Executes a prepared change: metadata and additive changes activate at once; changes with prerequisites
 * start a schema change job and return `pending`.
 */
export const executePreparedChange = async (
  context: SchemaServiceContext,
  { plan, after, expectedVersion }: PreparedChange,
): Promise<ChangeOutcome> => {
  const request = {
    actor: context.actor,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.ip ? { ip: context.ip } : {}),
  };
  if (after && plan.prerequisites.length > 0) {
    const change = await requestChange(context.db, { plan, after, expectedVersion, ...request });
    const revision = change.to_revision_id
      ? await schemaModelsRepository.findRevisionById(change.to_revision_id, context.db)
      : undefined;
    return {
      status: 'pending',
      definitionId: plan.definitionId,
      changeId: change.id,
      toVersion: revision?.version ?? null,
    };
  }
  const result = await activateDefinition(context.db, { plan, after, expectedVersion }, request);
  return {
    status: 'activated',
    definitionId: plan.definitionId,
    version: result.version,
    schemaVersion: result.schemaVersion,
  };
};

/** Create or update from the admin UI or API (brief §5 steps 1–9). */
export const applyChange = async (
  context: SchemaServiceContext,
  input: ProposedChange & Acknowledgement,
): Promise<ChangeOutcome> => {
  await authorize(context, input);
  await assertWritable(context);
  const prepared = await prepareChange(context, input);
  if (prepared.plan.operation === 'update' && prepared.plan.changes.length === 0) {
    return {
      status: 'unchanged',
      definitionId: prepared.plan.definitionId,
      version: prepared.expectedVersion ?? 0,
    };
  }
  assertAcknowledged([prepared.plan], input);
  return executePreparedChange(context, prepared);
};

/** Soft-deletes a definition. Entries are kept; applying the definition again restores them. */
export const deleteDefinition = async (
  context: SchemaServiceContext,
  input: { category: DefinitionCategory; id: string; expectedVersion: number },
): Promise<ChangeOutcome> => {
  await assertCanManage(context, input.id);
  await assertWritable(context);
  const active = activeOf(context, input.id, input.category);
  if (active.version !== input.expectedVersion) {
    throw schemaVersionConflict(input.expectedVersion, active.version);
  }
  const plan = buildChangePlan({
    before: active.definition,
    after: null,
    fromVersion: active.version,
    ...(await plannerInputOf(context)),
    siteId: active.siteId,
    hasContent: true,
  });
  if (plan.issues.length > 0) {
    throw schemaInvalid(plan.issues);
  }
  return executePreparedChange(context, {
    plan,
    before: active.definition,
    after: null,
    expectedVersion: active.version,
  });
};

/**
 * The readable definitions of a category in the request's view (shared and the site's own), each with the
 * change still running for it (one query). `scope: 'network'` lists the shared definitions only.
 */
export const listDefinitions = async (
  context: SchemaServiceContext,
  category: DefinitionCategory,
  scope?: DefinitionScope,
) => {
  const readable = await filterReadable(
    context,
    context.snapshot.definitions.filter(
      (entry) => categoryOf(entry.definition) === category && (scope !== 'network' || entry.siteId === null),
    ),
  );
  const inFlight = await schemaChangeJobsRepository.findInFlightForModels(
    readable.map((entry) => entry.definition.id),
    context.db,
  );
  const pendingByModel = new Map(inFlight.map((change) => [change.model_id, change]));
  return readable.map((active) => ({
    active,
    pendingChange: pendingByModel.get(active.definition.id) ?? null,
  }));
};

export const getDefinition = async (
  context: SchemaServiceContext,
  category: DefinitionCategory,
  id: string,
) => {
  const active = activeOf(context, id, category);
  if (!(await canReadDefinition(context, id))) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have access to this definition.');
  }
  const pendingChange = await schemaChangeJobsRepository.findInFlight({ type: 'model', id }, context.db);
  return { active, pendingChange: pendingChange ?? null };
};

export const listRevisions = async (
  context: SchemaServiceContext,
  category: DefinitionCategory,
  id: string,
) => {
  await getDefinition(context, category, id);
  return schemaModelsRepository.listRevisions(id, 100, context.db);
};

export const getRevision = async (
  context: SchemaServiceContext,
  category: DefinitionCategory,
  id: string,
  revisionId: string,
) => {
  await getDefinition(context, category, id);
  const revision = await schemaModelsRepository.findRevisionById(revisionId, context.db);
  if (!revision || revision.model_id !== id) {
    throw new AppError(404, 'NOT_FOUND', 'No such revision');
  }
  return { ...revision, ...(await readStoredRevision(revision.definition, revision.hash)) };
};

export const listChanges = async (
  context: SchemaServiceContext,
  category: DefinitionCategory,
  id: string,
) => {
  await getDefinition(context, category, id);
  return schemaChangeJobsRepository.listForModel(id, 50, context.db);
};

export const getChange = async (context: SchemaServiceContext, changeId: string) => {
  const change = await schemaChangeJobsRepository.findById(changeId, context.db);
  if (!change) {
    throw new AppError(404, 'NOT_FOUND', 'No such schema change');
  }
  if (change.model_id && !(await canReadDefinition(context, change.model_id))) {
    throw new AppError(403, 'FORBIDDEN', 'You do not have access to this change.');
  }
  return change;
};
