import type { DeploymentRunStatus, SnapshotSource } from '@shapio/client';
import type { StatusTone } from '@/components/StatusChip';

export const SNAPSHOT_SOURCE_KEYS = {
  publish: 'snapshots.sources.publish',
  unpublish: 'snapshots.sources.unpublish',
  delete: 'snapshots.sources.delete',
  schedule: 'snapshots.sources.schedule',
  change_set: 'snapshots.sources.change_set',
  schema: 'snapshots.sources.schema',
  conversion: 'snapshots.sources.conversion',
  import: 'snapshots.sources.import',
  legacy: 'snapshots.sources.legacy',
} as const satisfies Record<SnapshotSource, string>;

/** A ledger row only knows the run's status (not its provider), so "triggered" reads as sent. */
export const SNAPSHOT_RUN_DISPLAY = {
  queued: { labelKey: 'publishing.deployments.statuses.queued', tone: 'neutral' },
  triggered: { labelKey: 'publishing.deployments.statuses.triggered', tone: 'progress' },
  building: { labelKey: 'publishing.deployments.statuses.building', tone: 'progress' },
  deployed: { labelKey: 'publishing.deployments.statuses.deployed', tone: 'success' },
  failed: { labelKey: 'publishing.deployments.statuses.failed', tone: 'danger' },
  unknown: { labelKey: 'publishing.deployments.statuses.unknown', tone: 'muted' },
} as const satisfies Record<DeploymentRunStatus, { labelKey: string; tone: StatusTone }>;
