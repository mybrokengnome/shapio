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
/** Rows read per page (audit rows, history rows): memory stays bounded by the compact facts kept. */
const READ_PAGE = 1000;

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
 * What the backfill keeps of one audit row: the compact facts, never the row's metadata (which can be large).
 * `modelIds`: the target, plus every kind of a family that moved with its root (`schema.scope`).
 */
export type CompactHistoryEvent =
  | {
      kind: 'activate' | 'delete';
      modelId: string;
      schemaVersion: number;
      toVersion: number | null;
      at: Date;
    }
  | { kind: 'scope'; modelIds: readonly string[]; schemaVersion: number; from: string | null };

/** The compact facts of one audit row; null when it proves nothing (no target, no version, unknown scope). */
export const compactHistoryEvent = (event: HistoryAuditEvent): CompactHistoryEvent | null => {
  if (!event.target_id) {
    return null;
  }
  const metadata = metadataOf(event);
  const schemaVersion = integerOrNull(metadata.schemaVersion);
  if (schemaVersion === null) {
    return null;
  }
  if (event.action === SCOPE_ACTION) {
    const from = scopeOf(metadata.from);
    return from === undefined
      ? null
      : {
          kind: 'scope',
          modelIds: [...new Set([event.target_id, ...stringsOf(metadata.family)])],
          schemaVersion,
          from,
        };
  }
  if (!(ACTIVATION_ACTIONS as readonly string[]).includes(event.action)) {
    return null;
  }
  return {
    kind: event.action === 'schema.activate' ? 'activate' : 'delete',
    modelId: event.target_id,
    schemaVersion,
    toVersion: integerOrNull(metadata.toVersion),
    at: event.occurred_at,
  };
};

/**
 * Each model's scope moves, oldest first. A family moves with its root: the root's audit row lists every
 * kind in `family` (since inheritance shipped), and each of them moved with it.
 */
const scopeMovesOf = (events: readonly CompactHistoryEvent[]): Map<string, ScopeMove[]> => {
  const moves = new Map<string, ScopeMove[]>();
  for (const event of events) {
    if (event.kind !== 'scope') {
      continue;
    }
    for (const modelId of event.modelIds) {
      moves.set(modelId, [
        ...(moves.get(modelId) ?? []),
        { schemaVersion: event.schemaVersion, from: event.from },
      ]);
    }
  }
  for (const list of moves.values()) {
    list.sort((a, b) => a.schemaVersion - b.schemaVersion);
  }
  return moves;
};

type ProofInput = {
  /** `<modelId>:<version>` → revision ID. */
  revisions: ReadonlyMap<string, string>;
  /** Current scope of every model that still exists. */
  scopes: ReadonlyMap<string, string | null>;
  /** `<modelId>:<schemaVersion>` of the rows activation wrote (not backfilled). */
  protectedKeys: ReadonlySet<string>;
};

/**
 * The rows compact audit facts prove. A model's scope at a version is the scope its first later move left
 * (null when it left the shared scope), or its current scope when it never moved since. Rows of models that
 * no longer exist, activations whose revision is gone, and rows activation wrote itself (`protectedKeys`,
 * never replaced) are skipped.
 */
export const activationsFromCompact = (
  events: readonly CompactHistoryEvent[],
  { revisions, scopes, protectedKeys }: ProofInput,
): NewSchemaActivation[] => {
  const moves = scopeMovesOf(events);
  const scopeAt = (modelId: string, schemaVersion: number, current: string | null) => {
    const next = (moves.get(modelId) ?? []).find((move) => move.schemaVersion > schemaVersion);
    return next === undefined ? current : next.from;
  };
  const rows = new Map<string, NewSchemaActivation>();
  for (const event of events) {
    if (event.kind === 'scope') {
      continue;
    }
    const { modelId, schemaVersion } = event;
    const key = `${modelId}:${schemaVersion}`;
    if (!scopes.has(modelId) || protectedKeys.has(key) || rows.has(key)) {
      continue;
    }
    let revisionId: string | null = null;
    if (event.kind === 'activate') {
      revisionId = event.toVersion === null ? null : (revisions.get(`${modelId}:${event.toVersion}`) ?? null);
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
      createdAt: event.at,
    });
  }
  return [...rows.values()];
};

