import type { ContentIndexForm } from '../../../db/contentIndexForm.js';
import { mysqlContentDialect } from './mysql.js';
import { postgresContentDialect, postgresDocumentContainmentDialect } from './postgres.js';
import { sqliteContentDialect } from './sqlite.js';
import type { ContentDialectName, ContentSqlDialect } from './types.js';

export type { ContentDialectName, ContentSqlDialect } from './types.js';

const DIALECTS: Readonly<Record<ContentDialectName, ContentSqlDialect>> = {
  postgres: postgresDocumentContainmentDialect,
  sqlite: sqliteContentDialect,
  mysql: mysqlContentDialect,
};

/**
 * The content dialect of a database. `indexForm` only matters on PostgreSQL: which GIN index containment is
 * emitted for (`db/contentIndexForm.ts`). The default is `document`, right on every database; only a process
 * whose catalog read confirmed the filter form passes `filter` (`compiler/currentDialect.ts`).
 */
export const contentDialectFor = (
  name: ContentDialectName,
  indexForm: ContentIndexForm = 'document',
): ContentSqlDialect =>
  name === 'postgres' && indexForm === 'filter' ? postgresContentDialect : DIALECTS[name];
