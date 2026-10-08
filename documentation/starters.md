# Site starters

Three small sites show how a website reads content from Shapio. They render the same blog, so you can pick
the framework you already use:

| Starter     | Framework                         | Output                                                            | Serve the build   |
| ----------- | --------------------------------- | ----------------------------------------------------------------- | ----------------- |
| `astro`     | [Astro](https://astro.build)      | static HTML in `dist/`                                            | `npm run preview` |
| `next`      | [Next.js](https://nextjs.org)     | App Router, pages generated at build time, revalidated on publish | `npm run start`   |
| `sveltekit` | [SvelteKit 3](https://svelte.dev) | static HTML in `build/` (adapter-static)                          | `npm run preview` |

Each starter has:

- pages from the `page` collection, built from sections (hero, feature grid, gallery, call to action), with
  `home` as the front page (`/en/`, `/fr/`);
- an article list (`/en/articles/`) and article pages with rich text, a cover image and the author;
- the `siteSettings` **singleton**: the site name, tagline and footer on every page, and its colophon at
  `/en/colophon/`;
- English and French, with a language switch;
- responsive images from the WebP variants Shapio renders;
- one pinned publication snapshot per build, and the site key for multi-site instances (below);
- [SEO fields](seo.md) on pages and articles: each page's `<head>` has its title through the site's title
  template, the description, Open Graph and Twitter tags (the cover or the site's default image), `robots` when
  the entry hides itself from search engines, and, with `SITE_URL`, the canonical URL. Entries are read with
  `seo=resolved`; pages without an entry use the site's SEO defaults (`client.site.get()`). The seed sets those
  defaults (Settings → SEO) in English and French.

All three have draft preview at `/preview/` with [visual editing](visual-editing.md): in the admin's preview
pane, clicking the title, body or cover focuses that field, and saves re-render the page. The Astro starter also
has signed build callbacks ([walkthrough](example-site.md)); see [Incremental rebuilds](#incremental-rebuilds)
for how each starter picks up a publish.

## Create one

```sh
npx create-shapio my-site --site next      # or astro, sveltekit
cd my-site
```

The project has the framework app, the blog's model files in `shapio/` (the format `shapio schema pull`
writes), and three scripts:

```sh
# 1. Apply the models to your Shapio, live, and create the content and a delivery token (writes .env):
SHAPIO_URL=http://localhost:4300 SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD='…' npm run seed
# 2. Build against the published content:
npm run build
# 3. Serve the build, then check it over HTTP:
npm run start          # Next.js; `npm run preview` for Astro and SvelteKit
npm run smoke
```

The seed signs in, uses a temporary admin API token (revoked when it ends; `SHAPIO_TOKEN=<admin token>` works
instead of email and password) and is idempotent: run it again to reset the content. It adds the `fr` locale,
applies the models through the schema apply API (the same change planner as the admin and
`shapio schema apply`, with no restart), uploads placeholder images, creates and publishes the content in both
locales (one article stays a draft), creates a deployment connection named **Preview** whose preview URL is the
starter's `/preview/` page (it triggers no builds; `SITE_URL` overrides the local address it points at), for
the Next.js starter a webhook named **Site revalidation** to its `/api/revalidate/` route (the signing secret goes
to `.env`), and creates a delivery role and token that read only the four models, plus a second one, `<site> dev`,
that may also read drafts ([drafts mode](#drafts-mode)), written to `.env` as `SHAPIO_DEV_DELIVERY_TOKEN`. Never put
that token in a production environment.

You need a running Shapio with an owner account ([npm](install-npm.md), [Docker](install-docker.md)).
Without `--site`, `create-shapio` creates a Shapio (CMS) project instead.

## Settings

Every starter reads its settings from the environment, or from `.env` (`.env.example` lists them):

| Variable                    | Meaning                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `SHAPIO_URL`                | Shapio's origin, with its `BASE_PATH` if any (default `http://localhost:4300`)               |
| `SHAPIO_DELIVERY_TOKEN`     | a read-only delivery token (Settings → API tokens, a delivery role); the seed writes one     |
| `SHAPIO_SNAPSHOT`           | optional: build this publication snapshot instead of the latest                              |
| `SHAPIO_SITE`               | optional: the site key on a multi-site instance                                              |
| `PUBLIC_SHAPIO_URL`         | Astro and SvelteKit, optional: the URL the browser calls for previews (default `SHAPIO_URL`) |
| `NEXT_PUBLIC_SHAPIO_URL`    | Next.js, optional: the same, inlined into the client bundle at build time                    |
| `SHAPIO_WEBHOOK_SECRET`     | Next.js: the signing secret of the webhook that calls `/api/revalidate`; the seed writes it  |
| `SITE_URL`                  | optional: the site's public origin; pages then carry a canonical URL and `og:url`            |
| `SHAPIO_MODE`               | Next.js, optional: `in-process` reads the delivery API in the server process (below)         |
| `DATABASE_URL`              | Next.js with `SHAPIO_MODE=in-process`: Shapio's own database (PostgreSQL or MySQL)           |
| `SHAPIO_DRAFTS`             | development only: `true` turns on [drafts mode](#drafts-mode)                                |
| `SHAPIO_DEV_DELIVERY_TOKEN` | development only: the token drafts mode reads with (Read drafts); the seed writes one        |

### Pinned snapshots

A build reads the current publication snapshot once, when it starts, and sends it with every request
(`?snapshot=N`), so content published during the build waits for the next build instead of producing a site
that mixes two moments ([Snapshots](snapshots.md)). Set `SHAPIO_SNAPSHOT=N` to build an exact moment, for
example the snapshot a deployment trigger carries. Next.js renders pages in several worker processes, so its
starter pins the snapshot in `next.config.ts` before any page renders and hands it to every worker. The dev
servers (`npm run dev`) pin nothing: in dev, a publish shows on reload (unless `SHAPIO_SNAPSHOT` is set). That
includes a page published for the first time after the dev server started: Astro caches each route's list of
pages in dev, so the Astro starter clears that cache before a page request, at most once a second
(`src/integrations/devStaticPaths.ts`), and the new page renders without a restart.

### Drafts mode

Publishing rebuilds your live site, so it is not how you check a change. With `SHAPIO_DRAFTS=true` in your
local `.env`, the dev server (and a local build) reads **saved drafts** instead of published content: save in
the admin, reload, and the change is there. It pins no snapshot, every read is fresh (under Next.js never
cached or tagged), `/api/revalidate` does nothing, and every page carries a **Drafts** badge in its corner, so a
drafts build is never mistaken for the real one. `/preview/` is unchanged.

Drafts mode reads with `SHAPIO_DEV_DELIVERY_TOKEN` when it is set, else `SHAPIO_DELIVERY_TOKEN`. The token's
delivery role must grant **Read drafts**: the seed creates one, `<site> dev`, and writes its token to `.env`.
With a token that lacks the grant, the first read fails with Shapio's `DRAFTS_FORBIDDEN` message (a build stops,
a dev server shows it on the error page); it never falls back to published content. Never set `SHAPIO_DRAFTS`
or put the dev token in a production environment (Cloudflare, Vercel, Netlify): the two safeguards are the
grant on the server and the flag on the site ([Delivery API](delivery-api.md#drafts-in-development)).

### Incremental rebuilds

A publish should reach the site without rebuilding pages that did not change. Each starter does it the way its
output allows, and all three read the [changes API](snapshots.md#what-changed-between-two-snapshots):

- **Astro** (static): every build re-renders only the pages whose data or code changed and restores the others
  from the previous build, with Astro's `experimental.incrementalBuild`. Each page's `getStaticPaths()` entry
  carries a `cacheKey`: a digest (`src/lib/cacheKey.ts`) of its props, what the layout reads (site settings and
  SEO defaults, `src/lib/layoutInputs.ts`) and the build environment (drafts mode, the year). Astro restores a
  page when its key and its code (the hash of its import graph) are both unchanged; publishing one article
  re-renders that article's page, while the listings, which render on every build, show it too. The cache lives
  in `node_modules/.astro`: on Cloudflare Pages turn on build caching (Settings → Builds → Build cache) so it
  survives, and do not set `cacheDir`; without the cache a build is a full one. A page keeps that guarantee only
  if it renders nothing outside its key, so a new read goes through `getStaticPaths()` props or `layoutInputs`.
  `npm run check:incremental` proves it against a running Shapio. On top of that, `npm run build:incremental`
  skips the whole build when nothing the site reads changed since the `dist/` on disk; it is a local and CI
  tool and always builds where `dist/` does not survive, such as Cloudflare Pages
  ([Snapshots](snapshots.md#skipping-builds-that-change-nothing)).
- **Next.js** (`next start`): on-demand revalidation. The seed's webhook calls `/api/revalidate/` on every
  publish, unpublish, delete, change set ship and schema change; the route verifies the signature, diffs the
  snapshot the site shows against the current one and calls `revalidatePath` for just those pages, which
  re-render at the new snapshot. Reads are cached by tag: every read carries the site, model and entry tags
  ([Next.js cache tags](delivery-api.md#nextjs-cache-tags)), reads pinned to a snapshot are `force-cache`, and
  the starter sets no cache mode of its own, so `site.get()` stays fresh on every build (Next's data cache
  outlives `next build`). A publish expires the tags of the models and entries in the diff with `revalidateTag`; site settings
  (`site.updated`) and schema changes expire the site tag, which every read carries. New articles and pages
  render on their first request. A local site needs
  Shapio's `OUTBOUND_PRIVATE_NETWORK_ALLOWLIST` to include `127.0.0.1/32,::1/128`, since Shapio never calls
  loopback addresses otherwise. A build pinned with `SHAPIO_SNAPSHOT` stays at that snapshot. Details in the
  starter's README.
- **SvelteKit** (adapter-static): a full rebuild, started by a [deployment connection](publishing.md#deployment-connections)
  that Shapio triggers on publish.

### Reading in process (Next.js)

With `SHAPIO_MODE=in-process` and `DATABASE_URL`, the Next.js starter reads Shapio's delivery API as function
calls in its own server process ([`@shapio/local`](in-process.md)) instead of over HTTP: no HTTP hop, and the
same delivery token, answers and pages. The switch is one factory, `src/lib/shapioClient.ts`; `next.config.ts`
lists `@shapio/local` in `serverExternalPackages` and pins the build's snapshot the same way in both modes.
Previews, the browser and media files still use `SHAPIO_URL`, and the Shapio server keeps running. A read-only
database role is enough. The scaffolded project pins `@shapio/local` to the exact release, because it refuses a
server of another one ([Upgrades](in-process.md#upgrades)). In-process reads do not go through `fetch`, so cache
tags do not apply to them; on-demand revalidation still refreshes the pages with `revalidatePath`.

### Site key

On an instance with several sites, `SHAPIO_SITE` names the site to read; it is passed to `@shapio/client`'s
`site` option, which sends it with every request. Without it the delivery token's site is used, else the
primary site. A token bound to one site never reads another (`403 SITE_MISMATCH`).

The seed honours `SHAPIO_SITE` too: it creates the models, content and tokens on that site (else the admin
token's site, else the primary) and writes `SHAPIO_SITE` to `.env`. The models become **that site's own**
content types: a starter's schema belongs to the first site it is seeded on. Seeding the same starter onto a
second site of the instance is refused (`DUPLICATE_ID`: its model files carry the same stable IDs). To use it
on a second site, share its models and components with all sites first, from the site they were seeded on,
with a network admin token (`shapio schema scope <apiKey> --shared --site <that site>` for each, or **Share
with all sites** in the builder). A shared definition may only refer to shared ones, so share the components
and `author` before `page` and `article`. Then seed the second site; or seed a separate Shapio instance.

### Telemetry

Nothing in the starters sends data anywhere but your Shapio. Astro's and Next.js's anonymous telemetry are
turned off in the npm scripts (`ASTRO_TELEMETRY_DISABLED=1`, `NEXT_TELEMETRY_DISABLED=1`; the Next starter's
`.env.example` sets it too). SvelteKit has none.

### Preview and visual editing

Each starter's `/preview/` page reads a draft in the browser with the preview token from the URL fragment and
renders it with the published pages' components; `@shapio/visual` turns on visual editing inside the admin's
preview pane. Add the site's origin to Shapio's `CORS_ORIGINS`. The starters send
`Content-Security-Policy: frame-ancestors 'self' <Shapio's origin>` (and write it to a `_headers` file in the
static builds), so only the site and Shapio can frame their pages. Details per starter:
[Visual editing](visual-editing.md#the-starters).

## In the Shapio repository

The starters live in `examples/astro`, `examples/next` and `examples/sveltekit`; the model files, the seed and
the HTTP smoke check they share live in `examples/shared`. `create-shapio`'s build packs them into its
templates: workspace and catalog versions become the published versions, and the shared files are copied into
each project.

The starters use the builds of `@shapio/client`, `@shapio/visual` and `@shapio/local`, as an installed project does, so build the packages first:

```sh
pnpm install && pnpm build
SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD='…' pnpm --filter example-astro seed
cp examples/astro/.env examples/next/.env && cp examples/astro/.env examples/sveltekit/.env
pnpm --filter example-next build && pnpm --filter example-next start   # then, in another shell:
pnpm --filter example-next smoke --revalidate   # with SHAPIO_WEBHOOK_SECRET set for both
```

CI seeds a local Shapio once, then builds and smoke-tests all three, the Next.js starter twice: over HTTP, then
in process (`SHAPIO_MODE=in-process`). The smoke's `--save <dir>` writes each page's rendered markup, and CI
requires the two modes' pages to be identical.
