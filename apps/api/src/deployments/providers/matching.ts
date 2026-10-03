/** Clock skew allowed between Shapio and a provider when matching a deployment to the trigger that started it. */
export const MATCH_SKEW_MS = 30_000;

/** Whether a deployment created at `created` (ms, NaN when unknown) can belong to a trigger sent at `since`. */
export const createdSince = (created: number, since: Date): boolean =>
  !Number.isNaN(created) && created >= since.getTime() - MATCH_SKEW_MS;

/** A provider timestamp (ISO text or epoch milliseconds) as epoch milliseconds; NaN when missing. */
export const toEpochMs = (value: string | number | null | undefined): number => {
  if (typeof value === 'number') {
    return value;
  }
  return value ? Date.parse(value) : NaN;
};
