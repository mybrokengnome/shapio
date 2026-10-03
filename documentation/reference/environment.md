# Environment variables

<!-- Generated from apps/api/src/config/schema.ts by `pnpm docs:reference`. Do not edit by hand. -->

Shapio reads all of its configuration from environment variables, validated at startup: an invalid value stops
the server with a message naming the variable. The `shapio` command also reads a `.env` file in its working
directory; variables already set in the environment win. Changing a variable needs a restart (modelling never
does).

Variables only the CLI reads (`SHAPIO_URL`, `SHAPIO_TOKEN`, `SHAPIO_ADMIN_PASSWORD`) are in the
[CLI reference](cli.md).

## Server

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `NODE_ENV` | `production` | `development`, `production`, `test` | `production` (the default) requires PUBLIC_URL. Elsewhere PUBLIC_URL defaults to where the server listens: `http://localhost:<PORT>` (or `https://` with TLS on, and HOST instead of `localhost` when HOST is not a loopback or wildcard address). Also passed to extensions (`config.nodeEnv`). |
| `HOST` | `127.0.0.1` | text | Interface to listen on. `0.0.0.0` to accept connections from other machines (Docker sets it). |
| `PORT` | `4300` | integer 0–65535 | Port of the API and admin (HTTPS when TLS is on). `0` picks a free port. |
| `PUBLIC_URL` | (unset) | URL (http or https) | Origin users reach Shapio at, e.g. https://cms.example.com. Required in production. |
| `BASE_PATH` | `/` | a path, e.g. `/cms` | Sub-path Shapio is served under, e.g. /cms. Prefixes every route and the admin. |
| `TRUST_PROXY` | `false` | `true`, `false` or a hop count | `true`, `false`, or the number of proxy hops to trust for X-Forwarded-* headers. |
| `INSTANCE_ID` | (unset) | text | Names this process in job leases and logs. Defaults to the host name and process ID. |
| `LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` | Structured log level (pino). |
| `LOG_PRETTY` | `false` | `true`, `false` | Human-readable logs; needs the `pino-pretty` dev dependency. Leave off in production. |

## HTTP and limits

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `CORS_ORIGINS` | (empty) | text | Comma-separated origins of your own sites and apps that call the API from a browser (previews included). The admin needs none. Empty disables CORS. |
| `RATE_LIMIT_MAX` | `600` | integer ≥ 1 | Requests per window and client IP, for every route without a stricter limit of its own. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | integer ≥ 1000 | The rate-limit window, in milliseconds. |
| `MEDIA_RATE_LIMIT_MAX` | `6000` | integer ≥ 1 | Requests per window and IP for public media files (`/api/media/f/*` without a signature). |

## HTTPS without a reverse proxy

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `TLS_CERT_FILE` | (unset) | text | HTTPS from certificate files. Both or neither. |
| `TLS_KEY_FILE` | (unset) | text | Private key for TLS_CERT_FILE (PEM). |
| `TLS_RELOAD_INTERVAL_MS` | `60000` | integer ≥ 1000 | How often the certificate files are re-read; a changed pair is applied without a restart. |
| `HTTP_PORT` | (unset) | integer 0–65535 | Plain-HTTP listener that redirects to HTTPS on PUBLIC_URL. Only with TLS_CERT_FILE/TLS_KEY_FILE. |

## Database

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | **required** | text | PostgreSQL (16 or later) connection string, `mysql://user:password@host:3306/database` for MySQL 8.4 (see MySQL), or `sqlite:<path>` for a single-process SQLite database (see SQLite). |
| `DATABASE_POOL_MAX` | `10` | integer 2–200 | Connections in the pool, per process (SQLite: read connections; one connection writes). |
| `MIGRATE_ON_START` | `true` | `true`, `false` | Apply pending migrations at startup, under an advisory lock (safe with several instances). |
| `SCHEMA_LISTEN` | `true` | `true`, `false` | LISTEN for schema-change notifications to refresh caches early. Turn off where LISTEN does not work (e.g. PgBouncer in transaction mode); every request still checks the durable schema version. |

