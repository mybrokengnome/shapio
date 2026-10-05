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
to `.env`), and creates a delivery role and token that read only the four models.

You need a running Shapio with an owner account ([npm](install-npm.md), [Docker](install-docker.md)).
Without `--site`, `create-shapio` creates a Shapio (CMS) project instead.

## Settings

Every starter reads its settings from the environment, or from `.env` (`.env.example` lists them):

| Variable                 | Meaning                                                                                      |
| ------------------------ | -------------------------------------------------------------------------------------------- |
| `SHAPIO_URL`             | Shapio's origin, with its `BASE_PATH` if any (default `http://localhost:4300`)               |
| `SHAPIO_DELIVERY_TOKEN`  | a read-only delivery token (Settings → API tokens, a delivery role); the seed writes one     |
| `SHAPIO_SNAPSHOT`        | optional: build this publication snapshot instead of the latest                              |
| `SHAPIO_SITE`            | optional: the site key on a multi-site instance                                              |
| `PUBLIC_SHAPIO_URL`      | Astro and SvelteKit, optional: the URL the browser calls for previews (default `SHAPIO_URL`) |
| `NEXT_PUBLIC_SHAPIO_URL` | Next.js, optional: the same, inlined into the client bundle at build time                    |
| `SHAPIO_WEBHOOK_SECRET`  | Next.js: the signing secret of the webhook that calls `/api/revalidate`; the seed writes it  |
| `SITE_URL`               | optional: the site's public origin; pages then carry a canonical URL and `og:url`            |

### Pinned snapshots

A build reads the current publication snapshot once, when it starts, and sends it with every request
(`?snapshot=N`), so content published during the build waits for the next build instead of producing a site
that mixes two moments ([Snapshots](snapshots.md)). Set `SHAPIO_SNAPSHOT=N` to build an exact moment, for
example the snapshot a deployment trigger carries. Next.js renders pages in several worker processes, so its
starter pins the snapshot in `next.config.ts` before any page renders and hands it to every worker.

### Incremental rebuilds

A publish should reach the site without rebuilding pages that did not change. Each starter does it the way its
output allows, and all three read the [changes API](snapshots.md#what-changed-between-two-snapshots):

- **Astro** (static): `npm run build:incremental` asks what changed since the last build's snapshot, prints the
  routes it touches, and builds pinned to the new snapshot, or skips the build when nothing the site reads
  changed ([Snapshots](snapshots.md#skipping-builds-that-change-nothing)).
- **Next.js** (`next start`): on-demand revalidation. The seed's webhook calls `/api/revalidate/` on every
  publish, unpublish, delete, change set ship and schema change; the route verifies the signature, diffs the
  snapshot the site shows against the current one and calls `revalidatePath` for just those pages, which
  re-render at the new snapshot. New articles and pages render on their first request. A local site needs
  Shapio's `OUTBOUND_PRIVATE_NETWORK_ALLOWLIST` to include `127.0.0.1/32,::1/128`, since Shapio never calls
  loopback addresses otherwise. A build pinned with `SHAPIO_SNAPSHOT` stays at that snapshot. Details in the
  starter's README.
- **SvelteKit** (adapter-static): a full rebuild, started by a [deployment connection](publishing.md#deployment-connections)
  that Shapio triggers on publish.

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

The starters use the builds of `@shapio/client` and `@shapio/visual`, as an installed project does, so build the packages first:

```sh
pnpm install && pnpm build
SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD='…' pnpm --filter example-astro seed
cp examples/astro/.env examples/next/.env && cp examples/astro/.env examples/sveltekit/.env
pnpm --filter example-next build && pnpm --filter example-next start   # then, in another shell:
pnpm --filter example-next smoke --revalidate   # with SHAPIO_WEBHOOK_SECRET set for both
```

CI seeds a local Shapio once, then builds and smoke-tests all three.
