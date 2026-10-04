import type { Migration, MigrationProvider } from 'kysely/migration';
import type { DialectName } from '../dialect.js';
import * as createPlatformTables from './20261001120000_create_platform_tables.js';
import * as createAdminIdentity from './20261001130000_create_admin_identity.js';
import * as createSystemSettings from './20261001130500_create_system_settings.js';
import * as createSchemaTables from './20261001140000_create_schema_tables.js';
import * as createContentTables from './20261001150000_create_content_tables.js';
import * as createMediaTables from './20261001160000_create_media_tables.js';
import * as createPublishingTables from './20261001170000_create_publishing_tables.js';
import * as createAppUsers from './20261001180000_create_app_users.js';
import * as createExtensionHookRuns from './20261002120000_create_extension_hook_runs.js';
import * as appAuthTokenVersionAndLoginCodePkce from './20261002130000_app_auth_token_version_and_login_code_pkce.js';
import * as addPublicationLogDiffIndexes from './20261002180000_add_publication_log_diff_indexes.js';
import * as createUsageTables from './20261002180100_create_usage_tables.js';
import * as createChangeSets from './20261002180200_create_change_sets.js';
import * as createEditorPresenceAndContentHealth from './20261002190000_create_editor_presence_and_content_health.js';
import * as addChangesShipPermission from './20261003120000_add_changes_ship_permission.js';
import * as createSites from './20261003130000_create_sites.js';
import * as enqueueFieldIndexLayout from './20261003140200_enqueue_field_index_layout.js';
import * as changeSetItemsSiteAndPreviewEntry from './20261003140500_change_set_items_site_and_preview_entry.js';
import * as widenDeploymentProviders from './20261003150000_widen_deployment_providers.js';
import * as createAssistRuns from './20261003160000_create_assist_runs.js';
import * as auditEventsSeq from './20261003170000_audit_events_seq.js';
import * as modelsSiteScope from './20261004120000_models_site_scope.js';
import { MYSQL_MIGRATIONS } from './mysql/index.js';
import { SQLITE_MIGRATIONS } from './sqlite/index.js';

/**
 * Every migration, listed explicitly. A static list works when the server is bundled for npm, where
 * directory scanning would not. Names must keep the `YYYYMMDDHHMMSS_description` order; the migrator
 * rejects out-of-order additions. Timestamps are assigned when a migration merges.
 */
export const MIGRATIONS: Readonly<Record<string, Migration>> = {
  '20261001120000_create_platform_tables': createPlatformTables,
  '20261001130000_create_admin_identity': createAdminIdentity,
  '20261001130500_create_system_settings': createSystemSettings,
  '20261001140000_create_schema_tables': createSchemaTables,
  '20261001150000_create_content_tables': createContentTables,
  '20261001160000_create_media_tables': createMediaTables,
  '20261001170000_create_publishing_tables': createPublishingTables,
  '20261001180000_create_app_users': createAppUsers,
  '20261002120000_create_extension_hook_runs': createExtensionHookRuns,
  '20261002130000_app_auth_token_version_and_login_code_pkce': appAuthTokenVersionAndLoginCodePkce,
  '20261002180000_add_publication_log_diff_indexes': addPublicationLogDiffIndexes,
  '20261002180100_create_usage_tables': createUsageTables,
  '20261002180200_create_change_sets': createChangeSets,
  '20261002190000_create_editor_presence_and_content_health': createEditorPresenceAndContentHealth,
  '20261003120000_add_changes_ship_permission': addChangesShipPermission,
  '20261003130000_create_sites': createSites,
  '20261003140200_enqueue_field_index_layout': enqueueFieldIndexLayout,
  '20261003140500_change_set_items_site_and_preview_entry': changeSetItemsSiteAndPreviewEntry,
  '20261003150000_widen_deployment_providers': widenDeploymentProviders,
  '20261003160000_create_assist_runs': createAssistRuns,
  '20261003170000_audit_events_seq': auditEventsSeq,
  '20261004120000_models_site_scope': modelsSiteScope,
};

export const staticMigrationProvider: MigrationProvider = {
  getMigrations: () => Promise.resolve({ ...MIGRATIONS }),
};

/** SQLite's list: its baseline, then the twins of later migrations (`./sqlite/index.ts`). */
export const sqliteMigrationProvider: MigrationProvider = {
  getMigrations: () => Promise.resolve({ ...SQLITE_MIGRATIONS }),
};

/** MySQL's list: its baseline, then the twins of later migrations (`./mysql/index.ts`). */
export const mysqlMigrationProvider: MigrationProvider = {
  getMigrations: () => Promise.resolve({ ...MYSQL_MIGRATIONS }),
};

const PROVIDERS: Readonly<Record<DialectName, MigrationProvider>> = {
  postgres: staticMigrationProvider,
  sqlite: sqliteMigrationProvider,
  mysql: mysqlMigrationProvider,
};

export const migrationProviderFor = (dialect: DialectName): MigrationProvider => PROVIDERS[dialect];
