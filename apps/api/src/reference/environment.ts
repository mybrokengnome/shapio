import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TSchema } from 'typebox';
import ts from 'typescript';
import { CONFIG_DEFAULTS, configSchema } from '../config/schema.js';

/**
 * Generates documentation/reference/environment.md from config/schema.ts, the only place Shapio names its
 * environment variables: names, types, defaults and allowed values from the TypeBox schema, descriptions from
 * its JSDoc comments (or from NOTES below for the few without one). `reference.test.ts` fails when the page
 * and the schema drift apart. Documentation tooling only: not part of the server bundle.
 */
const SCHEMA_SOURCE = resolve(import.meta.dirname, '../config/schema.ts');

/** Descriptions for variables without a JSDoc comment in config/schema.ts. */
export const NOTES: Readonly<Record<string, string>> = {
  NODE_ENV:
    '`production` (the default) requires PUBLIC_URL. Elsewhere PUBLIC_URL defaults to where the server listens: `http://localhost:<PORT>` (or `https://` with TLS on, and HOST instead of `localhost` when HOST is not a loopback or wildcard address). Also passed to extensions (`config.nodeEnv`).',
  HOST: 'Interface to listen on. `0.0.0.0` to accept connections from other machines (Docker sets it).',
  PORT: 'Port of the API and admin (HTTPS when TLS is on). `0` picks a free port.',
  LOG_LEVEL: 'Structured log level (pino).',
  LOG_PRETTY: 'Human-readable logs; needs the `pino-pretty` dev dependency. Leave off in production.',
  CORS_ORIGINS:
    'Comma-separated origins of your own sites and apps that call the API from a browser (previews included). The admin needs none. Empty disables CORS.',
  RATE_LIMIT_MAX: 'Requests per window and client IP, for every route without a stricter limit of its own.',
  RATE_LIMIT_WINDOW_MS: 'The rate-limit window, in milliseconds.',
  TLS_KEY_FILE: 'Private key for TLS_CERT_FILE (PEM).',
  DATABASE_URL:
    'PostgreSQL (16 or later) connection string, `mysql://user:password@host:3306/database` for MySQL 8.4 (see MySQL), or `sqlite:<path>` for a single-process SQLite database (see SQLite).',
  DATABASE_POOL_MAX:
    'Connections in the pool, per process (SQLite: read connections; one connection writes).',
  MIGRATE_ON_START:
    'Apply pending migrations at startup, under an advisory lock (safe with several instances).',
  WORKER_MODE:
    '`inline` runs the job worker inside the API process; `dedicated` expects a separate `shapio worker` process (PostgreSQL only).',
  WORKER_CONCURRENCY: 'Jobs one worker runs at the same time.',
  WORKER_POLL_INTERVAL_MS: 'How often an idle worker looks for due jobs.',
  JOB_LEASE_MS:
    'How long a claimed job is reserved before another worker may take it over (renewed while it runs).',
  SHUTDOWN_TIMEOUT_MS: 'On SIGTERM/SIGINT, how long running jobs and requests get to finish.',
  INSTANCE_ID: 'Names this process in job leases and logs. Defaults to the host name and process ID.',
  MEDIA_PATH:
    'Directory of the local storage driver (and of `shapio media migrate`). Back it up with the database.',
  OUTBOUND_TIMEOUT_MS: 'Timeout of each outbound webhook, deploy hook and provider API request.',
  GRAPHQL_MAX_DEPTH: 'Deepest query nesting GraphQL accepts.',
  STORAGE_S3_BUCKET:
    'S3 bucket for media. Setting it makes the S3 adapter available (also for `shapio media migrate`).',
  STORAGE_S3_REGION: 'S3 region (`auto` for Cloudflare R2).',
  STORAGE_S3_ENDPOINT:
    'S3-compatible endpoint, e.g. `https://<account id>.r2.cloudflarestorage.com`. Omit for AWS S3.',
  STORAGE_S3_ACCESS_KEY_ID: 'Access key for the bucket.',
  STORAGE_S3_SECRET_ACCESS_KEY: 'Secret key for the bucket.',
  STORAGE_S3_FORCE_PATH_STYLE:
    'Path-style bucket URLs; most self-hosted S3 services (versitygw, Garage, SeaweedFS) need it.',
  SMTP_HOST: 'SMTP server (EMAIL_TRANSPORT=smtp).',
  SMTP_PORT: 'SMTP port.',
  SMTP_USER: 'SMTP user name.',
  SMTP_PASSWORD: 'SMTP password.',
  APP_AUTH_GOOGLE_CLIENT_SECRET: 'Secret of the Google OAuth client.',
  APP_AUTH_GITHUB_CLIENT_SECRET: 'Secret of the GitHub OAuth app.',
  CLOUDFLARE_DASHBOARD_URL: 'Cloudflare dashboard base, for the build-log links shown on deployment runs.',
};

