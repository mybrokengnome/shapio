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
export const LENS_HISTORY_BACKFILL_KEY = 'schema.lensHistoryBackfill:v1';

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

/** Each model's scope moves, oldest first. */
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
    moves.set(event.target_id, [...(moves.get(event.target_id) ?? []), { schemaVersion, from }]);
  }
  for (const list of moves.values()) {
    list.sort((a, b) => a.schemaVersion - b.schemaVersion);
  }
  return moves;
};

/**
 * The rows the audit log proves and the table lacks. A model's scope at a version is the scope its first
 * later move left, or its current scope when it never moved since. Rows of models that no longer exist,
 * and activations whose revision is gone, are skipped.
 */
export const activationsFromAudit = (input: {
  events: readonly HistoryAuditEvent[];
  /** `<modelId>:<version>` → revision ID. */
  revisions: ReadonlyMap<string, string>;
  /** Current scope of every model that still exists. */
  scopes: ReadonlyMap<string, string | null>;
  /** `<modelId>:<schemaVersion>` of the rows already there. */
  existing: ReadonlySet<string>;
}): NewSchemaActivation[] => {
  const { events, revisions, scopes, existing } = input;
  const moves = scopeMovesOf(events);
  const scopeAt = (modelId: string, schemaVersion: number, current: string | null) =>
    (moves.get(modelId) ?? []).find((move) => move.schemaVersion > schemaVersion)?.from ?? current;
  const rows = new Map<string, NewSchemaActivation>();
  for (const event of events) {
    const modelId = event.target_id;
    if (!modelId || !(ACTIVATION_ACTIONS as readonly string[]).includes(event.action)) {
      continue;
    }
    const metadata = metadataOf(event);
    const schemaVersion = integerOrNull(metadata.schemaVersion);
    const key = `${modelId}:${schemaVersion}`;
    if (schemaVersion === null || !scopes.has(modelId) || existing.has(key) || rows.has(key)) {
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

/** Inserts every row the audit log proves and the table lacks; running it again inserts nothing. */
export const backfillActivationHistory = async (db: Database): Promise<{ inserted: number }> => {
  const events = await auditEventsRepository.findSuccessfulByActions(
    [...ACTIVATION_ACTIONS, SCOPE_ACTION],
    db,
  );
  const modelIds = [...new Set(events.flatMap((event) => (event.target_id ? [event.target_id] : [])))];
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
  const rows = activationsFromAudit({
    events,
    revisions,
    scopes,
    existing: await schemaActivationsRepository.findKeys(db),
  });
  let inserted = 0;
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    inserted += await schemaActivationsRepository.insertMissing(rows.slice(start, start + INSERT_BATCH), db);
  }
  return { inserted };
};