## Secrets

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `SESSION_SECRET` | (unset) | text (at least 32 characters) | The instance's general signing secret (preview tokens, private-media URLs and upload grants, app-user token keys, the key that encrypts stored webhook and deployment secrets). At least 32 characters. Optional: when unset, one is generated on first boot and stored in the database (system_settings). Admin sessions and CSRF do not use it (their secrets are server-side). |

## First-run setup

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `SETUP_REQUIRE_TOKEN` | `false` | `true`, `false` | First-run setup. `false` (default): whoever opens the Setup screen first, while no admin exists, creates the owner. `true`: setup also needs the one-time token the server logs at boot (for installs reachable by others before setup). `shapio admin create` works either way. |

## Jobs and worker

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `WORKER_MODE` | `inline` | `inline`, `dedicated` | `inline` runs the job worker inside the API process; `dedicated` expects a separate `shapio worker` process (PostgreSQL only). |
| `WORKER_CONCURRENCY` | `4` | integer 1–64 | Jobs one worker runs at the same time. |
| `WORKER_POLL_INTERVAL_MS` | `1000` | integer ≥ 50 | How often an idle worker looks for due jobs. |
| `JOB_LEASE_MS` | `60000` | integer ≥ 500 | How long a claimed job is reserved before another worker may take it over (renewed while it runs). |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | integer ≥ 0 | On SIGTERM/SIGINT, how long running jobs and requests get to finish. |
| `RETENTION_DAYS` | `30` | integer 1–3650 | Days to keep finished bookkeeping: succeeded jobs, dispatched outbox events, after-hook run records, resolved content health findings. |
| `HEALTH_STALE_DAYS` | `14` | integer 1–3650 | Days after which an untouched draft (or unpublished changes) shows up in the Inbox. |

