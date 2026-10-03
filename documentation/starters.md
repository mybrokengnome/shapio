# Site starters

Three small sites show how a website reads content from Shapio. They render the same blog, so you can pick
the framework you already use:

| Starter     | Framework                         | Output                                         | Serve the build   |
| ----------- | --------------------------------- | ---------------------------------------------- | ----------------- |
| `astro`     | [Astro](https://astro.build)      | static HTML in `dist/`                         | `npm run preview` |
| `next`      | [Next.js](https://nextjs.org)     | App Router, every page generated at build time | `npm run start`   |
| `sveltekit` | [SvelteKit 3](https://svelte.dev) | static HTML in `build/` (adapter-static)       | `npm run preview` |

Each starter has:

- pages from the `page` collection, built from sections (hero, feature grid, gallery, call to action), with
  `home` as the front page (`/en/`, `/fr/`);
- an article list (`/en/articles/`) and article pages with rich text, a cover image and the author;
- the `siteSettings` **singleton**: the site name, tagline and footer on every page, and its colophon at
  `/en/colophon/`;
- English and French, with a language switch;
- responsive images from the WebP variants Shapio renders;
- one pinned publication snapshot per build, and the site key for multi-site instances (below).

The Astro starter also has draft preview, incremental builds and signed build callbacks
([walkthrough](example-site.md)). Preview for the other two arrives together with visual editing.

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
locales (one article stays a draft), and creates a delivery role and token that read only the four models.

You need a running Shapio with an owner account ([npm](install-npm.md), [Docker](install-docker.md)).
Without `--site`, `create-shapio` creates a Shapio (CMS) project instead.

## Settings

Every starter reads its settings from the environment, or from `.env` (`.env.example` lists them):

| Variable                | Meaning                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `SHAPIO_URL`            | Shapio's origin, with its `BASE_PATH` if any (default `http://localhost:4300`)             |
| `SHAPIO_DELIVERY_TOKEN` | a read-only delivery token (Settings → API tokens, a delivery role); the seed writes one   |
| `SHAPIO_SNAPSHOT`       | optional: build this publication snapshot instead of the latest                            |
| `SHAPIO_SITE`           | optional: the site key on a multi-site instance                                            |
| `PUBLIC_SHAPIO_URL`     | Astro only, optional: the origin the browser calls for previews (defaults to `SHAPIO_URL`) |

### Pinned snapshots

A build reads the current publication snapshot once, when it starts, and sends it with every request
(`?snapshot=N`), so content published during the build waits for the next build instead of producing a site
that mixes two moments ([Snapshots](snapshots.md)). Set `SHAPIO_SNAPSHOT=N` to build an exact moment, for
example the snapshot a deployment trigger carries. Next.js renders pages in several worker processes, so its
starter pins the snapshot in `next.config.ts` before any page renders and hands it to every worker.

### Site key

On an instance with several sites, `SHAPIO_SITE` names the site to read; it is passed to `@shapio/client`'s
`site` option, which sends it with every request. Without it the delivery token's site is used, else the
primary site. A token bound to one site never reads another (`403 SITE_MISMATCH`).

### Telemetry

Nothing in the starters sends data anywhere but your Shapio. Astro's and Next.js's anonymous telemetry are
turned off in the npm scripts (`ASTRO_TELEMETRY_DISABLED=1`, `NEXT_TELEMETRY_DISABLED=1`; the Next starter's
`.env.example` sets it too). SvelteKit has none.

### Visual editing

Shapio's visual-editing SDK (`@shapio/visual`) is not released yet. Each starter's layout marks where its
script will go; when it ships, the starters adopt it together with draft preview for Next.js and SvelteKit.

## In the Shapio repository

The starters live in `examples/astro`, `examples/next` and `examples/sveltekit`; the model files, the seed and
the HTTP smoke check they share live in `examples/shared`. `create-shapio`'s build packs them into its
templates: workspace and catalog versions become the published versions, and the shared files are copied into
each project.

The starters use `@shapio/client`'s build, as an installed project does, so build the packages first:

```sh
pnpm install && pnpm build
SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD='…' pnpm --filter example-astro seed
cp examples/astro/.env examples/next/.env && cp examples/astro/.env examples/sveltekit/.env
pnpm --filter example-next build && pnpm --filter example-next start   # then, in another shell:
pnpm --filter example-next smoke
```

CI seeds a local Shapio once, then builds and smoke-tests all three.
