import {
  decideSync,
  diffDefinitions,
  foldApiKey,
  hashDefinition,
  parseDefinition,
  validateSchema,
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
import { readStoredDefinition } from '../schema/storedDefinition.js';
import {
  assertCanCreate,
  assertCanManage,
  filterReadable,
  type SchemaServiceContext,
} from './schemaAccess.js';
import { assertAcknowledged, type Acknowledgement } from './schemaDefinitions.js';

/**
 * `shapio schema pull` / `apply` over HTTP (ADR 0002). Apply is three-way per definition: the lock-file
 * base, the local file and the target's active revision. Any conflict refuses the whole apply (nothing
 * written) and returns the per-definition diff, like a rejected non-fast-forward push.
 */

export type ExportedDefinition = {
  definition: SchemaDefinition;
  version: number;
  hash: string;
};

export const exportSchema = async (context: SchemaServiceContext) => ({
  schemaVersion: context.snapshot.version,
  definitions: (await filterReadable(context, context.snapshot.definitions)).map(
    (entry): ExportedDefinition => ({
      definition: entry.definition,
      version: entry.version,
      hash: entry.hash,
    }),
  ),
});

export type SyncApplyInput = Acknowledgement & {
  definitions: readonly unknown[];
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

type LocalDefinition = { definition: SchemaDefinition; hash: string };

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
    });
  }
  if (issues.length > 0) {
    throw schemaInvalid(issues);
  }
  return locals;
};

const decideAll = (
  context: SchemaServiceContext,
  locals: Map<string, LocalDefinition>,
  input: SyncApplyInput,
) => {
  const ids = new Set([
    ...locals.keys(),
    ...Object.keys(input.base.definitions),
    ...context.snapshot.byId.keys(),
  ]);
  return [...ids].sort().map((id): SyncResultItem => {
    const local = locals.get(id);
    const base = input.base.definitions[id];
    const remote = context.snapshot.byId.get(id);
    const decision = decideSync({
      ...(local ? { local } : {}),
      ...(base ? { base: { version: base.version, hash: base.hash } } : {}),
      ...(remote
        ? { remote: { definition: remote.definition, version: remote.version, hash: remote.hash } }
        : {}),
      prune: input.prune,
    });
    const shown = local?.definition ?? remote?.definition;
    return {
      definitionId: id,
      apiKey: shown?.apiKey ?? base?.apiKey ?? id,
      kind: shown?.kind ?? base?.kind ?? 'collection',
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

const authorizeActions = async (context: SchemaServiceContext, items: readonly SyncResultItem[]) => {
  for (const item of items) {
    if (item.decision.action === 'create') {
      await assertCanCreate(context);
    } else if (item.decision.action === 'update' || item.decision.action === 'delete') {
      await assertCanManage(context, item.definitionId);
    }
  }
};

const planActions = async (
  context: SchemaServiceContext,
  items: SyncResultItem[],
  locals: Map<string, LocalDefinition>,
): Promise<
  Map<string, { plan: ChangePlan; after: SchemaDefinition | null; expectedVersion: number | null }>
> => {
  const active = context.snapshot.definitions.map((entry) => entry.definition);
  const acting = items.filter((item) => ['create', 'update', 'delete'].includes(item.decision.action));
  // The whole resulting schema must be valid (references between files resolve together).
  const touched = new Set(acting.map((item) => item.definitionId));
  const proposed = [
    ...active.filter((definition) => !touched.has(definition.id)),
    ...acting.flatMap((item) => {
      const local = locals.get(item.definitionId);
      return local && item.decision.action !== 'delete' ? [local.definition] : [];
    }),
  ];
  const issues = validateSchema(proposed);
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
    const deleted = !remote
      ? await schemaModelsRepository.findLatestRevision(item.definitionId, context.db)
      : undefined;
    const before = remote?.definition ?? (deleted ? readStoredDefinition(deleted.definition) : null);
    const plan = buildChangePlan({
      before,
      after,
      fromVersion: remote?.version ?? null,
      // Plan against the proposed schema so cross-file references validate together.
      active: proposed
        .filter((definition) => definition.id !== item.definitionId)
        .concat(remote ? [remote.definition] : []),
      hasContent: before !== null,
    });
    if (!plan.summary.supported) {
      throw schemaChangeUnsupported(plan.changes.filter((change) => !change.supported));
    }
    item.plan = plan;
    plans.set(item.definitionId, { plan, after, expectedVersion: remote?.version ?? null });
  }
  return plans;
};

export const applySchema = async (
  context: SchemaServiceContext,
  input: SyncApplyInput,
): Promise<SyncApplyResult> => {
  const locals = await parseLocalDefinitions(context, input);
  const items = decideAll(context, locals, input);
  if (items.some((item) => item.decision.action === 'conflict')) {
    throw conflictError(items);
  }
  await authorizeActions(context, items);
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
