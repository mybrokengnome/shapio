import { Type, type Static } from 'typebox';

export const NODE_ENVS = ['development', 'production', 'test'] as const;
export const WORKER_MODES = ['inline', 'dedicated'] as const;
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export const STORAGE_DRIVERS = ['local', 's3'] as const;
export const EMAIL_TRANSPORTS = ['console', 'smtp'] as const;

/**
 * Every setting Shapio reads from the environment. This is the only place that knows env var names;
 * the rest of the code receives a typed `AppConfig`. Cross-field rules live in config/index.ts.
 */
export const configSchema = Type.Object({
  NODE_ENV: Type.Enum(NODE_ENVS),
  HOST: Type.String({ minLength: 1 }),
  PORT: Type.Integer({ minimum: 0, maximum: 65535 }),
  LOG_LEVEL: Type.Enum(LOG_LEVELS),
  LOG_PRETTY: Type.Boolean(),

  /** Origin users reach Shapio at, e.g. https://cms.example.com. Required in production. */
  PUBLIC_URL: Type.Optional(Type.String({ pattern: '^https?://' })),
  /** Sub-path Shapio is served under, e.g. /cms. Prefixes every route and the admin. */
  BASE_PATH: Type.String({ pattern: '^/([A-Za-z0-9._~-]+(/[A-Za-z0-9._~-]+)*)?/?$' }),
  /** `true`, `false`, or the number of proxy hops to trust for X-Forwarded-* headers. */
  TRUST_PROXY: Type.String({ pattern: '^(true|false|[0-9]+)$' }),
  CORS_ORIGINS: Type.String(),
  RATE_LIMIT_MAX: Type.Integer({ minimum: 1 }),
  RATE_LIMIT_WINDOW_MS: Type.Integer({ minimum: 1000 }),
  /** Requests per window and IP for public media files (`/api/media/f/*` without a signature). */
  MEDIA_RATE_LIMIT_MAX: Type.Integer({ minimum: 1 }),

  /** HTTPS from certificate files. Both or neither. */
  TLS_CERT_FILE: Type.Optional(Type.String({ minLength: 1 })),
  TLS_KEY_FILE: Type.Optional(Type.String({ minLength: 1 })),
  /** How often the certificate files are re-read; a changed pair is applied without a restart. */
  TLS_RELOAD_INTERVAL_MS: Type.Integer({ minimum: 1000 }),
  /** Plain-HTTP listener that redirects to HTTPS on PUBLIC_URL. Only with TLS_CERT_FILE/TLS_KEY_FILE. */
  HTTP_PORT: Type.Optional(Type.Integer({ minimum: 0, maximum: 65535 })),

  DATABASE_URL: Type.String({ minLength: 1 }),
  DATABASE_POOL_MAX: Type.Integer({ minimum: 2, maximum: 200 }),
  MIGRATE_ON_START: Type.Boolean(),
  /**
   * LISTEN for schema-change notifications to refresh caches early. Turn off where LISTEN does not work
   * (e.g. PgBouncer in transaction mode); every request still checks the durable schema version.
   */
  SCHEMA_LISTEN: Type.Boolean(),

  /**
   * The instance's general signing secret (preview tokens, private-media URLs and upload grants, app-user token
   * keys, the key that encrypts stored webhook and deployment secrets). At least 32 characters.
   * Optional: when unset, one is generated on first boot and stored in the database (system_settings).
   * Admin sessions and CSRF do not use it (their secrets are server-side).
   */
  SESSION_SECRET: Type.Optional(Type.String({ minLength: 32 })),
  /**
   * First-run setup. `false` (default): whoever opens the Setup screen first, while no admin exists, creates
   * the owner. `true`: setup also needs the one-time token the server logs at boot (for installs reachable by
   * others before setup). `shapio admin create` works either way.
   */
  SETUP_REQUIRE_TOKEN: Type.Boolean(),

  WORKER_MODE: Type.Enum(WORKER_MODES),
  WORKER_CONCURRENCY: Type.Integer({ minimum: 1, maximum: 64 }),
  WORKER_POLL_INTERVAL_MS: Type.Integer({ minimum: 50 }),
  JOB_LEASE_MS: Type.Integer({ minimum: 500 }),
  SHUTDOWN_TIMEOUT_MS: Type.Integer({ minimum: 0 }),
  /**
   * Days to keep finished bookkeeping: succeeded jobs, dispatched outbox events, after-hook run records,
   * resolved content health findings.
   */
  RETENTION_DAYS: Type.Integer({ minimum: 1, maximum: 3650 }),
  /** Days after which an untouched draft (or unpublished changes) shows up in the Inbox. */
  HEALTH_STALE_DAYS: Type.Integer({ minimum: 1, maximum: 3650 }),

  INSTANCE_ID: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),

  /**
   * Media storage. `local` writes under MEDIA_PATH; `s3` uses an S3-compatible service (package G). The S3
   * settings may be set with either driver: `shapio media migrate` copies between the two.
   */
  STORAGE_DRIVER: Type.Enum(STORAGE_DRIVERS),
  MEDIA_PATH: Type.String({ minLength: 1 }),
  STORAGE_S3_BUCKET: Type.Optional(Type.String({ minLength: 1 })),
  STORAGE_S3_REGION: Type.Optional(Type.String({ minLength: 1 })),
  STORAGE_S3_ENDPOINT: Type.Optional(Type.String({ pattern: '^https?://' })),
  STORAGE_S3_ACCESS_KEY_ID: Type.Optional(Type.String({ minLength: 1 })),
  STORAGE_S3_SECRET_ACCESS_KEY: Type.Optional(Type.String({ minLength: 1 })),
  STORAGE_S3_FORCE_PATH_STYLE: Type.Boolean(),
  /**
   * Base URL public media is served from, with the object key appended: a CDN or public bucket domain in
   * front of S3/R2, or a CDN whose origin is `{PUBLIC_URL}{BASE_PATH}/api/media/f`. Unset: Shapio serves it.
   */
  MEDIA_PUBLIC_BASE_URL: Type.Optional(Type.String({ pattern: '^https?://' })),
  /** Largest file an upload may be, in bytes. */
  MEDIA_MAX_UPLOAD_BYTES: Type.Integer({ minimum: 1 }),
  /** Comma-separated MIME types or `type/*` wildcards uploads may have (checked against the file's bytes). */
  MEDIA_ALLOWED_TYPES: Type.String({ minLength: 1 }),

  /**
   * The project's shapio.config.{ts,mts,js,mjs} (hooks, custom routes and services, editors, jobs; ADR 0009).
   * Default: looked up in the working directory; none means no extensions.
   */
  SHAPIO_CONFIG_PATH: Type.Optional(Type.String({ minLength: 1 })),

  /** Outgoing email (invitations, password resets). `console` logs messages instead of sending them. */
  EMAIL_TRANSPORT: Type.Enum(EMAIL_TRANSPORTS),
  /** Sender, e.g. `Shapio <cms@example.com>`. Defaults to no-reply@<PUBLIC_URL host>. */
  EMAIL_FROM: Type.Optional(Type.String({ minLength: 3 })),
  SMTP_HOST: Type.Optional(Type.String({ minLength: 1 })),
  SMTP_PORT: Type.Integer({ minimum: 1, maximum: 65535 }),
  /** true = TLS from the first byte (port 465); false = STARTTLS when the server offers it. */
  SMTP_SECURE: Type.Boolean(),
  SMTP_USER: Type.Optional(Type.String({ minLength: 1 })),
  SMTP_PASSWORD: Type.Optional(Type.String({ minLength: 1 })),

  /**
   * App users (end users of your sites and apps, package I). `true`: an app user must confirm their email
   * before signing in (needs APP_AUTH_CONFIRM_EMAIL_URL).
   */
  APP_AUTH_REQUIRE_EMAIL_CONFIRMATION: Type.Boolean(),
  /** Lifetime of an app-user access token (JWT), in seconds. Short: blocking takes effect immediately anyway. */
  APP_AUTH_ACCESS_TOKEN_TTL_SECONDS: Type.Integer({ minimum: 60, maximum: 24 * 60 * 60 }),
  /** Lifetime of an app-user refresh token, in days. Each refresh issues a new one (rotation). */
  APP_AUTH_REFRESH_TOKEN_TTL_DAYS: Type.Integer({ minimum: 1, maximum: 365 }),
  /**
   * Page on your site that confirms an email address: Shapio emails `<url>#token=…`, the page POSTs the token
   * to /api/app-auth/confirm-email. Unset: no confirmation emails are sent.
   */
  APP_AUTH_CONFIRM_EMAIL_URL: Type.Optional(Type.String({ pattern: '^https?://' })),
  /** Page on your site that sets a new password from `<url>#token=…`. Unset: password reset is unavailable. */
  APP_AUTH_RESET_PASSWORD_URL: Type.Optional(Type.String({ pattern: '^https?://' })),
  /**
   * Where OAuth sign-in may send the browser back to (comma-separated): exact origins
   * (`https://www.example.com`) or custom-scheme prefixes for native apps (`myapp://auth`). Unset: the
   * origins in CORS_ORIGINS plus PUBLIC_URL's.
   */
  APP_AUTH_RETURN_URLS: Type.Optional(Type.String({ minLength: 1 })),
  /** Sign in with Google (OAuth client of type "Web application"; callback `{PUBLIC_URL}{BASE_PATH}/api/app-auth/oauth/google/callback`). */
  APP_AUTH_GOOGLE_CLIENT_ID: Type.Optional(Type.String({ minLength: 1 })),
  APP_AUTH_GOOGLE_CLIENT_SECRET: Type.Optional(Type.String({ minLength: 1 })),
  /** Sign in with GitHub (OAuth app; callback `{PUBLIC_URL}{BASE_PATH}/api/app-auth/oauth/github/callback`). */
  APP_AUTH_GITHUB_CLIENT_ID: Type.Optional(Type.String({ minLength: 1 })),
  APP_AUTH_GITHUB_CLIENT_SECRET: Type.Optional(Type.String({ minLength: 1 })),

  /**
   * Publishing (package H). Webhooks and deploy connections never reach private, loopback or link-local
   * addresses unless the address is in this comma-separated CIDR list AND the webhook/connection opts in.
   */
  OUTBOUND_PRIVATE_NETWORK_ALLOWLIST: Type.String(),
  /**
   * Environment variables a deployment secret may reference as `${ENV:NAME}`, beyond those starting with
   * SHAPIO_SECRET_ (always allowed): comma-separated names or prefixes ending in `*`, e.g. `CF_PAGES_*`.
   */
  SECRET_ENV_ALLOWLIST: Type.String(),
  OUTBOUND_TIMEOUT_MS: Type.Integer({ minimum: 1000, maximum: 120_000 }),
  /** Cloudflare API base for the Cloudflare Pages adapter (tests point it at a local fake). */
  CLOUDFLARE_API_URL: Type.String({ pattern: '^https?://' }),
  CLOUDFLARE_DASHBOARD_URL: Type.String({ pattern: '^https?://' }),
  /** GitHub REST API base for schema write-back (GitHub Enterprise Server: https://host/api/v3). */
  GITHUB_API_URL: Type.String({ pattern: '^https?://' }),

  /** GraphQL at /api/graphql (package J). Shares REST's permissions, filters and page-size limits. */
  GRAPHQL_ENABLED: Type.Boolean(),
  GRAPHQL_MAX_DEPTH: Type.Integer({ minimum: 2, maximum: 50 }),
  /** Estimated cost ceiling per query: each field costs 1, multiplied by enclosing page sizes and lists. */
  GRAPHQL_MAX_COMPLEXITY: Type.Integer({ minimum: 10, maximum: 10_000_000 }),
  /** GraphiQL for admins at /api/graphql/playground (self-hosted assets). */
  GRAPHQL_PLAYGROUND_ENABLED: Type.Boolean(),
  /** Let anonymous callers and app users introspect the schema. Admins and API tokens always can. */
  GRAPHQL_PUBLIC_INTROSPECTION: Type.Boolean(),

  /** Count which fields delivery reads use, per token (counts only, never payloads; stays on this server). */
  USAGE_TRACKING: Type.Boolean(),
  /** Days of field-usage counters to keep. */
  USAGE_RETENTION_DAYS: Type.Integer({ minimum: 1, maximum: 3650 }),
  /** How often each instance writes its in-memory usage counters to the database. */
  USAGE_FLUSH_INTERVAL_MS: Type.Integer({ minimum: 1000, maximum: 3_600_000 }),
});

