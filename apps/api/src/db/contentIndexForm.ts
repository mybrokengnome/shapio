/**
 * Which GIN index serves equality containment on PostgreSQL (ADR 0001, "Filter data"), so the compiler emits
 * the containment that index covers:
 * - `filter`: `entry_heads_filter_data_gin` on `filter_data` (`shapio_scalar_fields(data)`, kept by a trigger),
 *   which holds only the top-level values a containment can match (the default, and every fresh install);
 * - `document`: `entry_heads_data_gin` on the whole `data`, until an upgraded instance has filled the column,
 *   proved it complete and built the new index.
 * Both answer the same rows for every document the compiler emits, so this only decides which index the planner
 * can use, never what a query answers. Set by `db/contentFilterIndex.ts` from the catalog. Process-wide, like
 * the dialect (`db/dialect.ts`). SQLite and MySQL never read it.
 */
export type ContentIndexForm = 'document' | 'filter';

let form: ContentIndexForm = 'filter';

export const contentIndexForm = (): ContentIndexForm => form;

export const setContentIndexForm = (next: ContentIndexForm): void => {
  form = next;
};
