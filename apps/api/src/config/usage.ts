import type { RawConfig } from './schema.js';

/** Field usage from delivery traffic (plan developer-face §5). */
export type UsageConfig = {
  /** Count delivery reads per field and principal. */
  enabled: boolean;
  /** Days of daily counters the retention job keeps. */
  retentionDays: number;
  /** How often the in-memory counters are written (one multi-row upsert per table). */
  flushIntervalMs: number;
};

export const toUsageConfig = (raw: RawConfig): UsageConfig => ({
  enabled: raw.USAGE_TRACKING,
  retentionDays: raw.USAGE_RETENTION_DAYS,
  flushIntervalMs: raw.USAGE_FLUSH_INTERVAL_MS,
});
