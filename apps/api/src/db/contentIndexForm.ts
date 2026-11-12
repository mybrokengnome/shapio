/**
 * Which GIN index serves equality containment on PostgreSQL (ADR 0001, "Filter data"), so the compiler emits
 * the containment that index covers:
 * - `document`: `data @> $1`, served by `entry_heads_data_gin` on the whole `data` while it exists. The default
 *   of every process, and correct on every database: it never depends on `filter_data`.
 * - `filter`: `filter_data @> $1`, served by `entry_heads_filter_data_gin` on `filter_data`
 *   (`shapio_scalar_fields(data)`, kept by a trigger). A process uses it only after a catalog read confirmed that
 *   the check `entry_heads_filter_data_present` is validated and the index is valid (`db/contentFilterIndex.ts`,
 *   the only code that switches a process to it).
 * Both answer the same rows for every document the compiler emits, so the form only decides which index the
 * planner can use, never what a query answers, once the column is complete; before that only `document` is
 * right. Process-wide, like the dialect (`db/dialect.ts`). SQLite and MySQL never read it.
 */
export type ContentIndexForm = 'document' | 'filter';
