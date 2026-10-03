import { currentDialect } from '../../db/dialect.js';
import { contentDialectFor } from './dialect/index.js';
import type { ContentSqlDialect } from './dialect/types.js';

/**
 * The content dialect of this process's database (`db/dialect.ts`, chosen from `DATABASE_URL`). Every
 * compiler function takes a dialect as an optional last argument that defaults to this one.
 */
export const contentDialect = (): ContentSqlDialect => contentDialectFor(currentDialect());
