import {
  decideSync,
  diffDefinitions,
  foldApiKey,
  hashDefinition,
  lockEntriesForSite,
  parseDefinition,
  type ExportedDefinition,
  type LockFile,
  type SchemaChange,
  type SchemaDefinition,
  type SyncDecision,
  type ValidationIssue,
} from '@shapio/schema';
import { AppError } from '../helpers/appError.js';
import * as schemaModelsRepository from '../repositories/schemaModels.js';
import { schemaChangeUnsupported, schemaInvalid } from '../schema/errors.js';
import { activateDefinitions } from '../schema/planner/activate.js';
import { buildChangePlan, type ChangePlan } from '../schema/planner/plan.js';
import { requestChange } from '../schema/planner/request.js';
import { scopedDefinitionsOf, validateScoped, type ScopedDefinition } from '../schema/scopedValidation.js';
import { loadSiteKeys } from '../schema/siteKeys.js';
import { readStoredDefinition } from '../schema/storedDefinition.js';
import {
  assertCanCreate,
  assertCanManage,
  filterReadable,
  type SchemaServiceContext,
} from './schemaAccess.js';
import { assertAcknowledged, type Acknowledgement, type DefinitionScope } from './schemaDefinitions.js';

/**
 * `shapio schema pull` / `apply` over HTTP (ADR 0002). Apply is three-way per definition: the lock-file
 * base, the local file and the target's active revision. Any conflict refuses the whole apply (nothing
 * written) and returns the per-definition diff, like a rejected non-fast-forward push.
 */

export type { ExportedDefinition };

export type SchemaExport = {
  schemaVersion: number;
  /** The site whose view this is; null on a network route (shared definitions only). */
  site: { id: string; key: string } | null;
  definitions: ExportedDefinition[];
};

/**
 * The request's view for `shapio schema pull`: the shared definitions and the site's own, each with its
 * scope (`site`: the site key, null when shared). `scope: 'network'` exports the shared ones only.
 */
export const exportSchema = async (
  context: SchemaServiceContext,
  scope?: DefinitionScope,
): Promise<SchemaExport> => {
  const siteKeys = await loadSiteKeys(context.db);
  const siteId = context.snapshot.siteId;
  const entries = context.snapshot.definitions.filter(
    (entry) => scope !== 'network' || entry.siteId === null,
  );
  return {
    schemaVersion: context.snapshot.version,
    site: siteId === null ? null : { id: siteId, key: siteKeys.get(siteId) ?? '' },
    definitions: (await filterReadable(context, entries)).map((entry): ExportedDefinition => ({
      definition: entry.definition,
      version: entry.version,
      hash: entry.hash,
      site: entry.siteId === null ? null : (siteKeys.get(entry.siteId) ?? null),
    })),
  };
};

export type SyncApplyInput = Acknowledgement & {
  definitions: readonly unknown[];
  /**
   * Where each file's definition lives, parallel to `definitions` (its folder: `models/` is `network`,
   * `sites/<key>/models/` is `site`). Absent (an old CLI, a format-1 tree): every file is shared. Only a
   * create uses it; an existing definition whose scope differs is refused (`SCOPE_MISMATCH`).
   */
  scopes?: readonly DefinitionScope[] | undefined;
  base: LockFile;
  prune: boolean;
  dryRun: boolean;
};

export type SyncResultItem = {
  definitionId: string;
  apiKey: string;
  kind: SchemaDefinition['kind'];
  decision: SyncDecision;
  /** For apply/delete/conflict: the target's active definition → local file. */
  changes: SchemaChange[];
  outcome?: 'activated' | 'pending' | 'skipped';
  version?: number | null;
  changeId?: string;
  plan?: ChangePlan;
};

export type SyncApplyResult = { schemaVersion: number; dryRun: boolean; results: SyncResultItem[] };

type LocalDefinition = { definition: SchemaDefinition; hash: string; scope: DefinitionScope };

