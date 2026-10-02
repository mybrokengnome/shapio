import type { DeploymentRun, ScheduleStatus, WebhookDeliveryStatus } from '@shapio/client';
import type { StatusTone } from '@/components/StatusChip';

type Display = { labelKey: string; tone: StatusTone };

export const SCHEDULE_STATUS_DISPLAY = {
  scheduled: { labelKey: 'publishing.scheduled.statuses.scheduled', tone: 'scheduled' },
  done: { labelKey: 'publishing.scheduled.statuses.done', tone: 'success' },
  failed: { labelKey: 'publishing.scheduled.statuses.failed', tone: 'danger' },
  cancelled: { labelKey: 'publishing.scheduled.statuses.cancelled', tone: 'muted' },
} as const satisfies Record<ScheduleStatus, Display>;

export const DELIVERY_STATUS_DISPLAY = {
  pending: { labelKey: 'publishing.webhooks.deliveryStatuses.pending', tone: 'progress' },
  retrying: { labelKey: 'publishing.webhooks.deliveryStatuses.retrying', tone: 'progress' },
  succeeded: { labelKey: 'publishing.webhooks.deliveryStatuses.succeeded', tone: 'success' },
  dead: { labelKey: 'publishing.webhooks.deliveryStatuses.dead', tone: 'danger' },
} as const satisfies Record<WebhookDeliveryStatus, Display>;

const RUN_DISPLAY = {
  queued: { labelKey: 'publishing.deployments.statuses.queued', tone: 'neutral' },
  triggered: { labelKey: 'publishing.deployments.statuses.triggered', tone: 'progress' },
  triggeredUnknown: { labelKey: 'publishing.deployments.statuses.triggeredUnknown', tone: 'muted' },
  building: { labelKey: 'publishing.deployments.statuses.building', tone: 'progress' },
  deployed: { labelKey: 'publishing.deployments.statuses.deployed', tone: 'success' },
  committed: { labelKey: 'publishing.deployments.statuses.committed', tone: 'success' },
  failed: { labelKey: 'publishing.deployments.statuses.failed', tone: 'danger' },
  unknown: { labelKey: 'publishing.deployments.statuses.unknown', tone: 'muted' },
} as const satisfies Record<string, Display>;

export type RunDisplay = (typeof RUN_DISPLAY)[keyof typeof RUN_DISPLAY];

/**
 * A run's label, honest about what Shapio actually knows (brief §7: never show a success that didn't
 * happen). A trigger without a completion report reads "Trigger sent · completion unknown", not "Deployed";
 * GitHub "deploys" by committing, so its success reads "Committed".
 */
export const runDisplay = (
  run: Pick<DeploymentRun, 'status' | 'provider' | 'completionReported'>,
): RunDisplay => {
  switch (run.status) {
    case 'triggered':
      return run.completionReported ? RUN_DISPLAY.triggered : RUN_DISPLAY.triggeredUnknown;
    case 'deployed':
      return run.provider === 'github' ? RUN_DISPLAY.committed : RUN_DISPLAY.deployed;
    default:
      return RUN_DISPLAY[run.status];
  }
};
