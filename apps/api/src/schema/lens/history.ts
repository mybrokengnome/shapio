import type { Database } from '../../db/index.js';
import * as auditEventsRepository from '../../repositories/auditEvents.js';
import * as schemaActivationsRepository from '../../repositories/schemaActivations.js';
import type { NewSchemaActivation } from '../../repositories/schemaActivations.js';

/**
 * Rebuilding activation history from the audit log (plan schema-lenses §1). Activation writes a
 * `schema_activations` row from 0.9.0 on; older history comes from the audit rows every activation has
 * written since 0.1.0: `schema.activate` and `schema.delete` name the model, its per-model version
 * (`toVersion`, null for a delete) and the global `schemaVersion`; `schema.scope` names the scope a model left
 * and the one it moved to.
 */
export const LENS_HISTORY_BACKFILL_JOB = 'schema.lensHistoryBackfill';
/** The migration enqueues the job under this key; its status says whether history is still being rebuilt. */
export const LENS_HISTORY_BACKFILL_KEY = 'schema.lensHistoryBackfill:v2';

const ACTIVATION_ACTIONS = ['schema.activate', 'schema.delete'] as const;
const SCOPE_ACTION = 'schema.scope';
const INSERT_BATCH = 500;

export type HistoryAuditEvent = {
  action: string;
  target_id: string | null;
  metadata: unknown;
  occurred_at: Date;
};

type ScopeMove = { schemaVersion: number; from: string | null };

const metadataOf = (event: HistoryAuditEvent): Record<string, unknown> => {
  const raw = typeof event.metadata === 'string' ? (JSON.parse(event.metadata) as unknown) : event.metadata;
  return raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
};

const integerOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) ? value : null;

/** `'network'` is shared (null); `{ siteId }` one workspace; anything else unknown (undefined). */
const scopeOf = (value: unknown): string | null | undefined => {
  if (value === 'network') {
    return null;
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { siteId?: unknown }).siteId === 'string'
  ) {
    return (value as { siteId: string }).siteId;
  }
  return undefined;
};

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * Each model's scope moves, oldest first. A family moves with its root: the root's audit row lists every
 * kind in `family` (since inheritance shipped), and each of them moved with it.
 */
const scopeMovesOf = (events: readonly HistoryAuditEvent[]): Map<string, ScopeMove[]> => {
  const moves = new Map<string, ScopeMove[]>();
  for (const event of events) {
    if (event.action !== SCOPE_ACTION || !event.target_id) {
      continue;
    }
    const metadata = metadataOf(event);
    const schemaVersion = integerOrNull(metadata.schemaVersion);
    const from = scopeOf(metadata.from);
    if (schemaVersion === null || from === undefined) {
      continue;
    }
    for (const modelId of new Set([event.target_id, ...stringsOf(metadata.family)])) {
      moves.set(modelId, [...(moves.get(modelId) ?? []), { schemaVersion, from }]);
    }
  }
  for (const list of moves.values()) {
    list.sort((a, b) => a.schemaVersion - b.schemaVersion);
  }
  return moves;
};

/**
 * The rows the audit log proves. A model's scope at a version is the scope its first later move left (null
 * when it left the shared scope), or its current scope when it never moved since. Rows of models that no
 * longer exist, activations whose revision is gone, and rows activation wrote itself (`protectedKeys`, never
 * replaced) are skipped.
 */
export const activationsFromAudit = (input: {
  events: readonly HistoryAuditEvent[];
  /** `<modelId>:<version>` → revision ID. */
  revisions: ReadonlyMap<string, string>;
  /** Current scope of every model that still exists. */
  scopes: ReadonlyMap<string, string | null>;
  /** `<modelId>:<schemaVersion>` of the rows activation wrote (not backfilled). */
  protectedKeys: ReadonlySet<string>;
}): NewSchemaActivation[] => {
  const { events, revisions, scopes, protectedKeys } = input;
  const moves = scopeMovesOf(events);
  const scopeAt = (modelId: string, schemaVersion: number, current: string | null) => {
    const next = (moves.get(modelId) ?? []).find((move) => move.schemaVersion > schemaVersion);
    return next === undefined ? current : next.from;
  };
  const rows = new Map<string, NewSchemaActivation>();
  for (const event of events) {
    const modelId = event.target_id;
    if (!modelId || !(ACTIVATION_ACTIONS as readonly string[]).includes(event.action)) {
      continue;
    }
    const metadata = metadataOf(event);
    const schemaVersion = integerOrNull(metadata.schemaVersion);
    const key = `${modelId}:${schemaVersion}`;
    if (schemaVersion === null || !scopes.has(modelId) || protectedKeys.has(key) || rows.has(key)) {
      continue;
    }
    let revisionId: string | null = null;
    if (event.action === 'schema.activate') {
      const toVersion = integerOrNull(metadata.toVersion);
      revisionId = toVersion === null ? null : (revisions.get(`${modelId}:${toVersion}`) ?? null);
      if (revisionId === null) {
        continue;
      }
    }
    rows.set(key, {
      modelId,
      schemaVersion,
      siteId: scopeAt(modelId, schemaVersion, scopes.get(modelId) ?? null),
      revisionId,
      backfilled: true,
      createdAt: event.occurred_at,
    });
  }
  return [...rows.values()];
};

/**
 * Writes every row the audit log proves: missing rows are inserted, and backfilled rows that disagree with
 * it (an earlier run's) are replaced. Rows activation wrote are never touched. Running it again changes
 * nothing.
 */
export const backfillActivationHistory = async (
  db: Database,
): Promise<{ inserted: number; replaced: number }> => {
  const events = await auditEventsRepository.findSuccessfulByActions(
    [...ACTIVATION_ACTIONS, SCOPE_ACTION],
    db,
  );
  const modelIds = [
    ...new Set(
      events.flatMap((event) => [
        ...(event.target_id ? [event.target_id] : []),
        ...stringsOf(metadataOf(event).family),
      ]),
    ),
  ];
  const revisions = new Map<string, string>();
  const scopes = new Map<string, string | null>();
  for (let start = 0; start < modelIds.length; start += INSERT_BATCH) {
    const batch = modelIds.slice(start, start + INSERT_BATCH);
    for (const revision of await schemaActivationsRepository.findRevisionVersions(batch, db)) {
      revisions.set(`${revision.modelId}:${revision.version}`, revision.id);
    }
    for (const [id, siteId] of await schemaActivationsRepository.findModelScopes(batch, db)) {
      scopes.set(id, siteId);
    }
  }
  const existing = new Map(
    (await schemaActivationsRepository.findAllRows(db)).map((row) => [
      `${row.modelId}:${row.schemaVersion}`,
      row,
    ]),
  );
  const proven = activationsFromAudit({
    events,
    revisions,
    scopes,
    protectedKeys: new Set([...existing].filter(([, row]) => !row.backfilled).map(([key]) => key)),
  });
  const changed = proven.filter((row) => {
    const known = existing.get(`${row.modelId}:${row.schemaVersion}`);
    return !known || known.siteId !== row.siteId || known.revisionId !== row.revisionId;
  });
  const replaced = changed.filter((row) => existing.has(`${row.modelId}:${row.schemaVersion}`)).length;
  for (let start = 0; start < changed.length; start += INSERT_BATCH) {
    await schemaActivationsRepository.replaceBackfilled(changed.slice(start, start + INSERT_BATCH), db);
  }
  return { inserted: changed.length - replaced, replaced };
};