/** The page's sections, in order. Every variable belongs to exactly one (checked by the test). */
export const GROUPS: ReadonlyArray<{ title: string; keys: readonly string[] }> = [
  {
    title: 'Server',
    keys: [
      'NODE_ENV',
      'HOST',
      'PORT',
      'PUBLIC_URL',
      'BASE_PATH',
      'TRUST_PROXY',
      'INSTANCE_ID',
      'LOG_LEVEL',
      'LOG_PRETTY',
    ],
  },
  {
    title: 'HTTP and limits',
    keys: ['CORS_ORIGINS', 'RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW_MS', 'MEDIA_RATE_LIMIT_MAX'],
  },
  {
    title: 'HTTPS without a reverse proxy',
    keys: ['TLS_CERT_FILE', 'TLS_KEY_FILE', 'TLS_RELOAD_INTERVAL_MS', 'HTTP_PORT'],
  },
  {
    title: 'Database',
    keys: [
      'DATABASE_URL',
      'DATABASE_POOL_MAX',
      'DATABASE_POOL_ACQUIRE_TIMEOUT_MS',
      'MIGRATE_ON_START',
      'SCHEMA_LISTEN',
    ],
  },
  { title: 'Secrets', keys: ['SESSION_SECRET'] },
  { title: 'First-run setup', keys: ['SETUP_REQUIRE_TOKEN'] },
  {
    title: 'Jobs and worker',
    keys: [
      'WORKER_MODE',
      'WORKER_CONCURRENCY',
      'WORKER_POLL_INTERVAL_MS',
      'JOB_LEASE_MS',
      'SHUTDOWN_TIMEOUT_MS',
      'RETENTION_DAYS',
      'HEALTH_STALE_DAYS',
    ],
  },
  {
    title: 'Media storage',
    keys: [
      'STORAGE_DRIVER',
      'MEDIA_PATH',
      'STORAGE_S3_BUCKET',
      'STORAGE_S3_REGION',
      'STORAGE_S3_ENDPOINT',
      'STORAGE_S3_ACCESS_KEY_ID',
      'STORAGE_S3_SECRET_ACCESS_KEY',
      'STORAGE_S3_FORCE_PATH_STYLE',
      'MEDIA_PUBLIC_BASE_URL',
      'MEDIA_MAX_UPLOAD_BYTES',
      'MEDIA_ALLOWED_TYPES',
    ],
  },
  {
    title: 'Email',
    keys: [
      'EMAIL_TRANSPORT',
      'EMAIL_FROM',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_SECURE',
      'SMTP_USER',
      'SMTP_PASSWORD',
    ],
  },
  {
    title: 'App users (end users of your sites and apps)',
    keys: [
      'APP_AUTH_REQUIRE_EMAIL_CONFIRMATION',
      'APP_AUTH_ACCESS_TOKEN_TTL_SECONDS',
      'APP_AUTH_REFRESH_TOKEN_TTL_DAYS',
      'APP_AUTH_CONFIRM_EMAIL_URL',
      'APP_AUTH_RESET_PASSWORD_URL',
      'APP_AUTH_RETURN_URLS',
      'APP_AUTH_GOOGLE_CLIENT_ID',
      'APP_AUTH_GOOGLE_CLIENT_SECRET',
      'APP_AUTH_GITHUB_CLIENT_ID',
      'APP_AUTH_GITHUB_CLIENT_SECRET',
    ],
  },
  {
    title: 'Publishing: webhooks and deployments',
    keys: [
      'OUTBOUND_PRIVATE_NETWORK_ALLOWLIST',
      'SECRET_ENV_ALLOWLIST',
      'OUTBOUND_TIMEOUT_MS',
      'CLOUDFLARE_API_URL',
      'CLOUDFLARE_DASHBOARD_URL',
      'GITHUB_API_URL',
      'VERCEL_API_URL',
      'NETLIFY_API_URL',
    ],
  },
  {
    title: 'GraphQL',
    keys: [
      'GRAPHQL_ENABLED',
      'GRAPHQL_MAX_DEPTH',
      'GRAPHQL_MAX_COMPLEXITY',
      'GRAPHQL_PLAYGROUND_ENABLED',
      'GRAPHQL_PUBLIC_INTROSPECTION',
    ],
  },
  {
    title: 'Field usage',
    keys: ['USAGE_TRACKING', 'USAGE_RETENTION_DAYS', 'USAGE_FLUSH_INTERVAL_MS'],
  },
  {
    title: 'Assist (your own model provider; off unless AI_PROVIDER is set)',
    keys: [
      'AI_PROVIDER',
      'AI_MODEL',
      'AI_API_KEY',
      'AI_BASE_URL',
      'AI_MAX_TOKENS',
      'AI_TIMEOUT_MS',
      'AI_RATE_LIMIT_MAX',
    ],
  },
  { title: 'Extensions', keys: ['SHAPIO_CONFIG_PATH'] },
];

