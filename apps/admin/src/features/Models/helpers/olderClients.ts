import type {
  FieldConsumers,
  LensEffect,
  OlderClientReader,
  OlderClients,
  OlderClientVersion,
} from '@shapio/client';
import { LENS_EFFECTS, type ClassifiedChange } from '@shapio/schema';
import type { StatusTone } from '@/components/StatusChip';

/**
 * What clients that name an older schema version see after a change (plan schema-lenses), for the change
 * set review and the builder's review sheet. The server reports the per-change effect (`olderClientsEffects`)
 * and, for each version readers actually send, the composite effect per field (`olderClients`).
 */

/** The sentence under a breaking change line. */
export const OLDER_CLIENTS_LINE_KEYS = {
  transparent: 'olderClients.lines.transparent',
  converted: 'olderClients.lines.converted',
  lossy: 'olderClients.lines.lossy',
  nulled: 'olderClients.lines.nulled',
  gone: 'olderClients.lines.gone',
  uncovered: 'olderClients.lines.uncovered',
} as const satisfies Record<LensEffect, string>;

/** What a reader sees, or `unavailable` when there is no record of its version for the content type. */
export type ReaderOutcome = LensEffect | 'unavailable';

export const READER_OUTCOME_DISPLAY = {
  transparent: { labelKey: 'olderClients.chips.transparent', tone: 'success' },
  converted: { labelKey: 'olderClients.chips.converted', tone: 'success' },
  lossy: { labelKey: 'olderClients.chips.lossy', tone: 'warning' },
  nulled: { labelKey: 'olderClients.chips.nulled', tone: 'warning' },
  gone: { labelKey: 'olderClients.chips.gone', tone: 'danger' },
  uncovered: { labelKey: 'olderClients.chips.uncovered', tone: 'danger' },
  unavailable: { labelKey: 'olderClients.chips.unavailable', tone: 'muted' },
} as const satisfies Record<ReaderOutcome, { labelKey: string; tone: StatusTone }>;

const rank = (effect: LensEffect) => LENS_EFFECTS.indexOf(effect);

/** The worst of several effects (`transparent` for none). */
export const worstEffect = (effects: readonly LensEffect[]): LensEffect =>
  effects.reduce<LensEffect>((worst, effect) => (rank(effect) > rank(worst) ? effect : worst), 'transparent');

/** Keeps working (as is, or with values converted): the reader is protected by naming its version. */
export const isProtectedEffect = (effect: LensEffect | null): boolean =>
  effect === 'transparent' || effect === 'converted';

/** A change worth an older-clients line: one that breaks the API contract or drops data. */
export const showsOlderClients = (change: Pick<ClassifiedChange, 'breaking' | 'destructive'>): boolean =>
  change.breaking || change.destructive;

/**
 * What clients on an older version see for one change: for a field change, the worst composite effect on
 * that field over the versions readers send (a field a version reads unchanged keeps working); otherwise, or
 * when no reader sends a version, the change's own effect.
 */
export const changeOlderClientsEffect = (
  change: Pick<ClassifiedChange, 'fieldId'>,
  ownEffect: LensEffect | undefined,
  definitionId: string,
  olderClients: OlderClients | null | undefined,
): LensEffect | null => {
  const versions = olderClients?.versions ?? [];
  if (!change.fieldId || versions.length === 0) {
    return ownEffect ?? null;
  }
  const definitions = versions.flatMap((version) =>
    version.definitions.filter(
      (definition) => definition.definitionId === definitionId && definition.status === 'available',
    ),
  );
  if (definitions.length === 0) {
    return ownEffect ?? null;
  }
  return worstEffect(
    definitions.flatMap((definition) =>
      definition.fields.filter((field) => field.fieldId === change.fieldId).map((field) => field.effect),
    ),
  );
};

/**
 * What a reader on `version` sees: the worst effect on the fields it reads (`fieldIds`, from usage), or on
 * every changed field when its reads are not known; `unavailable` when there is no record of its version for
 * a content type it reads.
 */
export const readerOutcome = (
  version: OlderClientVersion,
  fieldIds: ReadonlySet<string> | null,
): ReaderOutcome => {
  if (version.definitions.some((definition) => definition.status === 'unavailable')) {
    return 'unavailable';
  }
  return worstEffect(
    version.definitions.flatMap((definition) =>
      definition.effect === 'gone' || definition.effect === 'uncovered'
        ? [definition.effect]
        : definition.fields
            .filter((field) => fieldIds === null || fieldIds.has(field.fieldId))
            .map((field) => field.effect),
    ),
  );
};

