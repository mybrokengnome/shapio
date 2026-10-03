/**
 * Job priorities. Workers claim due jobs by priority (higher first), then by run_at, so a large due backlog
 * of low-priority work never holds back a higher-priority job that falls due later. Rule: work someone is
 * waiting on at a set time ranks highest, work a person just triggered next, bulk background work last.
 */
export const JOB_PRIORITY = {
  /** Time-critical: scheduled publications, change set ships, deployment triggers. */
  timeCritical: 10,
  /** A person is waiting on the result: media processing after an upload. */
  interactive: 5,
  /** Everything without a stated priority. */
  normal: 0,
  /** Bulk background work: content health sweeps and entry checks, retention. */
  background: -10,
} as const;
