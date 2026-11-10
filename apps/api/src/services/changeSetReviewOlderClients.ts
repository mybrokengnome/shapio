import {
  compileLens,
  lensDefinitionEffect,
  lensEffectOfChange,
  lensEffects,
  type ClassifiedChange,
  type LensEffect,
  type LensSide,
  type SchemaDefinition,
} from '@shapio/schema';
import type { Database } from '../db/index.js';
import { AppError } from '../helpers/appError.js';
import type { PermissionEvaluator, Principal } from '../permissions/types.js';
import * as schemaActivationStepsRepository from '../repositories/schemaActivationSteps.js';
import { loadRequestLens } from '../schema/lens/views.js';
import { buildSnapshot, type SchemaSnapshot } from '../schema/snapshot.js';
import { readStoredDefinition } from '../schema/storedDefinition.js';
import type { SiteRef } from './actorContext.js';
import {
  fieldHistoryOf,
  isWorse,
  worstOf,
  type FieldHistory,
  type HistoryStep,
} from './changeSetReviewHistory.js';
import { seesEverySite } from './networkScope.js';
import { schemaVersionReadersWithPins, type VersionReaderRow } from './usage.js';

/**
 * What clients that name an older schema version see after a proposed change (plan schema-lenses §6,
 * agreed 13): for each schema version API readers of the affected workspaces actually send
 * (`token_reads.last_schema_version`, the version each is on now), the lens from that version's definition to
 * the PROPOSED one, composite over every change between them, per field. Tokens pinned to a version are on it
 * whether or not they read yet. Shared by the change set review and the model builder's plan preview.
 */

/** Distinct schema versions a review compiles lenses for: the most recently used first. */
export const OLDER_CLIENT_VERSIONS_CAP = 8;
/**
 * Activation steps walked per definition and client version to find what happened to stored values; a longer
 * history reports the direct effect (shapes only) and `historyTruncated`.
 */
export const OLDER_CLIENT_HISTORY_STEPS_CAP = 16;

export type OlderClientReader = {
  /** The workspace the reads were made on. */
  site: SiteRef;
  /** `token:<id>`, `app_users` or `anonymous`. */
  principalKey: string;
  /** The token's name; null for app users, anonymous readers and deleted tokens. */
  label: string | null;
  /** The version is the token's pin, not one the client sends. */
  pinned: boolean;
  /** Null: a token pinned to the version that has not read since (a declared older client). */
  lastReadAt: Date | null;
};

export type OlderClientField = {
  fieldId: string;
  /** The field's API ID in the client's version. */
  apiKey: string;
  /**
   * What the client sees once the change is live: the worst of the shape it reads (the lens from its version
   * to the proposal) and what every activation since its version, and the proposal, did to stored values.
   */
  effect: LensEffect;
  /** The proposed change's own part: what it makes worse than today, by shape or on stored values. */
  proposedEffect: LensEffect;
  /** What the client already sees today (shape since its version, values activations dropped or cut). */
  pastEffect: LensEffect;
  /** The schema version since which `pastEffect` holds; null when it is transparent or not datable. */
  pastSince: number | null;
};

export type OlderClientDefinition = {
  definitionId: string;
  /** The definition's API ID in the client's version. */
  apiKey: string;
  /** `unavailable`: Shapio has no record of the definition at that version (reads of it answer 409). */
  status: 'available' | 'unavailable';
  /** The worst effect over its fields; null when unavailable. */
  effect: LensEffect | null;
  /** The oldest version reads of it work from, when unavailable. */
  oldestVersion: number | null;
  /** The client's fields that do not keep working unchanged (every other field reads as before). */
  fields: OlderClientField[];
  /**
   * The definition (or a component it holds) changed more than `OLDER_CLIENT_HISTORY_STEPS_CAP` times since
   * the version: what those steps did to stored values was not checked, and `effect` is the shape's alone.
   */
  historyTruncated: boolean;
};

export type OlderClientVersion = {
  schemaVersion: number;
  /** Readers on that version, in detail; null when the viewer may not see token names (`tokens.manage`). */
  readers: OlderClientReader[] | null;
  /** How many readers on that version the viewer sees in detail (with or without their names). */
  readerCount: number;
  /** Readers on workspaces the viewer does not see in detail; null when it sees every workspace. */
  otherSites: { consumers: number } | null;
  /** Each definition the change touches that the client's version knows. */
  definitions: OlderClientDefinition[];
};

export type OlderClientsReview = {
  /** Most recently used first, at most `OLDER_CLIENT_VERSIONS_CAP`. */
  versions: OlderClientVersion[];
  /** More versions are in use than the review compiled. */
  truncated: boolean;
};

