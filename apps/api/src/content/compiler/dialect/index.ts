import type { ContentIndexForm } from '../../../db/contentIndexForm.js';
import { mysqlContentDialect } from './mysql.js';
import { postgresContentDialect, postgresDocumentContainmentDialect } from './postgres.js';
import { sqliteContentDialect } from './sqlite.js';
import type { ContentDialectName, ContentSqlDialect } from './types.js';

export type { ContentDialectName, ContentSqlDialect } from './types.js';

const DIALECTS: Readonly<Record<ContentDialectName, ContentSqlDialect>> = {
  postgres: postgresContentDialect,
  sqlite: sqliteContentDialect,
  mysql: mysqlContentDialect,
};

/**
 * The content dialect of a database. `indexForm` only matters on PostgreSQL: which GIN index containment is
 * emitted for (`db/contentIndexForm.ts`).
 */
export const contentDialectFor = (
  name: ContentDialectName,
  indexForm: ContentIndexForm = 'filter',
): ContentSqlDialect =>
  name === 'postgres' && indexForm === 'document' ? postgresDocumentContainmentDialect : DIALECTS[name];
