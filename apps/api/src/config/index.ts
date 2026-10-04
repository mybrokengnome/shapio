import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import envSchema from 'env-schema';
import { toAssistConfig, type AssistConfig } from './assist.js';
import { toGraphqlConfig, type GraphqlConfig } from './graphql.js';
import { toPublishingConfig, type PublishingConfig } from './publishing.js';
import { ConfigError, findConfigProblems } from './rules.js';
import { CONFIG_DEFAULTS, configSchema, type RawConfig } from './schema.js';
import { toUsageConfig, type UsageConfig } from './usage.js';

export { ConfigError } from './rules.js';

export type NodeEnv = RawConfig['NODE_ENV'];
export type WorkerMode = RawConfig['WORKER_MODE'];

export type TlsConfig =
  { mode: 'off' } | { mode: 'files'; certFile: string; keyFile: string; reloadIntervalMs: number };

export type S3StorageConfig = {
  bucket: string;
  region: string | undefined;
  endpoint: string | undefined;
  accessKeyId: string | undefined;
  secretAccessKey: string | undefined;
  forcePathStyle: boolean;
};

export type StorageConfig = {
  /** Where new uploads go. Existing assets are read from the driver recorded on each asset. */
  driver: 'local' | 's3';
  mediaPath: string;
  /** Set whenever STORAGE_S3_BUCKET is, whatever the driver (for `shapio media migrate`). */
  s3: S3StorageConfig | undefined;
  /** CDN or public bucket base for public media, without a trailing slash; undefined = served by Shapio. */
  publicBaseUrl: string | undefined;
  maxUploadBytes: number;
  /** MIME types or `type/*` wildcards, lower case. */
  allowedTypes: string[];
};

export type EmailConfig =
  | { transport: 'console'; from: string }
  | {
      transport: 'smtp';
      from: string;
      host: string;
      port: number;
      secure: boolean;
      user: string | undefined;
      password: string | undefined;
    };

export type OAuthClientConfig = { clientId: string; clientSecret: string };

export type AppAuthConfig = {
  requireEmailConfirmation: boolean;
  accessTokenTtlSeconds: number;
  refreshTokenTtlMs: number;
  confirmEmailUrl: string | undefined;
  resetPasswordUrl: string | undefined;
  /** APP_AUTH_RETURN_URLS as listed (origins or custom-scheme prefixes); undefined = CORS_ORIGINS + PUBLIC_URL. */
  returnUrls: string[] | undefined;
  /** Configured OAuth providers only. */
  oauth: { google: OAuthClientConfig | undefined; github: OAuthClientConfig | undefined };
};

export type AppConfig = {
  nodeEnv: NodeEnv;
  instanceId: string;
  server: {
    host: string;
    port: number;
    /** Plain-HTTP listener that redirects to HTTPS; undefined = none. */
    httpPort: number | undefined;
    trustProxy: boolean | number;
    /** Origin without a trailing slash, e.g. `https://cms.example.com`. */
    publicUrl: string;
    /** `''` at the root, otherwise `/cms` (leading slash, no trailing slash). */
    basePath: string;
  };
  tls: TlsConfig;
  log: { level: RawConfig['LOG_LEVEL']; pretty: boolean };
  database: { url: string; poolMax: number; acquireTimeoutMs: number; migrateOnStart: boolean };
  /** `listen`: use LISTEN/NOTIFY to refresh schema caches early (correctness never depends on it). */
  schema: { listen: boolean };
  http: {
    corsOrigins: string[];
    rateLimitMax: number;
    rateLimitWindowMs: number;
    /** Public media files get their own, higher limit (pages load many images). */
    mediaRateLimitMax: number;
  };
  sessionSecret: string | undefined;
  /** First-run setup: `requireToken` = the endpoint also needs the one-time token logged at boot. */
  setup: { requireToken: boolean };
  worker: { mode: WorkerMode; concurrency: number; pollIntervalMs: number; leaseMs: number };
  shutdownTimeoutMs: number;
  /** The daily `system.retention` job prunes finished bookkeeping older than this. */
  retention: { days: number };
  storage: StorageConfig;
  /** Project extensions (ADR 0009): an explicit config file, else the working directory is searched. */
  extensions: { configPath: string | undefined };
  email: EmailConfig;
  /** App users (end users of the user's sites and apps): sign-in, tokens, OAuth. */
  appAuth: AppAuthConfig;
  /** Outbound requests and provider endpoints for webhooks and deployments. */
  publishing: PublishingConfig;
  /** The GraphQL endpoint and its limits. */
  graphql: GraphqlConfig;
  /** Field usage counters from delivery traffic. */
  usage: UsageConfig;
  /** Content health rules (the Inbox). */
  health: { staleDays: number };
  /** Editor assists with the operator's own model provider; off unless AI_PROVIDER is set. */
  assist: AssistConfig;
};

