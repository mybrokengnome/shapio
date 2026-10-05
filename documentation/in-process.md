# In-process delivery (`@shapio/local`)

A site's server can read Shapio's delivery API as function calls in its own process, from Shapio's database,
with no HTTP request to Shapio. The calls, the answers and the errors are the same as over HTTP: the same
permissions, the same response shapes (`populate`, `richText`, `seo=resolved`, pinned snapshots) and the same
`ShapioApiError`s, because the same code answers them. Use it when the site runs beside the database (one
server, one container network, one VPC) and every request counts.

```sh
npm install @shapio/local@<the release your Shapio server runs>
```

```ts
import { createLocalClient } from '@shapio/local';

export const shapio = createLocalClient({
  databaseUrl: process.env.DATABASE_URL!, // Shapio's own database
  token: process.env.SHAPIO_DELIVERY_TOKEN, // a delivery token; leave it out to read as an anonymous caller
  site: process.env.SHAPIO_SITE, // optional, as over HTTP
});

const { data } = await shapio.delivery.list<Article>('articles', { locale: 'fr', populate: ['author'] });
```

`createLocalClient` returns the `delivery`, `site` and `snapshots` groups of `@shapio/client` (the same methods
and types as `createClient`) and `close()`. Creating it reads nothing; the first call does.

Model changes made in the admin show on the next call, without restarting the site: every call reads the schema
and permission versions first, exactly like a request to the server, and reloads what moved.

## Requirements

- **PostgreSQL or MySQL.** A SQLite database is served by one process only; `createLocalClient` refuses it.
  Read over HTTP with `@shapio/client` instead.
- **The Node.js runtime.** Not the Edge runtime (Next.js middleware, `runtime = 'edge'` routes): it opens
  database connections. `@shapio/local` refuses it with an explanation.
- **The server's exact release.** Install the same version of `@shapio/local` as the Shapio server (`shapio
version`). The server records its release in the database each time it starts; until a server of your
  release has started once, reads fail with `VERSION_SKEW`. See [Upgrades](#upgrades).
- **The Shapio server keeps running.** It applies schema changes, runs jobs, serves the admin, media files,
  previews and webhooks. The site only reads.

## What the site can see

In-process reads are delivery reads: published content only, through the delivery token's role (or the
site's `public` role without a token), with hidden fields hidden. Admin API tokens are refused
(`403 DELIVERY_TOKEN_REQUIRED`), and there is no way to read drafts, previews or the admin API in process.
GraphQL and writes are not available in process either; use the HTTP API for them.

**The trust boundary moves.** The token decides what these calls return, but whoever holds `DATABASE_URL` can
read everything in Shapio's database: drafts, private media records, users, sessions. Give the site its own
database role that can only read:

```sql
-- PostgreSQL, as the role that owns Shapio's tables:
CREATE ROLE shapio_site LOGIN PASSWORD '…';
GRANT CONNECT ON DATABASE shapio TO shapio_site;
GRANT USAGE ON SCHEMA public TO shapio_site;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO shapio_site;
-- Tables added by later Shapio releases:
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO shapio_site;
```

```sql
-- MySQL:
CREATE USER 'shapio_site'@'%' IDENTIFIED BY '…';
GRANT SELECT ON shapio.* TO 'shapio_site'@'%';
```

Nothing on the in-process read path writes, so a read-only role is all it needs. It is still the full content
of the database to read: keep the site's server as private as the database itself.

## Differences from HTTP

- **A token's "last used" is not updated** by in-process reads (they never write). Settings → API tokens shows
  when the token last read over HTTP.
- **Field usage is not counted** for in-process reads, so the admin's field usage (unused fields, the readers of
  a field) only reflects HTTP traffic.
- **No rate limits, CORS or HTTP caching headers**: there is no HTTP request. ETags and `Cache-Control` belong to
  the HTTP API.
- **Next.js's data cache does not see in-process reads** (they do not go through `fetch`), so the client's
  `next` options and its cache tags have no effect here. Cache where you call; see below.

## Next.js

Add the package to `serverExternalPackages`, so Next loads it once per server process from `node_modules` rather
than bundling a copy into each route (each copy would open its own database pool):

```ts
// next.config.ts
const nextConfig: NextConfig = { serverExternalPackages: ['@shapio/local'] };
```

**Caching.** Tag cached reads with `shapioTags`, the tags HTTP reads carry, so the same `revalidateTag` calls
(your `/api/revalidate` route) refresh them. With `cacheComponents` on:

```ts
import { cacheTag } from 'next/cache';
import { shapioTags } from '@shapio/local/next';

