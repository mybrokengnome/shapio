import { UsageError } from './usageError.js';

/**
 * The workspace a remote command works on. `--workspace` is the documented flag and `SHAPIO_WORKSPACE` the
 * documented variable; `--site` and `SHAPIO_SITE` (their names before 0.8.2) keep working, left out of the help.
 * The flags win over the environment; within each pair, two different keys are refused rather than guessed.
 * What the command then sends to the instance is unchanged (`Shapio-Site`), so it works with older servers.
 */
export const WORKSPACE_FLAGS = {
  workspace: { type: 'string' },
  site: { type: 'string' },
} as const;

export type WorkspaceFlagValues = { workspace?: string | undefined; site?: string | undefined };

type Named = { name: string; value: string | undefined };

const present = (value: string | undefined) => value?.trim() || undefined;

/** One key from a documented spelling and its older one; both set and different is a usage error. */
const pickOne = (current: Named, older: Named): string | undefined => {
  const first = present(current.value);
  const second = present(older.value);
  if (first !== undefined && second !== undefined && first !== second) {
    throw new UsageError(
      `${current.name} "${first}" and ${older.name} "${second}" name different workspaces: set one of them`,
    );
  }
  return first ?? second;
};

/** The key `--workspace` (or `--site`) names, if either is set. */
export const workspaceFromFlags = (values: WorkspaceFlagValues): string | undefined =>
  pickOne({ name: '--workspace', value: values.workspace }, { name: '--site', value: values.site });

/** The key `SHAPIO_WORKSPACE` (or `SHAPIO_SITE`) names, if either is set. */
export const workspaceFromEnv = (env: Readonly<Record<string, string | undefined>>): string | undefined =>
  pickOne(
    { name: 'SHAPIO_WORKSPACE', value: env.SHAPIO_WORKSPACE },
    { name: 'SHAPIO_SITE', value: env.SHAPIO_SITE },
  );

/** The flags, else the environment; undefined lets the instance decide (the token's workspace, else the primary). */
export const resolveWorkspace = (
  values: WorkspaceFlagValues,
  env: Readonly<Record<string, string | undefined>>,
): string | undefined => workspaceFromFlags(values) ?? workspaceFromEnv(env);