export type OlderClientsInput = {
  db: Database;
  permissions: PermissionEvaluator;
  actor: Principal;
  /** The request's workspace view of the active schema. */
  current: SchemaSnapshot;
  /** The same view with the change applied. */
  proposed: SchemaSnapshot;
  /** The definitions the change touches. */
  definitionIds: readonly string[];
  /** The workspace the viewer reviews on. */
  siteId: string | null;
};

/** One definition replaced (or removed: `definition` null) in a proposed view. */
export type ProposedDefinition = {
  id: string;
  definition: SchemaDefinition | null;
  /** The per-model version the proposal becomes. */
  version: number;
  /** Where a new definition lands: its workspace, or null when shared. Existing ones keep their own. */
  siteId: string | null;
  revisionId: string;
};

/** The view with each proposal swapped in (deletions removed). */
export const proposedSnapshotWith = (
  snapshot: SchemaSnapshot,
  proposals: readonly ProposedDefinition[],
): SchemaSnapshot => {
  const byId = new Map(snapshot.definitions.map((entry) => [entry.definition.id, entry]));
  for (const proposal of proposals) {
    if (proposal.definition) {
      const existing = byId.get(proposal.id);
      byId.set(proposal.id, {
        definition: proposal.definition,
        // A shared definition stays shared (null is a scope, not a missing one).
        siteId: existing ? existing.siteId : proposal.siteId,
        version: proposal.version,
        revisionId: proposal.revisionId,
        hash: '',
        activatedAt: new Date(),
      });
    } else {
      byId.delete(proposal.id);
    }
  }
  return buildSnapshot(snapshot.version, [...byId.values()], snapshot.locales, snapshot.siteId);
};

/** What one change means for a client on the version before it, per change (the one-line wording). */
export const olderClientsEffectsOf = (changes: readonly ClassifiedChange[] | undefined): LensEffect[] =>
  (changes ?? []).map(lensEffectOfChange);

const sideOf = (view: SchemaSnapshot): LensSide => ({
  get: (id) => view.byId.get(id)?.definition,
  resolve: view.resolve,
});

/** The workspaces whose readers a change reaches: every one for a shared definition, else their own. */
const affectedSiteIds = (input: OlderClientsInput): string[] | undefined => {
  const sites = new Set<string>();
  for (const id of input.definitionIds) {
    const scope = input.current.scopeOf(id) ?? input.proposed.scopeOf(id);
    if (scope === null || scope === undefined) {
      return undefined;
    }
    sites.add(scope);
  }
  return [...sites];
};

type VersionReaders = { schemaVersion: number; lastReadAt: number; rows: VersionReaderRow[] };

const groupByVersion = (rows: readonly VersionReaderRow[], currentVersion: number) => {
  const versions = new Map<number, VersionReaders>();
  for (const row of rows) {
    // A version ahead of this view cannot have been served here (refused with SCHEMA_VERSION_AHEAD).
    if (row.schemaVersion > currentVersion) {
      continue;
    }
    const known = versions.get(row.schemaVersion);
    // A pinned token that has not read yet sorts after every version read from.
    const at = row.lastReadAt?.getTime() ?? 0;
    if (!known) {
      versions.set(row.schemaVersion, { schemaVersion: row.schemaVersion, lastReadAt: at, rows: [row] });
      continue;
    }
    known.rows.push(row);
    known.lastReadAt = Math.max(known.lastReadAt, at);
  }
  return [...versions.values()].sort(
    (a, b) => b.lastReadAt - a.lastReadAt || b.schemaVersion - a.schemaVersion,
  );
};

type Visibility = { siteId: string | null; network: boolean; names: boolean };

const readersOf = (rows: readonly VersionReaderRow[], visibility: Visibility) => {
  const detailed = visibility.network ? rows : rows.filter((row) => row.siteId === visibility.siteId);
  return {
    readers: visibility.names
      ? detailed.map((row) => ({
          site: { id: row.siteId, key: row.siteKey },
          principalKey: row.principalKey,
          label: row.tokenName,
          pinned: row.pinned,
          lastReadAt: row.lastReadAt,
        }))
      : null,
    readerCount: detailed.length,
    otherSites: visibility.network ? null : { consumers: rows.length - detailed.length },
  };
};

type ClientSide = { version: number; side: LensSide; lensFor?: (id: string) => unknown };

