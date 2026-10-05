# Shapio starter: Next.js

A [Next.js](https://nextjs.org) (App Router) site built from [Shapio](https://github.com/mybrokengnome/shapio)
content: pages made of sections, a journal of articles with an author, and the `siteSettings` singleton, in
English and French. Every page is generated at build time from one pinned publication snapshot and served by
`next start`, which refreshes only the pages a publish changed (on-demand revalidation, below).

You need a running Shapio (>= 0.1) with an owner account.

```sh
npm install
SHAPIO_URL=http://localhost:4300 SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD='…' npm run seed
npm run build
npm run start       # http://localhost:3000/ (redirects to /en/)
npm run smoke       # in another shell: checks the served pages over HTTP
npm run smoke -- --revalidate   # also checks /api/revalidate with a signed test event
npm test            # unit tests (path mapping, signature check)
```

`npm run seed` applies the models in `shapio/` to Shapio live, creates the content and writes `SHAPIO_URL` and
`SHAPIO_DELIVERY_TOKEN` to `.env`. `SHAPIO_SNAPSHOT` pins a build to an exact snapshot (by default
`next.config.ts` pins the latest one when the build starts); `SHAPIO_SITE` picks the site on a multi-site
instance. Next.js telemetry is off: `NEXT_TELEMETRY_DISABLED=1` in the npm scripts and `.env.example`.

| File                         | Role                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| `next.config.ts`             | pins the snapshot; `/` redirects to `/en/`; `frame-ancestors`      |
| `src/lib/shapio.ts`          | reads the delivery API at the pinned snapshot                      |
| `src/lib/shapioClient.ts`    | over HTTP (`@shapio/client`) or in process (`@shapio/local`)       |
| `src/app/[locale]/…`         | the layout (site settings), pages, articles and the colophon       |
| `src/components/…`           | sections, articles and responsive images                           |
| `src/app/preview/`           | draft preview with visual editing (`@shapio/visual`)               |
| `src/app/api/revalidate/`    | the webhook target: on-demand revalidation of changed pages        |
| `src/lib/revalidation*.ts`   | the snapshot diff, and which pages and cache tags a change touches |
| `shapio/`, `scripts/seed.ts` | the models and the seed                                            |

Drafts mode, for your development server: set `SHAPIO_DRAFTS=true` in `.env` and `npm run dev` shows saved
drafts instead of published content, fresh on every reload, with a **Drafts** badge on every page. Save in
Shapio, reload, and the change is there; publishing still rebuilds the live site. It reads with
`SHAPIO_DEV_DELIVERY_TOKEN`, the seed's `<site> dev` token, whose delivery role grants Read drafts (a token
without it fails with `DRAFTS_FORBIDDEN`). Never put that token or the flag in a production environment.
`npm run smoke:drafts` checks a running drafts-mode dev server
(http://localhost:3000; needs `SHAPIO_ADMIN_EMAIL`/`PASSWORD` to save a test change, which it puts back). Guide:
[drafts mode](https://github.com/mybrokengnome/shapio/blob/main/documentation/starters.md#drafts-mode).

Preview: the seed creates a deployment connection named **Preview** that opens drafts at
`http://localhost:3000/preview/` (set `SITE_URL` when seeding for another address). Add that origin to Shapio's
`CORS_ORIGINS`. In Shapio's preview pane, clicking the title, body or cover focuses that field and saves
re-render the draft ([visual editing](https://github.com/mybrokengnome/shapio/blob/main/documentation/visual-editing.md)). `NEXT_PUBLIC_SHAPIO_URL` sets the Shapio URL the browser
calls, when it differs from `SHAPIO_URL`.

## Reading in process

By default the site reads Shapio's delivery API over HTTP. With `SHAPIO_MODE=in-process` and `DATABASE_URL` set
to Shapio's own database (PostgreSQL or MySQL), it reads the same API as function calls in the Next.js server
process (`@shapio/local`), with no HTTP hop: the same delivery token, the same answers, the same pages.
`next.config.ts` lists `@shapio/local` in `serverExternalPackages`, so each server process opens one database
pool. Previews and the browser still use `SHAPIO_URL`, and the Shapio server keeps running (it applies schema
changes and sends the revalidation webhook). Install the same `@shapio/local` version as the server's release;
the scaffolded `package.json` pins it. Reads in process do not go through `fetch`, so the cache tags below do
not apply to them; `revalidatePath` still refreshes the pages. Guide:
[in-process delivery](https://github.com/mybrokengnome/shapio/blob/main/documentation/in-process.md).

## Incremental rebuilds (on-demand revalidation)

With `npm run start`, a publish refreshes only the pages it changed, without a rebuild:

1. `npm run seed` creates a Shapio webhook named **Site revalidation** that sends `entry.published`,
   `entry.unpublished`, `entry.deleted`, `change_set.shipped`, `schema.activated` and `schema.deleted` to
   `http://localhost:3000/api/revalidate/` (`SITE_URL` + `/api/revalidate/`, with the trailing slash: the site
   uses `trailingSlash`, and Shapio does not follow the redirect), and writes its signing secret to
   `.env` as `SHAPIO_WEBHOOK_SECRET` (every run rotates it). Shapio never calls loopback or private addresses
   on its own: for a local site, start Shapio with `OUTBOUND_PRIVATE_NETWORK_ALLOWLIST=127.0.0.1/32,::1/128`
   (the seed turns on "Allow private network" for a `localhost` URL; without the allowlist Shapio refuses the
   webhook, and the seed says so and goes on without it).
2. The route checks the signature (`verifyWebhookSignature` from `@shapio/client`), then asks Shapio what
   changed between the snapshot the site shows and the current one (`/api/snapshots/changes`), and calls
   `revalidatePath` for those pages: an article's page and its locale's list, a page by its slug (`home` is
   `/en/`), the list and every article page for an author, every page for the `siteSettings` singleton or a
   schema change. A changed slug refreshes the old and the new address. Reads are tagged by `@shapio/client` with
   the site, the model and the entry, so the route also calls `revalidateTag` for each changed model and entry;
   `site.updated` and a schema change expire the site tag, which every read carries. Content reads are pinned to
   a snapshot, so they sit in Next's data cache (`force-cache`) regardless; the client sets no cache mode, so
   `site.get()` stays fresh on every build (the data cache outlives `next build`).
3. The site moves to the new snapshot: revalidated pages re-render at it, and the snapshot is kept in
   `.next/shapio-revalidate.json` so a restart carries on from it. `next build` empties `.next/`, so a new build
   starts again from its own snapshot.

Articles and pages published after the build render on their first request (`dynamicParams = true`); unknown
slugs are a 404. A build pinned with `SHAPIO_SNAPSHOT` keeps showing that snapshot: the route answers with the
reason and revalidates nothing. The snapshot is held per `next start` process, so run one process per copy of
the site, each with its own webhook. In Shapio, Publishing → Webhooks shows every delivery and can send a test.

Guide: [site starters](https://github.com/mybrokengnome/shapio/blob/main/documentation/starters.md). Inside the
Shapio repository, run the scripts with `pnpm --filter example-next <script>` after `pnpm build`.
