import type { Migration } from 'kysely/migration';
import * as baseline from './0001_baseline.js';
import * as auditEventsSeq from './20261003170000_audit_events_seq.js';

/**
 * MySQL migrations. `0001_baseline` creates the schema the PostgreSQL migrations up to and including
 * `MYSQL_BASELINE_COVERS` build. Every later migration follows the twin rule (CONTRIBUTING.md): it exists
 * under the same name in every list, either as a MySQL twin in this folder or, when it only uses portable
 * Kysely (`export const dialectNeutral = true`), as the very same module. `../twins.test.ts` enforces it.
 */
export const MYSQL_BASELINE_COVERS = '20261003160000_create_assist_runs';

export const MYSQL_MIGRATIONS: Readonly<Record<string, Migration>> = {
  '0001_baseline': baseline,
  '20261003170000_audit_events_seq': auditEventsSeq,
};
