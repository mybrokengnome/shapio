import { AppError } from '../helpers/appError.js';

/**
 * Secrets taken from the server environment instead of being stored: an admin enters `${ENV:VAR_NAME}`
 * as the secret's value. The reference (only the variable name) is stored as-is; the value is read from the
 * environment each time it is used, so rotating it is a matter of changing the variable and restarting.
 */
const ENV_REFERENCE = /^\$\{ENV:([A-Za-z_][A-Za-z0-9_]*)\}$/;

/** The variable name of a `${ENV:NAME}` reference, or undefined for a literal value. */
export const parseEnvReference = (value: string): string | undefined => ENV_REFERENCE.exec(value.trim())?.[1];

export type SecretEnvironment = Readonly<Record<string, string | undefined>>;

/** Variables a reference may always name. SECRET_ENV_ALLOWLIST adds names or `PREFIX*` patterns. */
export const DEFAULT_SECRET_ENV_PREFIX = 'SHAPIO_SECRET_';

/**
 * Whether a reference may read `variable`. Only variables the operator set aside for secrets qualify, so an
 * admin cannot point a connection at the server's own settings (SESSION_SECRET, SMTP_PASSWORD, DATABASE_URL…)
 * and use the outbound signature as an oracle for them.
 */
export const isSecretEnvAllowed = (variable: string, allowlist: readonly string[]): boolean =>
  [`${DEFAULT_SECRET_ENV_PREFIX}*`, ...allowlist].some((entry) =>
    entry.endsWith('*') ? variable.startsWith(entry.slice(0, -1)) : variable === entry,
  );

export const secretEnvNotAllowed = (secret: string, variable: string) =>
  new AppError(
    400,
    'SECRET_ENV_NOT_ALLOWED',
    `The secret "${secret}" cannot come from ${variable}: environment references must name a variable that ` +
      `starts with ${DEFAULT_SECRET_ENV_PREFIX} or is listed in SECRET_ENV_ALLOWLIST`,
    { secret, variable },
  );

export const secretEnvMissing = (secret: string, variable: string) =>
  new AppError(
    503,
    'SECRET_ENV_MISSING',
    `The secret "${secret}" comes from the environment variable ${variable}, which is not set on this server`,
    { secret, variable },
  );

/** Stored references as a name → variable map (anything malformed is ignored). */
export const envRefsOf = (value: unknown): Record<string, string> =>
  Object.fromEntries(
    Object.entries((value ?? {}) as Record<string, unknown>).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(entry[1]),
    ),
  );

/**
 * Literal secrets plus referenced ones read from `env`. `strict` throws for an unset or disallowed variable
 * (sending, testing); otherwise the secret is left out (saving, where the variable may only exist on the
 * worker). A reference stored before an allowlist change is refused here rather than read.
 */
export const resolveSecretValues = (
  literal: Record<string, string>,
  refs: Record<string, string>,
  env: SecretEnvironment,
  { strict, allowlist }: { strict: boolean; allowlist: readonly string[] },
): Record<string, string> => {
  const resolved = { ...literal };
  for (const [secret, variable] of Object.entries(refs)) {
    if (!isSecretEnvAllowed(variable, allowlist)) {
      if (strict) {
        throw secretEnvNotAllowed(secret, variable);
      }
      delete resolved[secret];
      continue;
    }
    const value = env[variable];
    if (value === undefined || value === '') {
      if (strict) {
        throw secretEnvMissing(secret, variable);
      }
      delete resolved[secret];
      continue;
    }
    resolved[secret] = value;
  }
  return resolved;
};