const parseLocalDefinitions = async (
  context: SchemaServiceContext,
  input: SyncApplyInput,
): Promise<Map<string, LocalDefinition>> => {
  const issues: ValidationIssue[] = [];
  const locals = new Map<string, LocalDefinition>();
  const activeByKey = new Map(
    context.snapshot.definitions.map((entry) => [foldApiKey(entry.definition.apiKey), entry]),
  );
  for (const [index, raw] of input.definitions.entries()) {
    // A hand-written new file may omit IDs: adopt the target's definition with the same API key, if any,
    // so the three-way rules (not a duplicate key) decide what happens.
    const apiKey =
      typeof (raw as { apiKey?: unknown })?.apiKey === 'string' ? (raw as { apiKey: string }).apiKey : '';
    const rawId = (raw as { id?: unknown })?.id;
    const previous =
      typeof rawId === 'string' ? context.snapshot.byId.get(rawId) : activeByKey.get(foldApiKey(apiKey));
    const parsed = parseDefinition(raw, previous ? { previous: previous.definition } : {});
    if (!parsed.ok) {
      issues.push(
        ...parsed.issues.map((found) => ({ ...found, path: `/definitions/${index}${found.path}` })),
      );
      continue;
    }
    if (
      !context.snapshot.byId.has(parsed.definition.id) &&
      context.snapshot.network.byId.has(parsed.definition.id)
    ) {
      issues.push({
        path: `/definitions/${index}/id`,
        code: 'DUPLICATE_ID',
        message: 'the ID belongs to another site’s definition',
      });
      continue;
    }
    if (locals.has(parsed.definition.id)) {
      issues.push({
        path: `/definitions/${index}/id`,
        code: 'DUPLICATE_ID',
        message: 'two files define the same ID',
      });
      continue;
    }
    locals.set(parsed.definition.id, {
      definition: parsed.definition,
      hash: await hashDefinition(parsed.definition),
      scope: input.scopes?.[index] ?? 'network',
    });
  }
  if (issues.length > 0) {
    throw schemaInvalid(issues);
  }
  return locals;
};

/**
 * The base entries this request's view is about: the shared definitions and this site's. A lock that covers
 * other sites' trees too (one repository for several sites) contributes nothing about them, so neither an
 * apply nor `--prune` can ever reach another site's definitions.
 */
const baseForView = (input: SyncApplyInput, siteKey: string | null) =>
  lockEntriesForSite(input.base, siteKey);

const decideAll = (
  context: SchemaServiceContext,
  locals: Map<string, LocalDefinition>,
  base: LockFile['definitions'],
  input: SyncApplyInput,
) => {
  const ids = new Set([...locals.keys(), ...Object.keys(base), ...context.snapshot.byId.keys()]);
  return [...ids].sort().map((id): SyncResultItem => {
    const local = locals.get(id);
    const base_ = base[id];
    const remote = context.snapshot.byId.get(id);
    const decision = decideSync({
      ...(local ? { local } : {}),
      ...(base_ ? { base: { version: base_.version, hash: base_.hash } } : {}),
      ...(remote
        ? { remote: { definition: remote.definition, version: remote.version, hash: remote.hash } }
        : {}),
      prune: input.prune,
    });
    const shown = local?.definition ?? remote?.definition;
    return {
      definitionId: id,
      apiKey: shown?.apiKey ?? base_?.apiKey ?? id,
      kind: shown?.kind ?? base_?.kind ?? 'collection',
      decision,
      changes:
        decision.action === 'skip'
          ? []
          : diffDefinitions(remote?.definition ?? null, local?.definition ?? null),
    };
  });
};

const conflictError = (items: readonly SyncResultItem[]) =>
  new AppError(
    409,
    'SCHEMA_SYNC_CONFLICT',
    'The target schema changed since your last pull for some definitions you also changed. Pull, reconcile and apply again.',
    { conflicts: items.filter((item) => item.decision.action === 'conflict') },
  );

/** The scope a local file's definition lands in (a create), or keeps (anything else). */
const scopeOfItem = (
  context: SchemaServiceContext,
  item: SyncResultItem,
  locals: ReadonlyMap<string, LocalDefinition>,
): string | null => {
  const remote = context.snapshot.byId.get(item.definitionId);
  if (remote) {
    return remote.siteId;
  }
  return locals.get(item.definitionId)?.scope === 'site' ? context.snapshot.siteId : null;
};

const labelOf = (siteId: string | null): DefinitionScope => (siteId === null ? 'network' : 'site');

