import type { DefinitionCategory } from '@shapio/client';
import {
  LOCK_FILE_FORMAT_VERSION,
  LOCK_FILE_PATH,
  serializeDefinition,
  serializeLockFile,
  type LockFile,
  type SchemaDefinition,
} from '@shapio/schema';
import type { SchemaExport } from '@/api/schemaFiles';

/**
 * The files `shapio schema pull` writes, built from the same export and serializer, so text copied from
 * here and files in a repository are byte-identical. `schema` is the CLI's default `--dir`
 * (`packages/cli/src/commands/schema/options.ts`), the lock file its default `--lock`.
 */
export const SCHEMA_DIR = 'schema';

/** What the file was loaded from: the definition's active version on the instance (the lock entry). */
export type FileBase = { version: number; hash: string; definition: SchemaDefinition; text: string };

export type SchemaFile = {
  path: string;
  definitionId: string;
  category: DefinitionCategory;
  apiKey: string;
  base: FileBase;
};

export const categoryOf = (definition: Pick<SchemaDefinition, 'kind'>): DefinitionCategory =>
  definition.kind === 'component' ? 'component' : 'model';

export const definitionFilePath = (definition: Pick<SchemaDefinition, 'kind' | 'apiKey'>) =>
  `${SCHEMA_DIR}/${definition.kind === 'component' ? 'components' : 'models'}/${definition.apiKey}.json`;

const CATEGORY_ORDER = { model: 0, component: 1 } as const satisfies Record<DefinitionCategory, number>;

/** One file per definition, models first, then components, each by path. */
export const buildFiles = (exported: SchemaExport): SchemaFile[] =>
  exported.definitions
    .map(({ definition, version, hash }) => ({
      path: definitionFilePath(definition),
      definitionId: definition.id,
      category: categoryOf(definition),
      apiKey: definition.apiKey,
      base: { version, hash, definition, text: serializeDefinition(definition) },
    }))
    .sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category] || a.path.localeCompare(b.path));

export const LOCK_PATH = LOCK_FILE_PATH;

/** The lock file pull records next to the files (formatVersion, schema version, per-definition base). */
export const buildLockFile = (exported: SchemaExport): LockFile => ({
  formatVersion: LOCK_FILE_FORMAT_VERSION,
  schemaVersion: exported.schemaVersion,
  definitions: Object.fromEntries(
    exported.definitions.map(({ definition, version, hash }) => [
      definition.id,
      { kind: definition.kind, apiKey: definition.apiKey, version, hash },
    ]),
  ),
});

export const buildLockText = (exported: SchemaExport): string => serializeLockFile(buildLockFile(exported));