/** The client's side at a version: today's view for the current version, else the lens view. */
const clientSideAt = async (input: OlderClientsInput, version: number): Promise<ClientSide> => {
  // The review is admin work: never limited.
  const lens = await loadRequestLens(input.db, input.current, version, null);
  return lens
    ? { version, side: sideOf(lens.view), lensFor: lens.lensFor }
    : { version, side: sideOf(input.current) };
};

type DefinitionHistory = { fields: ReadonlyMap<string, FieldHistory>; truncated: boolean };

const NO_HISTORY: DefinitionHistory = { fields: new Map(), truncated: false };

/** The component IDs a definition's fields hold. */
const heldComponentIds = (definition: SchemaDefinition): Array<{ fieldId: string; ids: string[] }> =>
  definition.fields.flatMap((field) => {
    if (field.type === 'component') {
      return [{ fieldId: field.id, ids: [field.settings.component] }];
    }
    return field.type === 'dynamiczone' ? [{ fieldId: field.id, ids: [...field.settings.components] }] : [];
  });

/** A component's field histories folded into the field that holds it (worst effect, earliest date). */
const foldInto = (own: FieldHistory | undefined, held: readonly FieldHistory[]): FieldHistory => {
  let folded: FieldHistory = own ?? { past: 'transparent', pastSince: null, proposed: 'transparent' };
  for (const entry of held) {
    const past = worstOf(folded.past, entry.past);
    const since = [
      folded.past === past ? folded.pastSince : null,
      entry.past === past ? entry.pastSince : null,
    ]
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b)[0];
    folded = {
      past,
      pastSince: past === 'transparent' ? null : (since ?? null),
      proposed: worstOf(folded.proposed, entry.proposed),
    };
  }
  return folded;
};

/**
 * What activations since the client's version, and the proposal, did to the stored values of a definition's
 * fields (components it holds folded in), per field ID. Memoized per client version (`memo`).
 */
const historyOf = async (
  input: OlderClientsInput,
  client: ClientSide,
  definitionId: string,
  memo: Map<string, Promise<DefinitionHistory>>,
): Promise<DefinitionHistory> => {
  const known = memo.get(definitionId);
  if (known) {
    return known;
  }
  // Placeholder first, so a component that (invalidly) holds itself ends the recursion.
  memo.set(definitionId, Promise.resolve(NO_HISTORY));
  const loading = (async (): Promise<DefinitionHistory> => {
    const clientDefinition = client.side.get(definitionId);
    if (!clientDefinition) {
      return NO_HISTORY;
    }
    const rows = await schemaActivationStepsRepository.findStepsAfter(
      definitionId,
      client.version,
      input.current.version,
      OLDER_CLIENT_HISTORY_STEPS_CAP + 1,
      input.db,
    );
    if (rows.length > OLDER_CLIENT_HISTORY_STEPS_CAP) {
      return { fields: new Map(), truncated: true };
    }
    const steps: HistoryStep[] = rows.flatMap((row) =>
      // A deletion keeps the entries (restoring brings them back): no step for the values.
      row.revisionId === null || row.definition === null
        ? []
        : [{ schemaVersion: row.schemaVersion, definition: readStoredDefinition(row.definition) }],
    );
    const fields = new Map(
      fieldHistoryOf({
        client: clientDefinition,
        steps,
        current: input.current.byId.get(definitionId)?.definition ?? null,
        proposed: input.proposed.byId.get(definitionId)?.definition ?? null,
      }),
    );
    let truncated = false;
    for (const { fieldId, ids } of heldComponentIds(clientDefinition)) {
      const held: FieldHistory[] = [];
      for (const id of ids) {
        const component = await historyOf(input, client, id, memo);
        truncated ||= component.truncated;
        held.push(...component.fields.values());
      }
      if (held.length > 0) {
        fields.set(fieldId, foldInto(fields.get(fieldId), held));
      }
    }
    return { fields, truncated };
  })();
  memo.set(definitionId, loading);
  return loading;
};

/** Per field ID, what a lens from the client's version to `stored` shows. */
const shapeEffects = (stored: LensSide, client: LensSide, definitionId: string) => {
  const lens = compileLens(stored, client, definitionId);
  return new Map(lens ? lensEffects(lens).map((field) => [field.fieldId, field.effect]) : []);
};

const isUnavailable = (error: unknown): error is AppError =>
  error instanceof AppError && error.code === 'SCHEMA_VERSION_UNAVAILABLE';

const oldestVersionOf = (error: AppError): number | null => {
  const details = error.details as { oldestVersion?: unknown } | undefined;
  return typeof details?.oldestVersion === 'number' ? details.oldestVersion : null;
};