/** Files whose folder names another scope than the definition has on the instance (sync never moves one). */
const scopeMismatches = (
  context: SchemaServiceContext,
  items: readonly SyncResultItem[],
  locals: ReadonlyMap<string, LocalDefinition>,
) =>
  items.flatMap((item) => {
    const remote = context.snapshot.byId.get(item.definitionId);
    const local = locals.get(item.definitionId);
    if (!remote || !local || item.decision.action === 'skip' || labelOf(remote.siteId) === local.scope) {
      return [];
    }
    return [
      {
        definitionId: item.definitionId,
        apiKey: item.apiKey,
        local: local.scope,
        remote: labelOf(remote.siteId),
      },
    ];
  });

const scopeMismatchError = (mismatches: ReturnType<typeof scopeMismatches>) =>
  new AppError(
    409,
    'SCOPE_MISMATCH',
    'Some files are in another folder than their definition’s scope on the instance (it was moved there). Pull, or change the scope with `shapio schema scope`.',
    { items: mismatches },
  );

/** Every create and change the caller may not make, all reported before anything is written. */
const authorizeActions = async (
  context: SchemaServiceContext,
  items: readonly SyncResultItem[],
  locals: ReadonlyMap<string, LocalDefinition>,
) => {
  const refused: Array<{ definitionId: string; apiKey: string; scope: DefinitionScope; message: string }> =
    [];
  for (const item of items) {
    const scope = scopeOfItem(context, item, locals);
    try {
      if (item.decision.action === 'create') {
        await assertCanCreate(context, scope);
      } else if (item.decision.action === 'update' || item.decision.action === 'delete') {
        await assertCanManage(context, item.definitionId);
      }
    } catch (error) {
      if (!(error instanceof AppError) || error.statusCode !== 403) {
        throw error;
      }
      refused.push({
        definitionId: item.definitionId,
        apiKey: item.apiKey,
        scope: labelOf(scope),
        message: error.message,
      });
    }
  }
  if (refused.length > 0) {
    throw new AppError(
      403,
      'FORBIDDEN_SCOPE',
      'Your role does not allow some of these changes (shared definitions need schema permission on every site). Nothing was applied.',
      { items: refused },
    );
  }
};

const planActions = async (
  context: SchemaServiceContext,
  items: SyncResultItem[],
  locals: Map<string, LocalDefinition>,
): Promise<
  Map<string, { plan: ChangePlan; after: SchemaDefinition | null; expectedVersion: number | null }>
> => {
  // Every site's definitions: a shared change must leave every site's view valid.
  const active = scopedDefinitionsOf(context.snapshot.network.definitions);
  const siteKeys = await loadSiteKeys(context.db);
  const acting = items.filter((item) => ['create', 'update', 'delete'].includes(item.decision.action));
  // The whole resulting schema must be valid (references between files resolve together).
  const touched = new Set(acting.map((item) => item.definitionId));
  const scopes = new Map(acting.map((item) => [item.definitionId, scopeOfItem(context, item, locals)]));
  const proposed: ScopedDefinition[] = [
    ...active.filter((entry) => !touched.has(entry.definition.id)),
    ...acting.flatMap((item) => {
      const local = locals.get(item.definitionId);
      return local && item.decision.action !== 'delete'
        ? [{ definition: local.definition, siteId: scopes.get(item.definitionId) ?? null }]
        : [];
    }),
  ];
  const issues = validateScoped(proposed, [...scopes.values()], { siteKeys });
  if (issues.length > 0) {
    throw schemaInvalid(issues);
  }
  const plans = new Map<
    string,
    { plan: ChangePlan; after: SchemaDefinition | null; expectedVersion: number | null }
  >();
  for (const item of acting) {
    const remote = context.snapshot.byId.get(item.definitionId);
    const after =
      item.decision.action === 'delete' ? null : (locals.get(item.definitionId)?.definition ?? null);
    const siteId = scopes.get(item.definitionId) ?? null;
    const deleted = !remote ? await deletedDefinitionOf(context, item.definitionId, siteId) : undefined;
    const before = remote?.definition ?? deleted ?? null;
    const plan = buildChangePlan({
      before,
      after,
      fromVersion: remote?.version ?? null,
      // Plan against the proposed schema so cross-file references validate together.
      active: proposed
        .filter((entry) => entry.definition.id !== item.definitionId)
        .concat(remote ? [{ definition: remote.definition, siteId: remote.siteId }] : []),
      siteId,
      hasContent: before !== null,
      siteKeys,
    });
    if (!plan.summary.supported) {
      throw schemaChangeUnsupported(plan.changes.filter((change) => !change.supported));
    }
    item.plan = plan;
    plans.set(item.definitionId, { plan, after, expectedVersion: remote?.version ?? null });
  }
  return plans;
};