/** `activationsFromCompact` over raw audit rows. */
export const activationsFromAudit = (input: ProofInput & { events: readonly HistoryAuditEvent[] }) =>
  activationsFromCompact(
    input.events.flatMap((event) => compactHistoryEvent(event) ?? []),
    input,
  );

/** The compact facts of every successful schema audit row, read a page at a time (keyset on `seq`). */
const readCompactEvents = async (db: Database): Promise<CompactHistoryEvent[]> => {
  const events: CompactHistoryEvent[] = [];
  let after: string | null = null;
  for (;;) {
    const page = await auditEventsRepository.findSuccessfulByActionsPage(
      [...ACTIVATION_ACTIONS, SCOPE_ACTION],
      { afterSeq: after, limit: READ_PAGE },
      db,
    );
    events.push(...page.flatMap((row) => compactHistoryEvent(row) ?? []));
    if (page.length < READ_PAGE) {
      return events;
    }
    after = String((page[page.length - 1] as (typeof page)[number]).seq);
  }
};

type ExistingRow = { siteId: string | null; revisionId: string | null; backfilled: boolean };

/** Every history row as compact facts, by `<modelId>:<schemaVersion>`, read a page at a time. */
const readExistingRows = async (db: Database): Promise<Map<string, ExistingRow>> => {
  const rows = new Map<string, ExistingRow>();
  let after: { modelId: string; schemaVersion: number } | null = null;
  for (;;) {
    const page = await schemaActivationsRepository.findRowsPage(after, READ_PAGE, db);
    for (const row of page) {
      rows.set(`${row.modelId}:${row.schemaVersion}`, {
        siteId: row.siteId,
        revisionId: row.revisionId,
        backfilled: row.backfilled,
      });
    }
    const last = page[page.length - 1];
    if (page.length < READ_PAGE || !last) {
      return rows;
    }
    after = { modelId: last.modelId, schemaVersion: last.schemaVersion };
  }
};

/**
 * Writes every row the audit log proves: missing rows are inserted, and backfilled rows that disagree with
 * it (an earlier run's) are replaced. Rows activation wrote are never touched. Every write happens in one
 * transaction (the rows are the instance's past activations: few), so a lensed read sees history either as
 * the migration left it or complete, never half rebuilt; a run that fails changes nothing and the job
 * retries. Running it again changes nothing.
 */
export const backfillActivationHistory = async (
  db: Database,
): Promise<{ inserted: number; replaced: number }> => {
  const events = await readCompactEvents(db);
  const modelIds = [
    ...new Set(events.flatMap((event) => (event.kind === 'scope' ? event.modelIds : [event.modelId]))),
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
  const existing = await readExistingRows(db);
  const proven = activationsFromCompact(events, {
    revisions,
    scopes,
    protectedKeys: new Set([...existing].filter(([, row]) => !row.backfilled).map(([key]) => key)),
  });
  const changed = proven.filter((row) => {
    const known = existing.get(`${row.modelId}:${row.schemaVersion}`);
    return !known || known.siteId !== row.siteId || known.revisionId !== row.revisionId;
  });
  const replaced = changed.filter((row) => existing.has(`${row.modelId}:${row.schemaVersion}`)).length;
  await db.transaction().execute(async (trx) => {
    for (let start = 0; start < changed.length; start += INSERT_BATCH) {
      await schemaActivationsRepository.replaceBackfilled(changed.slice(start, start + INSERT_BATCH), trx);
    }
  });
  return { inserted: changed.length - replaced, replaced };
};