/** Whitespace collapsed; references to internal build-plan packages and ADRs dropped (they are not public docs). */
const normalize = (text: string) =>
  text
    .replace(/\s+/g, ' ')
    .replace(/ \(package [A-Z]\)/g, '')
    .replace(/, package [A-Z]\)/g, ')')
    .replace(/; ADR \d{4}\)/g, ')')
    .trim();

/** The JSDoc comment of each `configSchema` property, read from the source file. */
export const readSchemaComments = (sourceText = readFileSync(SCHEMA_SOURCE, 'utf8')): Map<string, string> => {
  const source = ts.createSourceFile('schema.ts', sourceText, ts.ScriptTarget.Latest, true);
  const comments = new Map<string, string>();
  const visit = (node: ts.Node) => {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const docs = ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc);
      const text = docs.map((doc) => ts.getTextOfJSDocComment(doc.comment) ?? '').join(' ');
      if (text) {
        comments.set(node.name.text, normalize(text));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return comments;
};

type SchemaProperty = TSchema & {
  type?: string;
  enum?: readonly string[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  minLength?: number;
};

const propertiesOf = () =>
  configSchema as unknown as { properties: Record<string, SchemaProperty>; required?: string[] };

/** Readable names for the schema's patterns. */
const PATTERN_LABELS: Readonly<Record<string, string>> = {
  '^/([A-Za-z0-9._~-]+(/[A-Za-z0-9._~-]+)*)?/?$': 'a path, e.g. `/cms`',
  '^(true|false|[0-9]+)$': '`true`, `false` or a hop count',
  '^[^@\\s]+@[^@\\s]+$': 'an email address',
};

const describeType = (schema: SchemaProperty): string => {
  if (schema.enum) {
    return schema.enum.map((value) => `\`${value}\``).join(', ');
  }
  if (schema.type === 'boolean') {
    return '`true`, `false`';
  }
  if (schema.type === 'integer') {
    const range =
      schema.minimum !== undefined && schema.maximum !== undefined
        ? ` ${schema.minimum}–${schema.maximum}`
        : schema.minimum !== undefined
          ? ` ≥ ${schema.minimum}`
          : '';
    return `integer${range}`;
  }
  const label = schema.pattern ? PATTERN_LABELS[schema.pattern] : undefined;
  if (label) {
    return label;
  }
  if (schema.pattern === '^https?://') {
    return 'URL (http or https)';
  }
  if (schema.pattern === '^https://') {
    return 'URL (https)';
  }
  if (schema.pattern) {
    return `text matching \`${schema.pattern}\``;
  }
  return schema.minLength && schema.minLength > 1 ? `text (at least ${schema.minLength} characters)` : 'text';
};

const describeDefault = (name: string, required: boolean): string => {
  const value = (CONFIG_DEFAULTS as Readonly<Record<string, string | number | boolean | undefined>>)[name];
  if (value !== undefined) {
    return value === '' ? '(empty)' : `\`${String(value)}\``;
  }
  return required ? '**required**' : '(unset)';
};

const escapeCell = (text: string) => text.replace(/\|/g, '\\|');

export const renderEnvironmentReference = (comments = readSchemaComments()): string => {
  const { properties, required = [] } = propertiesOf();
  const lines = [
    '# Environment variables',
    '',
    '<!-- Generated from apps/api/src/config/schema.ts by `pnpm docs:reference`. Do not edit by hand. -->',
    '',
    'Shapio reads all of its configuration from environment variables, validated at startup: an invalid value stops',
    'the server with a message naming the variable. The `shapio` command also reads a `.env` file in its working',
    'directory; variables already set in the environment win. Changing a variable needs a restart (modelling never',
    'does).',
    '',
    'Variables only the CLI reads (`SHAPIO_URL`, `SHAPIO_TOKEN`, `SHAPIO_ADMIN_PASSWORD`) are in the',
    '[CLI reference](cli.md).',
  ];
  for (const group of GROUPS) {
    lines.push(
      '',
      `## ${group.title}`,
      '',
      '| Variable | Default | Values | Description |',
      '| --- | --- | --- | --- |',
    );
    for (const name of group.keys) {
      const schema = properties[name];
      if (!schema) {
        throw new Error(`${name} is listed in GROUPS but not in config/schema.ts`);
      }
      const description = comments.get(name) ?? NOTES[name] ?? '';
      lines.push(
        `| \`${name}\` | ${describeDefault(name, required.includes(name))} | ${escapeCell(describeType(schema))} | ${escapeCell(description)} |`,
      );
    }
  }
  return `${lines.join('\n')}\n`;
};

/** Variables in config/schema.ts, for the drift test. */
export const schemaVariables = () => Object.keys(propertiesOf().properties);
