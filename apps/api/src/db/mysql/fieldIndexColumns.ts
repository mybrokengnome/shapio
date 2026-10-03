/**
 * On MySQL a field index is built on an invisible virtual column holding the field's value expression
 * (`content/compiler/dialect/mysql.ts`); the column is named after the index: `eh_<hash>` → `ev_<hash>`.
 */
export const fieldIndexColumnName = (indexName: string): string => indexName.replace(/^eh_/, 'ev_');