const definitionAt = async (
  input: OlderClientsInput,
  client: ClientSide,
  definitionId: string,
  memo: Map<string, Promise<DefinitionHistory>>,
): Promise<OlderClientDefinition | null> => {
  const known = client.side.get(definitionId);
  if (!known) {
    // Created since the client's version: nothing of it is in the client's shape.
    return null;
  }
  try {
    // Throws SCHEMA_VERSION_UNAVAILABLE when the history of the definition (or what it embeds) does not
    // reach the version.
    client.lensFor?.(definitionId);
  } catch (error) {
    if (!isUnavailable(error)) {
      throw error;
    }
    return {
      definitionId,
      apiKey: known.apiKey,
      status: 'unavailable',
      effect: null,
      oldestVersion: oldestVersionOf(error),
      fields: [],
      historyTruncated: false,
    };
  }
  const lens = compileLens(sideOf(input.proposed), client.side, definitionId);
  if (!lens) {
    return null;
  }
  const shapeNow = shapeEffects(sideOf(input.current), client.side, definitionId);
  const history = await historyOf(input, client, definitionId, memo);
  const definitionLevel = lens.status === 'gone' || lens.status === 'uncovered';
  const fields = lensEffects(lens).map(({ fieldId, effect: shapeAfter }): OlderClientField => {
    const apiKey = lens.fields.find((field) => field.fieldId === fieldId)?.apiKey ?? fieldId;
    if (definitionLevel) {
      return {
        fieldId,
        apiKey,
        effect: shapeAfter,
        proposedEffect: shapeAfter,
        pastEffect: 'transparent',
        pastSince: null,
      };
    }
    const now = shapeNow.get(fieldId) ?? 'transparent';
    const values = history.fields.get(fieldId);
    const pastValues = values?.past ?? 'transparent';
    const pastEffect = worstOf(now, pastValues);
    return {
      fieldId,
      apiKey,
      effect: worstOf(shapeAfter, pastValues, values?.proposed ?? 'transparent'),
      // Only what the proposal makes worse: a shape worse than today's, or what it does to stored values.
      proposedEffect: worstOf(
        isWorse(shapeAfter, now) ? shapeAfter : 'transparent',
        values?.proposed ?? 'transparent',
      ),
      pastEffect,
      // Dated by the step that reached it; a shape worse than any value loss is not dated.
      pastSince:
        pastEffect !== 'transparent' && pastValues === pastEffect ? (values?.pastSince ?? null) : null,
    };
  });
  return {
    definitionId,
    apiKey: lens.apiKey,
    status: 'available',
    effect: worstOf(lensDefinitionEffect(lens), ...fields.map((field) => field.effect)),
    oldestVersion: null,
    fields: fields.filter(
      (field) =>
        field.effect !== 'transparent' ||
        field.proposedEffect !== 'transparent' ||
        field.pastEffect !== 'transparent',
    ),
    historyTruncated: history.truncated,
  };
};

/**
 * The older clients of a proposed change: each schema version readers of the affected workspaces are on, with
 * who is on it (names only for `tokens.manage`; other workspaces as counts unless the viewer sees every
 * workspace) and the composite effect per definition and field. Bounded: at most
 * `OLDER_CLIENT_VERSIONS_CAP` versions, each compiled once per touched definition.
 */
export const olderClientsOf = async (input: OlderClientsInput): Promise<OlderClientsReview> => {
  if (input.definitionIds.length === 0) {
    return { versions: [], truncated: false };
  }
  const rows = await schemaVersionReadersWithPins(affectedSiteIds(input), { includeUnread: true }, input.db);
  const grouped = groupByVersion(rows, input.current.version);
  if (grouped.length === 0) {
    return { versions: [], truncated: false };
  }
  const visibility: Visibility = {
    siteId: input.siteId,
    network: seesEverySite(input.actor),
    names: await input.permissions.canPerform(input.actor, 'tokens.manage'),
  };
  const versions: OlderClientVersion[] = [];
  for (const group of grouped.slice(0, OLDER_CLIENT_VERSIONS_CAP)) {
    const client = await clientSideAt(input, group.schemaVersion);
    const memo = new Map<string, Promise<DefinitionHistory>>();
    const definitions: OlderClientDefinition[] = [];
    for (const id of input.definitionIds) {
      const definition = await definitionAt(input, client, id, memo);
      if (definition) {
        definitions.push(definition);
      }
    }
    versions.push({ schemaVersion: group.schemaVersion, ...readersOf(group.rows, visibility), definitions });
  }
  return { versions, truncated: grouped.length > OLDER_CLIENT_VERSIONS_CAP };
};
