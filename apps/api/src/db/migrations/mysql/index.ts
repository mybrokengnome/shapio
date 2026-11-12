import type { Migration } from 'kysely/migration';
import * as systemVersionsRelease from '../20261006120000_system_versions_release.js';
import * as apiTokenSchemaPin from '../20261110130000_api_token_schema_pin.js';
import * as itemIdKey from '../20261111120000_item_id_key.js';
import * as baseline from './0001_baseline.js';
import * as auditEventsSeq from './20261003170000_audit_events_seq.js';
import * as modelsSiteScope from './20261004120000_models_site_scope.js';
import * as siteSeoSettings from './20261004130000_site_seo_settings.js';
import * as entryHeadsEntryCreatedAt from './20261005120000_entry_heads_entry_created_at.js';
import * as canceledStatus from './20261014120000_canceled_status.js';
import * as interfaceKind from './20261021120000_interface_kind.js';
import * as changeSetApproval from './20261028120000_change_set_approval.js';
import * as schemaChangeOutcome from './20261029120000_schema_change_outcome.js';
import * as assistWriteAndFill from './20261104120000_assist_write_and_fill.js';
import * as schemaLenses from './20261110120000_schema_lenses.js';
import * as entryHeadsScalarsGin from './20261112120000_entry_heads_scalars_gin.js';

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
  '20261004120000_models_site_scope': modelsSiteScope,
  '20261004130000_site_seo_settings': siteSeoSettings,
  '20261005120000_entry_heads_entry_created_at': entryHeadsEntryCreatedAt,
  '20261006120000_system_versions_release': systemVersionsRelease,
  '20261014120000_canceled_status': canceledStatus,
  '20261021120000_interface_kind': interfaceKind,
  '20261028120000_change_set_approval': changeSetApproval,
  '20261029120000_schema_change_outcome': schemaChangeOutcome,
  '20261104120000_assist_write_and_fill': assistWriteAndFill,
  '20261110120000_schema_lenses': schemaLenses,
  '20261110130000_api_token_schema_pin': apiTokenSchemaPin,
  '20261111120000_item_id_key': itemIdKey,
  '20261112120000_entry_heads_scalars_gin': entryHeadsScalarsGin,
};