/**
 * The last revision of a deleted definition a file restores, in the scope it is restored to. A definition
 * deleted from another scope is refused (`SCOPE_MISMATCH`): sync never moves one.
 */
const deletedDefinitionOf = async (
  context: SchemaServiceContext,
  id: string,
  siteId: string | null,
): Promise<SchemaDefinition | undefined> => {
  const model = await schemaModelsRepository.findModelById(id, context.db);
  if (model && model.site_id !== siteId) {
    throw new AppError(
      409,
      'SCOPE_MISMATCH',
      'A file restores a deleted definition into another scope than it had',
      {
        items: [{ definitionId: id, local: labelOf(siteId), remote: labelOf(model.site_id) }],
      },
    );
  }
  const deleted = await schemaModelsRepository.findLatestRevision(id, context.db);
  return deleted ? readStoredDefinition(deleted.definition) : undefined;
};

/** A tree pulled for other sites only is not this site's to apply (`sites` lists what it covers). */
const assertLockCoversSite = (input: SyncApplyInput, siteKey: string | null) => {
  const sites = input.base.sites ?? [];
  if (siteKey !== null && sites.length > 0 && !sites.includes(siteKey)) {
    throw new AppError(
      409,
      'LOCK_SITE_MISMATCH',
      `These schema files were pulled for ${sites.map((key) => `"${key}"`).join(', ')}, not "${siteKey}". Apply them with --site, or pull this site first.`,
      { sites, site: siteKey },
    );
  }
};

export const applySchema = async (
  context: SchemaServiceContext,
  input: SyncApplyInput,
): Promise<SyncApplyResult> => {
  const siteId = context.snapshot.siteId;
  const siteKey = siteId === null ? null : ((await loadSiteKeys(context.db)).get(siteId) ?? null);
  assertLockCoversSite(input, siteKey);
  const locals = await parseLocalDefinitions(context, input);
  const items = decideAll(context, locals, baseForView(input, siteKey), input);
  if (items.some((item) => item.decision.action === 'conflict')) {
    throw conflictError(items);
  }
  const mismatches = scopeMismatches(context, items, locals);
  if (mismatches.length > 0) {
    throw scopeMismatchError(mismatches);
  }
  await authorizeActions(context, items, locals);
  const plans = await planActions(context, items, locals);
  if (input.dryRun) {
    return { schemaVersion: context.snapshot.version, dryRun: true, results: items };
  }
  assertAcknowledged(
    [...plans.values()].map((entry) => entry.plan),
    input,
  );

  const request = {
    actor: context.actor,
    ...(context.requestId ? { requestId: context.requestId } : {}),
    ...(context.ip ? { ip: context.ip } : {}),
  };
  const immediate = [...plans.values()].filter(
    (entry) => !entry.after || entry.plan.prerequisites.length === 0,
  );
  const planned = [...plans.values()].filter((entry) => entry.after && entry.plan.prerequisites.length > 0);
  let schemaVersion = context.snapshot.version;
  if (immediate.length > 0) {
    const results = await activateDefinitions(context.db, { items: immediate, ...request });
    for (const result of results) {
      const item = items.find((candidate) => candidate.definitionId === result.definitionId);
      if (item) {
        item.outcome = 'activated';
        item.version = result.version;
      }
      schemaVersion = result.schemaVersion;
    }
  }
  for (const entry of planned) {
    const change = await requestChange(context.db, {
      ...entry,
      after: entry.after as SchemaDefinition,
      ...request,
    });
    const item = items.find((candidate) => candidate.definitionId === entry.plan.definitionId);
    if (item) {
      item.outcome = 'pending';
      item.changeId = change.id;
    }
  }
  for (const item of items.filter((candidate) => !candidate.outcome)) {
    item.outcome = 'skipped';
  }
  return { schemaVersion, dryRun: false, results: items };
};