export const getArticles = async (locale: string) => {
  'use cache';
  cacheTag(shapioTags.site(), shapioTags.model('articles'));
  return (await shapio.delivery.list<Article>('articles', { locale })).data;
};
```

Without `cacheComponents`, wrap the read in `unstable_cache(read, [key], { tags: [...] })`. The package cannot
tag reads for you: Next.js 16 only allows `cacheTag()` inside a `"use cache"` function, with `cacheComponents`
on. Reads pinned to a snapshot (`snapshot: N`) never change, so they are safe to cache without a tag.

The [Next.js starter](starters.md) reads in process with `SHAPIO_MODE=in-process` and `DATABASE_URL`.

## Connections

Each process opens one pool for the database (`poolMax`, default 4), shared by every local client in it.

- **`next build`** renders pages in several worker processes, each with its own pool: workers × `poolMax`
  connections at most, during the build. Lower `poolMax` (or Next's `experimental.cpus`) if the database has
  few connections to spare.
- **Serverless functions** (Vercel, Netlify): set `poolMax: 1` or `2`, since every warm instance holds its own
  pool, and connect through a pooler (PgBouncer in transaction mode, Neon's or Supabase's pooled URL). Nothing
  in process needs a session (no `LISTEN`, no session locks), so transaction pooling works. Each cold instance
  loads the schema and the permissions once, on its first call.
- `acquireTimeoutMs` (default 10 s) bounds how long a read waits for a pooled connection before it fails with
  `503`.

`close()` releases a client; the pool closes when the last client of the process is closed. Servers never need
to call it; scripts and tests do.

## Private media

Public media URLs come from the server's own settings (`PUBLIC_URL`, `BASE_PATH`, `MEDIA_PUBLIC_BASE_URL`), which
the server records in the database when it starts, so they always match what the HTTP API returns. Private
media that a token may read gets signed, expiring URLs, and signing needs a secret the site does not otherwise
have:

- **Local disk**: Shapio's signing secret. By default `@shapio/local` uses the one the server generated and
  stored; if the server sets `SESSION_SECRET`, pass the same value as `signingSecret`.
- **S3**: credentials that may sign reads from the bucket, as `s3Credentials` (or the AWS SDK's environment
  variables). For S3, also install `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` and
  `@aws-sdk/s3-presigned-post`; for MySQL, `mysql2`. They are optional peer dependencies, loaded only when used.

Both are secrets: they let the holder sign URLs for any private file. Leave them out unless the site shows private
media.

## Upgrades

`@shapio/local` refuses to read a database served by another Shapio release: a release may change the
database's tables or what they mean. Such a call throws `ShapioVersionSkewError` (a `ShapioApiError` with
status `503` and code `VERSION_SKEW`) naming both releases.

Upgrade in this order:

1. Upgrade the Shapio server. It migrates and records its new release when it starts.
2. Deploy the site with the same `@shapio/local` version.

Between the two, in-process reads fail. To keep serving, pass `onVersionSkew: 'http'` and
`fallbackUrl: '<the Shapio server URL>'`: calls then go over HTTP until the releases match, and the switch
back is automatic. Pages rendered at build time are unaffected; only reads made in between are.

## Options

| Option             | Default                        | Meaning                                                            |
| ------------------ | ------------------------------ | ------------------------------------------------------------------ |
| `databaseUrl`      | required                       | Shapio's database (`postgres://…` or `mysql://…`)                  |
| `token`            | none (anonymous)               | a delivery API token                                               |
| `site`             | the token's site, else primary | the site key                                                       |
| `poolMax`          | 4                              | connections in the process's pool                                  |
| `acquireTimeoutMs` | 10000                          | wait for a pooled connection before a 503                          |
| `signingSecret`    | the server's stored secret     | private local media; the server's `SESSION_SECRET` when it sets it |
| `s3Credentials`    | the AWS SDK's credential chain | private S3 media                                                   |
| `onVersionSkew`    | `'throw'`                      | `'http'` reads over HTTP from `fallbackUrl` during a release skew  |
| `fallbackUrl`      | none                           | the Shapio server's URL, with `BASE_PATH`                          |
| `logger`           | pino, warnings and errors only | a pino logger for failures                                         |
