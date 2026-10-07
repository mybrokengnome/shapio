import { UsageError } from '../commands/export/http.js';

/**
 * The site a `--plan` writes its models for. `--plan` runs offline (no URL or token), so it cannot ask the
 * instance which site a token works on: it takes `--site`, else `SHAPIO_SITE`, else the primary site, whose key
 * is always `default`. On a single-site instance that is the only site, so the planned models apply with an
 * ordinary admin token. `--shared` plans models shared with all sites instead (applying them needs a network
 * admin token).
 */
export const PRIMARY_SITE_KEY = 'default';

export type PlanSite =
  /** Shared with all sites (`--shared`). */
  | { site: undefined; explicit: true }
  /** One site: named (`--site`, `SHAPIO_SITE`), or the primary site by default. */
  | { site: string; explicit: boolean };

export const resolvePlanSite = (
  options: { site?: string | undefined; shared?: boolean | undefined },
  env: Readonly<Record<string, string | undefined>>,
): PlanSite => {
  const named = options.site?.trim() || undefined;
  if (options.shared) {
    if (named) {
      throw new UsageError('Pass either --site <key> or --shared, not both');
    }
    return { site: undefined, explicit: true };
  }
  const site = named ?? (env.SHAPIO_SITE?.trim() || undefined);
  return site ? { site, explicit: true } : { site: PRIMARY_SITE_KEY, explicit: false };
};