export type RawConfig = Static<typeof configSchema>;

export const CONFIG_DEFAULTS = {
  NODE_ENV: 'production',
  HOST: '127.0.0.1',
  PORT: 4300,
  LOG_LEVEL: 'info',
  LOG_PRETTY: false,
  BASE_PATH: '/',
  TRUST_PROXY: 'false',
  CORS_ORIGINS: '',
  RATE_LIMIT_MAX: 600,
  RATE_LIMIT_WINDOW_MS: 60_000,
  MEDIA_RATE_LIMIT_MAX: 6000,
  TLS_RELOAD_INTERVAL_MS: 60_000,
  DATABASE_POOL_MAX: 10,
  MIGRATE_ON_START: true,
  SETUP_REQUIRE_TOKEN: false,
  SCHEMA_LISTEN: true,
  WORKER_MODE: 'inline',
  WORKER_CONCURRENCY: 4,
  WORKER_POLL_INTERVAL_MS: 1000,
  JOB_LEASE_MS: 60_000,
  SHUTDOWN_TIMEOUT_MS: 10_000,
  RETENTION_DAYS: 30,
  HEALTH_STALE_DAYS: 14,
  STORAGE_DRIVER: 'local',
  MEDIA_PATH: './media',
  STORAGE_S3_FORCE_PATH_STYLE: false,
  MEDIA_MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
  MEDIA_ALLOWED_TYPES: 'image/*,video/*,audio/*,application/pdf,text/plain,text/csv,application/json',
  EMAIL_TRANSPORT: 'console',
  SMTP_PORT: 587,
  SMTP_SECURE: false,
  APP_AUTH_REQUIRE_EMAIL_CONFIRMATION: false,
  APP_AUTH_ACCESS_TOKEN_TTL_SECONDS: 900,
  APP_AUTH_REFRESH_TOKEN_TTL_DAYS: 30,
  OUTBOUND_PRIVATE_NETWORK_ALLOWLIST: '',
  SECRET_ENV_ALLOWLIST: '',
  OUTBOUND_TIMEOUT_MS: 10_000,
  CLOUDFLARE_API_URL: 'https://api.cloudflare.com/client/v4',
  CLOUDFLARE_DASHBOARD_URL: 'https://dash.cloudflare.com',
  GITHUB_API_URL: 'https://api.github.com',
  GRAPHQL_ENABLED: true,
  GRAPHQL_MAX_DEPTH: 10,
  GRAPHQL_MAX_COMPLEXITY: 20_000,
  GRAPHQL_PLAYGROUND_ENABLED: true,
  GRAPHQL_PUBLIC_INTROSPECTION: false,
  USAGE_TRACKING: true,
  USAGE_RETENTION_DAYS: 90,
  USAGE_FLUSH_INTERVAL_MS: 30_000,
} as const satisfies Partial<RawConfig>;