## Media storage

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `local`, `s3` | Media storage. `local` writes under MEDIA_PATH; `s3` uses an S3-compatible service. The S3 settings may be set with either driver: `shapio media migrate` copies between the two. |
| `MEDIA_PATH` | `./media` | text | Directory of the local storage driver (and of `shapio media migrate`). Back it up with the database. |
| `STORAGE_S3_BUCKET` | (unset) | text | S3 bucket for media. Setting it makes the S3 adapter available (also for `shapio media migrate`). |
| `STORAGE_S3_REGION` | (unset) | text | S3 region (`auto` for Cloudflare R2). |
| `STORAGE_S3_ENDPOINT` | (unset) | URL (http or https) | S3-compatible endpoint, e.g. `https://<account id>.r2.cloudflarestorage.com`. Omit for AWS S3. |
| `STORAGE_S3_ACCESS_KEY_ID` | (unset) | text | Access key for the bucket. |
| `STORAGE_S3_SECRET_ACCESS_KEY` | (unset) | text | Secret key for the bucket. |
| `STORAGE_S3_FORCE_PATH_STYLE` | `false` | `true`, `false` | Path-style bucket URLs; most self-hosted S3 services (versitygw, Garage, SeaweedFS) need it. |
| `MEDIA_PUBLIC_BASE_URL` | (unset) | URL (http or https) | Base URL public media is served from, with the object key appended: a CDN or public bucket domain in front of S3/R2, or a CDN whose origin is `{PUBLIC_URL}{BASE_PATH}/api/media/f`. Unset: Shapio serves it. |
| `MEDIA_MAX_UPLOAD_BYTES` | `104857600` | integer ≥ 1 | Largest file an upload may be, in bytes. |
| `MEDIA_ALLOWED_TYPES` | `image/*,video/*,audio/*,application/pdf,text/plain,text/csv,application/json` | text | Comma-separated MIME types or `type/*` wildcards uploads may have (checked against the file's bytes). |

## Email

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `EMAIL_TRANSPORT` | `console` | `console`, `smtp` | Outgoing email (invitations, password resets). `console` logs messages instead of sending them. |
| `EMAIL_FROM` | (unset) | text (at least 3 characters) | Sender, e.g. `Shapio <cms@example.com>`. Defaults to no-reply@<PUBLIC_URL host>. |
| `SMTP_HOST` | (unset) | text | SMTP server (EMAIL_TRANSPORT=smtp). |
| `SMTP_PORT` | `587` | integer 1–65535 | SMTP port. |
| `SMTP_SECURE` | `false` | `true`, `false` | true = TLS from the first byte (port 465); false = STARTTLS when the server offers it. |
| `SMTP_USER` | (unset) | text | SMTP user name. |
| `SMTP_PASSWORD` | (unset) | text | SMTP password. |

## App users (end users of your sites and apps)

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `APP_AUTH_REQUIRE_EMAIL_CONFIRMATION` | `false` | `true`, `false` | App users (end users of your sites and apps). `true`: an app user must confirm their email before signing in (needs APP_AUTH_CONFIRM_EMAIL_URL). |
| `APP_AUTH_ACCESS_TOKEN_TTL_SECONDS` | `900` | integer 60–86400 | Lifetime of an app-user access token (JWT), in seconds. Short: blocking takes effect immediately anyway. |
| `APP_AUTH_REFRESH_TOKEN_TTL_DAYS` | `30` | integer 1–365 | Lifetime of an app-user refresh token, in days. Each refresh issues a new one (rotation). |
| `APP_AUTH_CONFIRM_EMAIL_URL` | (unset) | URL (http or https) | Page on your site that confirms an email address: Shapio emails `<url>#token=…`, the page POSTs the token to /api/app-auth/confirm-email. Unset: no confirmation emails are sent. |
| `APP_AUTH_RESET_PASSWORD_URL` | (unset) | URL (http or https) | Page on your site that sets a new password from `<url>#token=…`. Unset: password reset is unavailable. |
| `APP_AUTH_RETURN_URLS` | (unset) | text | Where OAuth sign-in may send the browser back to (comma-separated): exact origins (`https://www.example.com`) or custom-scheme prefixes for native apps (`myapp://auth`). Unset: the origins in CORS_ORIGINS plus PUBLIC_URL's. |
| `APP_AUTH_GOOGLE_CLIENT_ID` | (unset) | text | Sign in with Google (OAuth client of type "Web application"; callback `{PUBLIC_URL}{BASE_PATH}/api/app-auth/oauth/google/callback`). |
| `APP_AUTH_GOOGLE_CLIENT_SECRET` | (unset) | text | Secret of the Google OAuth client. |
| `APP_AUTH_GITHUB_CLIENT_ID` | (unset) | text | Sign in with GitHub (OAuth app; callback `{PUBLIC_URL}{BASE_PATH}/api/app-auth/oauth/github/callback`). |
| `APP_AUTH_GITHUB_CLIENT_SECRET` | (unset) | text | Secret of the GitHub OAuth app. |

## Publishing: webhooks and deployments

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `OUTBOUND_PRIVATE_NETWORK_ALLOWLIST` | (empty) | text | Publishing. Webhooks and deploy connections never reach private, loopback or link-local addresses unless the address is in this comma-separated CIDR list AND the webhook/connection opts in. |
| `SECRET_ENV_ALLOWLIST` | (empty) | text | Environment variables a deployment secret may reference as `${ENV:NAME}`, beyond those starting with SHAPIO_SECRET_ (always allowed): comma-separated names or prefixes ending in `*`, e.g. `CF_PAGES_*`. |
| `OUTBOUND_TIMEOUT_MS` | `10000` | integer 1000–120000 | Timeout of each outbound webhook, deploy hook and provider API request. |
| `CLOUDFLARE_API_URL` | `https://api.cloudflare.com/client/v4` | URL (http or https) | Cloudflare API base for the Cloudflare Pages adapter (tests point it at a local fake). |
| `CLOUDFLARE_DASHBOARD_URL` | `https://dash.cloudflare.com` | URL (http or https) | Cloudflare dashboard base, for the build-log links shown on deployment runs. |
| `GITHUB_API_URL` | `https://api.github.com` | URL (http or https) | GitHub REST API base for schema write-back (GitHub Enterprise Server: https://host/api/v3). |
| `VERCEL_API_URL` | `https://api.vercel.com` | URL (http or https) | Vercel REST API base for the Vercel adapter's deployment status (tests point it at a local fake). |
| `NETLIFY_API_URL` | `https://api.netlify.com` | URL (http or https) | Netlify API base for the Netlify adapter's builds and deploy status (tests point it at a local fake). |

## GraphQL

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `GRAPHQL_ENABLED` | `true` | `true`, `false` | GraphQL at /api/graphql. Shares REST's permissions, filters and page-size limits. |
| `GRAPHQL_MAX_DEPTH` | `10` | integer 2–50 | Deepest query nesting GraphQL accepts. |
| `GRAPHQL_MAX_COMPLEXITY` | `20000` | integer 10–10000000 | Estimated cost ceiling per query: each field costs 1, multiplied by enclosing page sizes and lists. |
| `GRAPHQL_PLAYGROUND_ENABLED` | `true` | `true`, `false` | GraphiQL for admins at /api/graphql/playground (self-hosted assets). |
| `GRAPHQL_PUBLIC_INTROSPECTION` | `false` | `true`, `false` | Let anonymous callers and app users introspect the schema. Admins and API tokens always can. |

## Field usage

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `USAGE_TRACKING` | `true` | `true`, `false` | Count which fields delivery reads use, per token (counts only, never payloads; stays on this server). |
| `USAGE_RETENTION_DAYS` | `90` | integer 1–3650 | Days of field-usage counters to keep. |
| `USAGE_FLUSH_INTERVAL_MS` | `30000` | integer 1000–3600000 | How often each instance writes its in-memory usage counters to the database. |

## Assist (your own model provider; off unless AI_PROVIDER is set)

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `AI_PROVIDER` | (unset) | `anthropic`, `openai`, `openai-compatible` | Editor assists (alt text, summaries, translation, rewrites, schema drafts) with your own model provider. Unset (the default): assist is off and nothing is ever sent to a model provider. `openai-compatible` covers Ollama, LM Studio and vLLM (set AI_BASE_URL). See documentation/assist.md. |
| `AI_MODEL` | (unset) | text | The model name the provider expects, e.g. a model ID or `llama3.2-vision`. Required with AI_PROVIDER. |
| `AI_API_KEY` | (unset) | text | The provider API key. Required for `anthropic` and `openai`; optional for `openai-compatible`. |
| `AI_BASE_URL` | (unset) | URL (http or https) | The provider's API base including its version path, e.g. `http://127.0.0.1:11434/v1` for Ollama (Shapio appends `/chat/completions` or `/messages`). Required for `openai-compatible`; overrides the public endpoint for the others. Loopback and private addresses are allowed: this is operator configuration. |
| `AI_MAX_TOKENS` | `8192` | integer 256–128000 | Most tokens one model response may use. |
| `AI_TIMEOUT_MS` | `60000` | integer 1000–600000 | Timeout of each request to the model provider. |
| `AI_RATE_LIMIT_MAX` | `20` | integer 1–10000 | Assist requests per minute and admin (or admin API token). |

## Extensions

| Variable | Default | Values | Description |
| --- | --- | --- | --- |
| `SHAPIO_CONFIG_PATH` | (unset) | text | The project's shapio.config.{ts,mts,js,mjs} (hooks, custom routes and services, editors, jobs). Default: looked up in the working directory; none means no extensions. |