type EnvSource = Record<string, string | undefined>;

const CONFIG_KEYS = Object.keys(configSchema.properties) as (keyof RawConfig)[];

/** Keep only Shapio's keys and treat empty values (`FOO=`) as unset, so defaults apply. */
const pickConfiguredValues = (env: EnvSource): Record<string, string> => {
  const picked: Record<string, string> = {};
  for (const key of CONFIG_KEYS) {
    const value = env[key];
    if (value !== undefined && value.trim() !== '') {
      picked[key] = value.trim();
    }
  }
  return picked;
};

const parseList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

const parseTrustProxy = (value: string): boolean | number =>
  value === 'true' ? true : value === 'false' ? false : Number(value);

export const normalizeBasePath = (value: string): string => value.replace(/\/+$/, '');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '0.0.0.0', '::', '::1']);

/** Without PUBLIC_URL (development and test only) the origin is derived from where the server listens. */
const derivePublicUrl = (raw: RawConfig, https: boolean): string => {
  if (raw.PUBLIC_URL) {
    return new URL(raw.PUBLIC_URL).origin;
  }
  const host = LOOPBACK_HOSTS.has(raw.HOST) ? 'localhost' : raw.HOST;
  return `${https ? 'https' : 'http'}://${host}:${raw.PORT}`;
};

const toTlsConfig = (raw: RawConfig): TlsConfig => {
  if (raw.TLS_CERT_FILE && raw.TLS_KEY_FILE) {
    return {
      mode: 'files',
      certFile: resolve(raw.TLS_CERT_FILE),
      keyFile: resolve(raw.TLS_KEY_FILE),
      reloadIntervalMs: raw.TLS_RELOAD_INTERVAL_MS,
    };
  }
  return { mode: 'off' };
};

const toStorageConfig = (raw: RawConfig): StorageConfig => ({
  driver: raw.STORAGE_DRIVER,
  mediaPath: resolve(raw.MEDIA_PATH),
  s3: raw.STORAGE_S3_BUCKET
    ? {
        bucket: raw.STORAGE_S3_BUCKET,
        region: raw.STORAGE_S3_REGION,
        endpoint: raw.STORAGE_S3_ENDPOINT,
        accessKeyId: raw.STORAGE_S3_ACCESS_KEY_ID,
        secretAccessKey: raw.STORAGE_S3_SECRET_ACCESS_KEY,
        forcePathStyle: raw.STORAGE_S3_FORCE_PATH_STYLE,
      }
    : undefined,
  publicBaseUrl: raw.MEDIA_PUBLIC_BASE_URL?.replace(/\/+$/, ''),
  maxUploadBytes: raw.MEDIA_MAX_UPLOAD_BYTES,
  allowedTypes: parseList(raw.MEDIA_ALLOWED_TYPES.toLowerCase()),
});

const toEmailConfig = (raw: RawConfig, publicUrl: string): EmailConfig => {
  const from = raw.EMAIL_FROM ?? `Shapio <no-reply@${new URL(publicUrl).hostname}>`;
  if (raw.EMAIL_TRANSPORT === 'console') {
    return { transport: 'console', from };
  }
  return {
    transport: 'smtp',
    from,
    host: raw.SMTP_HOST ?? '',
    port: raw.SMTP_PORT,
    secure: raw.SMTP_SECURE,
    user: raw.SMTP_USER,
    password: raw.SMTP_PASSWORD,
  };
};

const oauthClient = (clientId: string | undefined, clientSecret: string | undefined) =>
  clientId && clientSecret ? { clientId, clientSecret } : undefined;

const DAY_MS = 24 * 60 * 60 * 1000;

