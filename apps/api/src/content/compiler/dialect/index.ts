import { mysqlContentDialect } from './mysql.js';
import { postgresContentDialect } from './postgres.js';
import { sqliteContentDialect } from './sqlite.js';
import type { ContentDialectName, ContentSqlDialect } from './types.js';

export type { ContentDialectName, ContentSqlDialect } from './types.js';

const DIALECTS: Readonly<Record<ContentDialectName, ContentSqlDialect>> = {
  postgres: postgresContentDialect,
  sqlite: sqliteContentDialect,
  mysql: mysqlContentDialect,
};

export const contentDialectFor = (name: ContentDialectName): ContentSqlDialect => DIALECTS[name];
