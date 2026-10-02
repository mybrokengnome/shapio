/**
 * Deployment run states (brief §7): a trigger accepted is not a build succeeded, and Shapio never invents a
 * state. `unknown` means the provider stopped reporting before the run finished.
 */
export const RUN_STATUSES = ['queued', 'triggered', 'building', 'unknown', 'deployed', 'failed'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** States only move up in rank, so late or replayed callbacks cannot regress a run. */
export const RUN_STATUS_RANK: Readonly<Record<RunStatus, number>> = {
  queued: 0,
  triggered: 1,
  building: 2,
  unknown: 3,
  deployed: 4,
  failed: 4,
};

export const isTerminalStatus = (status: string) => status === 'deployed' || status === 'failed';

export type TimelineSource = 'shapio' | 'callback' | 'provider';

export type TimelineEvent = { status: RunStatus; at: string; source: TimelineSource; message: string | null };

/** What a provider or callback reports for a run. */
export type RunReport = {
  status: Exclude<RunStatus, 'queued'>;
  message?: string | undefined;
  providerRef?: string | undefined;
  logUrl?: string | undefined;
  siteUrl?: string | undefined;
};
