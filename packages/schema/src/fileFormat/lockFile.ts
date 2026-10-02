import { Type, type Static } from 'typebox';
import { DEFINITION_KINDS } from '../types/definitions.js';
import { collectSchemaErrors } from '../validators/typeboxIssues.js';
import { canonicalJson } from './canonical.js';

/** Where `shapio schema pull` keeps its record of what it pulled, relative to the project root. */
export const LOCK_FILE_PATH = '.shapio/schema-lock.json';
export const LOCK_FILE_FORMAT_VERSION = 1;

export const LockEntrySchema = Type.Object(
  {
    kind: Type.Enum(DEFINITION_KINDS),
    apiKey: Type.String(),
    /** The definition's per-model version on the instance when it was pulled. */
    version: Type.Integer({ minimum: 1 }),
    /** `hashDefinition` of the pulled definition; a local file with another hash has been edited. */
    hash: Type.String(),
  },
  { additionalProperties: false },
);

export const LockFileSchema = Type.Object(
  {
    formatVersion: Type.Literal(LOCK_FILE_FORMAT_VERSION),
    /** The instance's global schema version at pull time (informational; the guard is per model). */
    schemaVersion: Type.Integer({ minimum: 0 }),
    /** Keyed by definition ID. */
    definitions: Type.Record(Type.String(), LockEntrySchema),
  },
  { additionalProperties: false },
);

export type LockEntry = Static<typeof LockEntrySchema>;
export type LockFile = Static<typeof LockFileSchema>;

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
