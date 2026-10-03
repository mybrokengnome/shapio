import { isMysql } from './dialect.js';

/**
 * InnoDB allows 64 secondary indexes per table. `entry_heads` has 4 of its own (foreign keys, change
 * sequence, model/locale/state) and 4 stay spare for an index layout rebuild, where a field's old and new
 * index exist together for a moment. On MySQL every filterable or sortable field of every model is one
 * index on that table (there are no partial indexes), so the instance-wide total is capped (ADR 0001,
 * "MySQL"); PostgreSQL and SQLite have no such limit.
 */
export const MYSQL_MAX_FIELD_INDEXES = 56;

/** The most filterable or sortable fields the database can index, or undefined without a limit. */
export const maxFieldIndexes = (): number | undefined => (isMysql() ? MYSQL_MAX_FIELD_INDEXES : undefined);
