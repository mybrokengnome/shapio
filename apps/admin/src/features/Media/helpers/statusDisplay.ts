import type { MediaAssetStatus, MediaVariantStatus } from '@shapio/client';
import type { StatusTone } from '@/components/StatusChip';

type Display = { labelKey: string; tone: StatusTone };

/** How an asset's or variant's processing state reads as a `StatusChip`. */
export const MEDIA_STATUS_DISPLAY = {
  pending: { labelKey: 'media.status.pending', tone: 'progress' },
  processing: { labelKey: 'media.status.processing', tone: 'progress' },
  ready: { labelKey: 'media.status.ready', tone: 'success' },
  failed: { labelKey: 'media.status.failed', tone: 'danger' },
} as const satisfies Record<MediaAssetStatus | MediaVariantStatus, Display>;
