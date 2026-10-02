import type { EntryStatus } from '@shapio/client';
import type { StatusTone } from '@/components/StatusChip';

export const ENTRY_STATUS_LABEL_KEYS = {
  draft: 'content.status.draft',
  published: 'content.status.published',
  modified: 'content.status.modified',
} as const satisfies Record<EntryStatus, string>;

/** Draft is neutral, published is live (success), published with newer draft changes needs attention. */
export const ENTRY_STATUS_TONES = {
  draft: 'neutral',
  published: 'success',
  modified: 'warning',
} as const satisfies Record<EntryStatus, StatusTone>;