const toAppAuthConfig = (raw: RawConfig): AppAuthConfig => ({
  requireEmailConfirmation: raw.APP_AUTH_REQUIRE_EMAIL_CONFIRMATION,
  accessTokenTtlSeconds: raw.APP_AUTH_ACCESS_TOKEN_TTL_SECONDS,
  refreshTokenTtlMs: raw.APP_AUTH_REFRESH_TOKEN_TTL_DAYS * DAY_MS,
  confirmEmailUrl: raw.APP_AUTH_CONFIRM_EMAIL_URL,
  resetPasswordUrl: raw.APP_AUTH_RESET_PASSWORD_URL,
  returnUrls: raw.APP_AUTH_RETURN_URLS ? parseList(raw.APP_AUTH_RETURN_URLS) : undefined,
  oauth: {
    google: oauthClient(raw.APP_AUTH_GOOGLE_CLIENT_ID, raw.APP_AUTH_GOOGLE_CLIENT_SECRET),
    github: oauthClient(raw.APP_AUTH_GITHUB_CLIENT_ID, raw.APP_AUTH_GITHUB_CLIENT_SECRET),
  },
});

const toAppConfig = (raw: RawConfig): AppConfig => {
  const tls = toTlsConfig(raw);
  return {
    nodeEnv: raw.NODE_ENV,
    instanceId: raw.INSTANCE_ID ?? `${hostname()}-${process.pid}`,
    server: {
      host: raw.HOST,
      port: raw.PORT,
      httpPort: raw.HTTP_PORT,
      trustProxy: parseTrustProxy(raw.TRUST_PROXY),
      publicUrl: derivePublicUrl(raw, tls.mode !== 'off'),
      basePath: normalizeBasePath(raw.BASE_PATH),
    },
    tls,
    log: { level: raw.LOG_LEVEL, pretty: raw.LOG_PRETTY },
    database: {
      url: raw.DATABASE_URL,
      poolMax: raw.DATABASE_POOL_MAX,
      acquireTimeoutMs: raw.DATABASE_POOL_ACQUIRE_TIMEOUT_MS,
      migrateOnStart: raw.MIGRATE_ON_START,
    },
    schema: { listen: raw.SCHEMA_LISTEN },
    http: {
      corsOrigins: parseList(raw.CORS_ORIGINS),
      rateLimitMax: raw.RATE_LIMIT_MAX,
      rateLimitWindowMs: raw.RATE_LIMIT_WINDOW_MS,
      mediaRateLimitMax: raw.MEDIA_RATE_LIMIT_MAX,
    },
    sessionSecret: raw.SESSION_SECRET,
    setup: { requireToken: raw.SETUP_REQUIRE_TOKEN },
    worker: {
      mode: raw.WORKER_MODE,
      concurrency: raw.WORKER_CONCURRENCY,
      pollIntervalMs: raw.WORKER_POLL_INTERVAL_MS,
      leaseMs: raw.JOB_LEASE_MS,
    },
    shutdownTimeoutMs: raw.SHUTDOWN_TIMEOUT_MS,
    retention: { days: raw.RETENTION_DAYS },
    storage: toStorageConfig(raw),
    extensions: { configPath: raw.SHAPIO_CONFIG_PATH ? resolve(raw.SHAPIO_CONFIG_PATH) : undefined },
    email: toEmailConfig(raw, derivePublicUrl(raw, tls.mode !== 'off')),
    appAuth: toAppAuthConfig(raw),
    publishing: toPublishingConfig(raw),
    graphql: toGraphqlConfig(raw),
    usage: toUsageConfig(raw),
    health: { staleDays: raw.HEALTH_STALE_DAYS },
    assist: toAssistConfig(raw),
  };
};

/**
 * Validates the environment against the config schema and the cross-field rules, and returns typed
 * config. Throws (listing every problem) so startup fails fast.
 */
export const loadConfig = (env: EnvSource = process.env): AppConfig => {
  const raw = envSchema<RawConfig>({
    schema: configSchema,
    data: [CONFIG_DEFAULTS, pickConfiguredValues(env)],
    env: false,
  });
  const problems = findConfigProblems(raw);
  if (problems.length > 0) {
    throw new ConfigError(problems);
  }
  return toAppConfig(raw);
};

/**
 * Loads a `.env` file into `process.env` if it exists. Existing variables win, so real environment
 * settings always override the file. Used by the `shapio` bin and tooling configs only.
 */
export const loadEnvFileIfPresent = (path = resolve(process.cwd(), '.env')): boolean => {
  if (!existsSync(path)) {
    return false;
  }
  process.loadEnvFile(path);
  return true;
};
