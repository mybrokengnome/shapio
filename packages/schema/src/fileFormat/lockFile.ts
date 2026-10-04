import { Type, type Static } from 'typebox';
import { DEFINITION_KINDS, type SchemaDefinition } from '../types/definitions.js';
import { collectSchemaErrors } from '../validators/typeboxIssues.js';
import { canonicalJson } from './canonical.js';

/** Where `shapio schema pull` keeps its record of what it pulled, relative to the project root. */
export const LOCK_FILE_PATH = '.shapio/schema-lock.json';
/**
 * Format 2 (per-site schemas): each entry records its scope (`site`: a site key, or null when shared) and
 * the lock lists the sites the tree covers. Format 1 (every definition shared) still reads: its entries
 * have no `site`, which means shared, and it covers no site. `upgradeLockFile` spells both the same way.
 */
export const LOCK_FILE_FORMAT_VERSION = 2;

export const LockEntrySchema = Type.Object(
  {
    kind: Type.Enum(DEFINITION_KINDS),
    apiKey: Type.String(),
    /** The definition's per-model version on the instance when it was pulled. */
    version: Type.Integer({ minimum: 1 }),
    /** `hashDefinition` of the pulled definition; a local file with another hash has been edited. */
    hash: Type.String(),
    /**
     * The key of the site the definition belongs to; null (or absent, format 1) when shared. Null comes first:
     * Fastify's Ajv coerces types, and a string branch tried first would turn null into "" (no site at all).
     */
    site: Type.Optional(Type.Union([Type.Null(), Type.String()])),
  },
  { additionalProperties: false },
);

export const LockFileSchema = Type.Object(
  {
    formatVersion: Type.Union([Type.Literal(1), Type.Literal(LOCK_FILE_FORMAT_VERSION)]),
    /** The instance's global schema version at pull time (informational; the guard is per model). */
    schemaVersion: Type.Integer({ minimum: 0 }),
    /** Keys of the sites whose definitions this tree holds (format 2; absent: none, shared only). */
    sites: Type.Optional(Type.Array(Type.String())),
    /** Keyed by definition ID. */
    definitions: Type.Record(Type.String(), LockEntrySchema),
  },
  { additionalProperties: false },
);

export type LockEntry = Static<typeof LockEntrySchema>;
export type LockFile = Static<typeof LockFileSchema>;

/** A lock in format 2 with every scope spelled out. */
export type ScopedLockEntry = LockEntry & { site: string | null };
export type ScopedLockFile = Omit<LockFile, 'formatVersion' | 'sites' | 'definitions'> & {
  formatVersion: typeof LOCK_FILE_FORMAT_VERSION;
  sites: string[];
  definitions: Record<string, ScopedLockEntry>;
};

/** Format 1 or 2 → format 2: absent scopes are shared, absent sites none. */
export const upgradeLockFile = (lock: LockFile): ScopedLockFile => ({
  formatVersion: LOCK_FILE_FORMAT_VERSION,
  schemaVersion: lock.schemaVersion,
  sites: [...(lock.sites ?? [])],
  definitions: Object.fromEntries(
    Object.entries(lock.definitions).map(([id, entry]) => [id, { ...entry, site: entry.site ?? null }]),
  ),
});

/** The lock entries one site's tree is about: the shared definitions and that site's (`siteKey`). */
export const lockEntriesForSite = (lock: LockFile, siteKey: string | null): LockFile['definitions'] =>
  Object.fromEntries(
    Object.entries(lock.definitions).filter(
      ([, entry]) => (entry.site ?? null) === null || entry.site === siteKey,
    ),
  );

/** A tree applies to a site when it covers no site yet (shared only, or format 1) or lists that site. */
export const lockCoversSite = (lock: LockFile, siteKey: string): boolean => {
  const sites = lock.sites ?? [];
  return sites.length === 0 || sites.includes(siteKey);
};

/** `sites` plus `siteKey`, sorted and without duplicates (stable diffs in git). */
export const withSiteCovered = (sites: readonly string[], siteKey: string): string[] =>
  [...new Set([...sites, siteKey])].sort();

/**
 * The lock after pulling one site's view (`shapio schema pull --site <siteKey>`): the shared entries and that
 * site's are replaced by what was pulled, another site's entries are kept as they are (one tree can hold
 * several sites), and the tree now covers `siteKey`. A format 1 lock upgrades first (every entry shared).
 */
export const mergePulledLock = (
  lock: LockFile | undefined,
  pulled: { schemaVersion: number; siteKey: string; definitions: readonly ExportedDefinition[] },
): ScopedLockFile => {
  const current = lock ? upgradeLockFile(lock) : undefined;
  const pulledIds = new Set(pulled.definitions.map(({ definition }) => definition.id));
  const kept = Object.entries(current?.definitions ?? {}).filter(
    ([id, entry]) => entry.site !== null && entry.site !== pulled.siteKey && !pulledIds.has(id),
  );
  return {
    formatVersion: LOCK_FILE_FORMAT_VERSION,
    schemaVersion: pulled.schemaVersion,
    sites: withSiteCovered(current?.sites ?? [], pulled.siteKey),
    definitions: Object.fromEntries([
      ...kept,
      ...pulled.definitions.map(({ definition, version, hash, site }): [string, ScopedLockEntry] => [
        definition.id,
        { kind: definition.kind, apiKey: definition.apiKey, version, hash, site },
      ]),
    ]),
  };
};

/** One definition as `schema export` returns it, with its scope (a site key, or null when shared). */
export type ExportedDefinition = {
  definition: SchemaDefinition;
  version: number;
  hash: string;
  site: string | null;
};

export class LockFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockFileError';
  }
}

export const parseLockFile = (text: string): LockFile => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LockFileError(`${LOCK_FILE_PATH} is not valid JSON`);
  }
  const errors = collectSchemaErrors(LockFileSchema, parsed);
  if (errors.length > 0) {
    throw new LockFileError(
      `${LOCK_FILE_PATH} is invalid: ${errors.map((error) => `${error.path || '/'} ${error.message}`).join('; ')}`,
    );
  }
  return parsed as LockFile;
};

export const serializeLockFile = (lock: LockFile): string => canonicalJson(lock);
