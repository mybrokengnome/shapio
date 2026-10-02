import type { ChangeSetStatus } from '@shapio/client';
import type { StatusTone } from '@/components/StatusChip';

/** D0 renamed `releases.manage` to this in the change-sets migration. */
export const CHANGES_MANAGE_PERMISSION = 'changes.manage';
export const TOKENS_MANAGE_PERMISSION = 'tokens.manage';

type Display = { labelKey: string; tone: StatusTone };

export const CHANGE_SET_STATUS_DISPLAY = {
  open: { labelKey: 'changes.statuses.open', tone: 'neutral' },
  scheduled: { labelKey: 'changes.statuses.scheduled', tone: 'scheduled' },
  shipping: { labelKey: 'changes.statuses.shipping', tone: 'progress' },
  shipped: { labelKey: 'changes.statuses.shipped', tone: 'success' },
  failed: { labelKey: 'changes.statuses.failed', tone: 'danger' },
  discarded: { labelKey: 'changes.statuses.discarded', tone: 'muted' },
} as const satisfies Record<ChangeSetStatus, Display>;

/** Sets whose items and title can still change. */
export const EDITABLE_STATUSES: ReadonlySet<ChangeSetStatus> = new Set(['open', 'failed']);
