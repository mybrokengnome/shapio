import type { Migration } from 'kysely/migration';
import * as baseline from './0001_baseline.js';
import * as auditEventsSeq from './20261003170000_audit_events_seq.js';
import * as modelsSiteScope from './20261004120000_models_site_scope.js';
import * as siteSeoSettings from './20261004130000_site_seo_settings.js';

/**
 * SQLite migrations. `0001_baseline` creates the schema the PostgreSQL migrations up to and including
 * `SQLITE_BASELINE_COVERS` build. Every later migration follows the twin rule (CONTRIBUTING.md): it exists
 * under the same name in both lists, either as a SQLite twin in this folder or, when it only uses portable
 * Kysely (`export const dialectNeutral = true`), as the very same module. `twins.test.ts` enforces it.
 */
export const SQLITE_BASELINE_COVERS = '20261003160000_create_assist_runs';

export const SQLITE_MIGRATIONS: Readonly<Record<string, Migration>> = {
  '0001_baseline': baseline,
  '20261003170000_audit_events_seq': auditEventsSeq,
  '20261004120000_models_site_scope': modelsSiteScope,
  '20261004130000_site_seo_settings': siteSeoSettings,
};
