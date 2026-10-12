import { formatRelativeTime } from '@/helpers/formatDate';

/** Under a minute (or a little ahead, a clock difference) reads as `momentAgo`. */
const MOMENT_MS = 60_000;

/** When a draft was changed elsewhere, as the notice says it: "a moment ago", then "5 min. ago". */
export const changedWhen = (savedAt: string, momentAgo: string, now = Date.now()): string =>
  now - new Date(savedAt).getTime() < MOMENT_MS ? momentAgo : formatRelativeTime(savedAt, { now });
