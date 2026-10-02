import type { LocaleDefinition } from '@shapio/schema';
import type { Kysely, Transaction } from 'kysely';
import type { Database } from '../db/index.js';
import type { DB } from '../db/types.js';
import * as localesRepository from '../repositories/locales.js';
import type { LocaleRow } from '../repositories/locales.js';
import * as schemaModelsRepository from '../repositories/schemaModels.js';
import * as schemaVersionsRepository from '../repositories/schemaVersions.js';
import { buildSnapshot, type ActiveDefinition, type SchemaSnapshot } from './snapshot.js';
import { readStoredRevision } from './storedDefinition.js';

export const toLocaleDefinition = (row: LocaleRow): LocaleDefinition => ({
  code: row.code,
  label: row.label,
  isDefault: row.is_default,
  fallbacks: row.fallbacks,
});

export const toActiveDefinition = async (
  row: schemaModelsRepository.ActiveDefinitionRow,
): Promise<ActiveDefinition> => ({
  ...(await readStoredRevision(row.definition, row.hash)),
  version: row.version,
  revisionId: row.revisionId,
  activatedAt: row.activatedAt,
});

export const toActiveDefinitions = (
  rows: readonly schemaModelsRepository.ActiveDefinitionRow[],
): Promise<ActiveDefinition[]> => Promise.all(rows.map(toActiveDefinition));

/** The schema as the executor sees it (inside an activation transaction: the state right after the flip). */
export const readSnapshot = async (executor: Kysely<DB> | Transaction<DB>): Promise<SchemaSnapshot> => {
  const version = await schemaVersionsRepository.getSchemaVersion(executor);
  const rows = await schemaModelsRepository.findActiveDefinitions(executor);
  const locales = await localesRepository.list(executor);
  return buildSnapshot(version, await toActiveDefinitions(rows), locales.map(toLocaleDefinition));
};

/**
 * Reads the global version, every active definition and the locales in one REPEATABLE READ transaction,
 * so the snapshot is exactly the state at that version even if an activation commits meanwhile.
 */
export const loadSnapshot = (db: Database): Promise<SchemaSnapshot> =>
  db
    .transaction()
    .setIsolationLevel('repeatable read')
    .setAccessMode('read only')
    .execute((trx) => readSnapshot(trx));