/** The versions readers send, split by whether their readers keep working once the change is live. */
export const versionProtection = (
  olderClients: OlderClients | null | undefined,
): { protectedVersions: number[]; unprotectedVersions: number[] } => {
  const versions = olderClients?.versions ?? [];
  const outcomes = versions.map((version) => ({
    schemaVersion: version.schemaVersion,
    outcome: readerOutcome(version, null),
  }));
  const sorted = (list: typeof outcomes) => list.map((entry) => entry.schemaVersion).sort((a, b) => a - b);
  return {
    protectedVersions: sorted(
      outcomes.filter(({ outcome }) => outcome !== 'unavailable' && isProtectedEffect(outcome)),
    ),
    unprotectedVersions: sorted(
      outcomes.filter(({ outcome }) => outcome === 'unavailable' || !isProtectedEffect(outcome)),
    ),
  };
};

/** Each change of a plan with what clients on an older version see; null for changes that need no line. */
export const olderClientsEffectsByChange = (
  changes: readonly ClassifiedChange[],
  ownEffects: readonly LensEffect[] | undefined,
  definitionId: string,
  olderClients: OlderClients | null | undefined,
): ReadonlyMap<ClassifiedChange, LensEffect | null> =>
  new Map(
    changes.map((change, index) => [
      change,
      showsOlderClients(change)
        ? changeOlderClientsEffect(change, ownEffects?.[index], definitionId, olderClients)
        : null,
    ]),
  );

/** A Consumers tab row: one reader on an older version, or the readers of a version without their names. */
export type OlderReaderRow = {
  key: string;
  schemaVersion: number;
  /** A named reader; null for a row that counts readers (`count`) the viewer may not see by name. */
  reader: OlderClientReader | null;
  count: number;
  /** Readers on other workspaces, counted, when the row stands for them. */
  otherSites: boolean;
  outcome: ReaderOutcome;
};

/** The breaking fields each reader read, from the review's consumers: `<workspace ID>:<principal key>`. */
export const fieldsReadByReader = (
  consumers: readonly FieldConsumers[],
): ReadonlyMap<string, ReadonlySet<string>> => {
  const reads = new Map<string, Set<string>>();
  for (const field of consumers) {
    for (const consumer of field.consumers) {
      const key = `${consumer.site.id}:${consumer.principalKey}`;
      reads.set(key, (reads.get(key) ?? new Set()).add(field.fieldId));
    }
  }
  return reads;
};

/**
 * The Consumers tab's rows for readers on older schema versions: per named reader, what it sees for the
 * breaking fields it read (every changed field when its reads are not in the window); readers the viewer
 * may not name, and those on other workspaces, as one counted row per version.
 */
export const olderReaderRows = (
  olderClients: OlderClients | null | undefined,
  consumers: readonly FieldConsumers[],
): OlderReaderRow[] => {
  const reads = fieldsReadByReader(consumers);
  return (olderClients?.versions ?? []).flatMap((version) => {
    const named: OlderReaderRow[] = (version.readers ?? []).map((reader) => ({
      key: `${version.schemaVersion}:${reader.site.id}:${reader.principalKey}`,
      schemaVersion: version.schemaVersion,
      reader,
      count: 1,
      otherSites: false,
      outcome: readerOutcome(version, reads.get(`${reader.site.id}:${reader.principalKey}`) ?? null),
    }));
    const counted: OlderReaderRow[] =
      version.readers === null && version.readerCount > 0
        ? [
            {
              key: `${version.schemaVersion}:count`,
              schemaVersion: version.schemaVersion,
              reader: null,
              count: version.readerCount,
              otherSites: false,
              outcome: readerOutcome(version, null),
            },
          ]
        : [];
    const others: OlderReaderRow[] =
      version.otherSites && version.otherSites.consumers > 0
        ? [
            {
              key: `${version.schemaVersion}:other`,
              schemaVersion: version.schemaVersion,
              reader: null,
              count: version.otherSites.consumers,
              otherSites: true,
              outcome: readerOutcome(version, null),
            },
          ]
        : [];
    return [...named, ...counted, ...others];
  });
};
