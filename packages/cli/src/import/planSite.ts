import { UsageError } from '../helpers/usageError.js';
import { workspaceFromEnv, workspaceFromFlags, type WorkspaceFlagValues } from '../helpers/workspace.js';

/**
 * The workspace a `--plan` writes its models for: `--workspace`, else `SHAPIO_WORKSPACE` (`--site` and
 * `SHAPIO_SITE` also work). Otherwise, with `--url`, the workspace the instance answers for (the token's
 * workspace, else the primary workspace); offline, the built-in workspace, key `default`, which is the primary
 * workspace unless another workspace was made primary (pass `--workspace` then, or once `default` is gone). On
 * an instance with one workspace that is the only one, so the planned models apply with an ordinary admin
 * token. `--shared` plans models shared with all workspaces instead (applying them needs a network admin token).
 */
export const BUILT_IN_SITE_KEY = 'default';

export type PlanSite =
  /** Shared with all workspaces (`--shared`). */
  | { site: undefined; explicit: true }
  /** One workspace: named (flag, environment, or the instance's answer), or the built-in one by default. */
  | { site: string; explicit: boolean };

export const resolvePlanSite = (
  options: WorkspaceFlagValues & { shared?: boolean | undefined },
  env: Readonly<Record<string, string | undefined>>,
): PlanSite => {
  const named = workspaceFromFlags(options);
  if (options.shared) {
    if (named) {
      throw new UsageError('Pass either --workspace <key> or --shared, not both');
    }
    return { site: undefined, explicit: true };
  }
  const site = named ?? workspaceFromEnv(env);
  return site ? { site, explicit: true } : { site: BUILT_IN_SITE_KEY, explicit: false };
};
