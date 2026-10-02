/**
 * LISTEN/NOTIFY channel names. Channels are per database, so test databases are isolated from each other;
 * instances sharing a database must share channels to coordinate.
 */
export const NOTIFY_CHANNEL = {
  schemaChanged: 'shapio_schema_changed',
  permissionsChanged: 'shapio_permissions_changed',
  jobsAvailable: 'shapio_jobs_available',
} as const;
