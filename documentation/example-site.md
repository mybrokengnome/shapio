# Example site walkthrough

`examples/astro` is a small marketing site built with [Astro](https://astro.build) from Shapio content: pages
made of sections (hero, feature grid, gallery, call to action), a journal of articles with an author, in
English and French. It shows the whole loop: model, edit, preview, publish, build, deploy, with status reported
back to Shapio. The site is static (plain HTML), reads one pinned publication snapshot per build, and previews
drafts with a preview token.

## What you need

- A running Shapio with an owner account ([npm](install-npm.md), [Docker](install-docker.md) or
  [a development clone](local-development.md)). Below it is at `http://localhost:4300`.
- A clone of the Shapio repository with dependencies installed and the packages built (`pnpm install`, then
  `pnpm build`): the example lives in it and uses `@shapio/client`'s build, as a project from npm would. To
  start outside the repository instead, `npx create-shapio my-site --site astro` writes the same site as a
  standalone project ([Site starters](starters.md)).

## 1. Seed the instance

```sh
SHAPIO_URL=http://localhost:4300 SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD='your password' \
  pnpm --filter example-astro seed
```

The seed signs in, creates a temporary admin API token (revoked at the end; `SHAPIO_TOKEN=<admin token>`
works instead of email and password), and then, idempotently (run it again to reset the content):

1. adds the `fr` locale;
2. applies the models and components in `examples/shared/shapio/` through the schema apply API (the same
   planner as `shapio schema apply`), live: `page` (title, slug, description, a **sections** dynamic zone),
   `article` (title, slug, excerpt, rich-text body, cover image, author relation, date), `author`, the
   `siteSettings` singleton (site name, tagline, footer, colophon), and the components `hero`, `featureGrid`,
   `feature`, `gallery`, `callToAction`;
3. uploads generated placeholder images and waits for their variants;
4. creates an author, the site settings, the `home` and `about` pages and three articles in English and
   French, publishes the settings, two articles and both pages in both locales, and leaves _Coming soon: our winter projects_ as a draft;
5. creates a delivery role that can read those four models, and a delivery token for it, and writes
   `SHAPIO_URL` and `SHAPIO_DELIVERY_TOKEN` to `examples/astro/.env`.

Open the admin: Content shows the pages and articles, Models shows the models, Media the images.

## 2. Build and look at it

```sh
pnpm --filter example-astro build
pnpm --filter example-astro preview
```

`preview` serves `dist/` in the foreground and prints its address, <http://localhost:4321/> unless that port is
taken; Ctrl+C stops it. The home page redirects to `/en/`; the language
switch leads to `/fr/`. The build reads the
current publication snapshot once, at the start, and passes it with every request (`?snapshot=N`), so content
published while it runs cannot leave the site half old and half new. `/build.json` shows which snapshot it is.
Set `SHAPIO_SNAPSHOT=N` to build an exact earlier moment.

Check the result without a browser:

```sh
SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD='your password' pnpm --filter example-astro smoke
```

It checks the built HTML for the seeded content in both languages, rich text with a table, the author and the
image variants; that the draft is not on the site; and that a preview token renders the draft (below).

## 3. Change the model while it runs

In the admin, Models → Article → **Add field**: _Subtitle_, type _Text_, localized, optional. Save. The plan
says the change is live; nothing restarts. At once:

- the article form has the field (Content → Article);
- the API serves it: `curl -H "Authorization: Bearer $SHAPIO_DELIVERY_TOKEN" "http://localhost:4300/api/content/articles?locale=fr"`
  shows `"subtitle": null` on every article;
- GraphQL, the OpenAPI document (`/api/docs`) and `shapio types generate` know it.

Fill it in for one article in English and French and publish each locale. To show it on the site, render it in
`src/lib/render.ts` (`renderArticle`) and rebuild: code changes need a build, content and models never do.
To keep the schema in git, pull the new definition with an admin API token (Settings → API tokens); from a
clone, run the CLI from source:

```sh
cd apps/api
node --conditions=@shapio/source --import tsx src/cli.ts schema pull --url http://localhost:4300 \
  --token "$SHAPIO_ADMIN_TOKEN" --dir ../../examples/shared/shapio --lock ../../examples/shared/.shapio/schema-lock.json
```

Pages are built from sections, so new layouts need no code: open the _About_ page, add a **Gallery** section,
pick images, publish, rebuild.

## 4. Preview a draft

1. Allow the site's origin to call the API from the browser: `CORS_ORIGINS=http://localhost:4321` in Shapio's
   environment (restart Shapio after changing it).
2. The seed created a deployment connection named **Preview** (Publishing → Deployments) whose **preview URL
   template** is `http://localhost:4321/preview/?model={modelKey}&id={entryId}&locale={locale}#token={token}`.
   If `preview` printed another address, change the template (or run the seed again with `SITE_URL` set).
3. Open the article _Coming soon: our winter projects_ and click **Preview**: the draft opens beside the
   document, and clicking its title or body focuses that field ([Visual editing](visual-editing.md)). The site's
   `/preview/` page reads
   the token from the URL fragment, removes it from the address bar, fetches the draft from
   `/api/preview/content/articles/<id>` (the template's `{modelKey}` is the plural API ID, `articles`) and renders it with the same code as the published pages.

## 5. Deploy to Cloudflare Pages

Cloudflare builds the site from your Git repository; Shapio starts each build with a deploy hook and follows it
through Cloudflare's API. Your Shapio must be reachable from the internet for the build to read content.

1. Push your copy of the repository to GitHub or GitLab.
2. In Cloudflare: **Workers & Pages → Create → Pages → Connect to Git**, pick the repository, then:
   - Framework preset: **None**
   - Build command: `pnpm --filter "@shapio/client..." --filter "@shapio/visual" build && pnpm --filter example-astro build`
   - Build output directory: `examples/astro/dist`
   - Root directory: (leave empty: the repository root, so the workspace packages are found)
   - Environment variables (Production): `NODE_VERSION` = `24`, `PNPM_VERSION` = `12.8.1`,
     `SHAPIO_URL` = your Shapio's address (e.g. `https://cms.example.com`), `SHAPIO_DELIVERY_TOKEN` = a delivery
     token (as a **secret**; create one in Settings → API tokens with a delivery role that reads `page`,
     `article`, `author` and `siteSettings`, or take it from the seed's `.env`).
   - Save and Deploy. The first build runs and the site is live at `https://<project>.pages.dev`.
3. Settings → Builds → **Deploy hooks** → Add deploy hook (production branch). Copy its URL.
4. **My Profile → API Tokens → Create Token → Custom token**: permission _Account → Cloudflare Pages → Read_,
   for your account. Copy the token. Note the **account ID** and the project name.
5. In Shapio, Publishing → Deployments → New connection → **Cloudflare Pages**: account ID, project name,
   deploy hook URL, API token (or `${ENV:SHAPIO_SECRET_CF_PAGES_TOKEN}` with that variable set for Shapio), triggers **On
   publish** and **Manual**. Set the preview URL template to your site:
   `https://<project>.pages.dev/preview/?model={modelKey}&id={entryId}&locale={locale}#token={token}`, and add
   `https://<project>.pages.dev` to `CORS_ORIGINS`. **Test connection** should pass.
6. Publish something. The connection's runs go **triggered → building → deployed**, each with Cloudflare's
   build log link and the snapshot it was started for. Open the site: the change is there.

**Forced failure:** in the Pages project, change `SHAPIO_DELIVERY_TOKEN` to a wrong value and publish again.
The build fails reading content (401); Shapio shows the run as **failed** with the reason and the log link,
while the content stays published. Put the right token back, then **Retry** the run: it deploys.

### Or build anywhere and use the generic webhook

If you build elsewhere (your CI, a server), point a **Generic webhook** connection at an endpoint that starts
your build. Shapio sends the run ID, the snapshot to build and a callback URL, signed
([Webhooks, deployments and preview](publishing.md#generic-signed-build-webhook)). Your pipeline then runs:

```sh
pnpm --filter example-astro report-status building
SHAPIO_SNAPSHOT=<snapshot from the trigger> pnpm --filter example-astro build
npx wrangler pages deploy examples/astro/dist --project-name <project>
pnpm --filter example-astro report-status deployed
```

with `SHAPIO_CALLBACK_URL`, `SHAPIO_RUN_ID` and `SHAPIO_CALLBACK_SECRET` (the connection's signing secret) in
its environment, and `report-status failed "<reason>"` when a step fails. `wrangler pages deploy` uploads to a
Pages project created for direct upload (it needs `CLOUDFLARE_API_TOKEN` with _Cloudflare Pages: Edit_ and
`CLOUDFLARE_ACCOUNT_ID`); any static host works the same way.

## How the site is made

Paths are relative to `examples/astro`; the model files and the seed are shared by all three
[starters](starters.md) and live in `examples/shared` (a project made with `create-shapio --site astro` has
them in its own `shapio/` and `scripts/`).

| File                                                    | Role                                                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `../shared/shapio/models/*.json`, `…/components/*.json` | the content models, as `shapio schema pull` writes them                                          |
| `src/lib/shapio.ts`                                     | reads the delivery API with `@shapio/client`, pinned to one snapshot                             |
| `src/lib/render.ts`                                     | turns pages, sections and articles into HTML (escaped; rich text from Shapio's sanitised `html`) |
| `src/layouts/Base.astro`                                | the header and footer, from the `siteSettings` singleton                                         |
| `src/pages/[locale]/…`                                  | one static page per published page and article, per locale, and the colophon (the singleton)     |
| `src/pages/preview.astro`, `src/lib/preview.ts`         | the preview page                                                                                 |
| `../shared/scripts/seed.ts`                             | the seed                                                                                         |
| `scripts/reportStatus.ts`, `scripts/lib/callback.ts`    | signed build status for generic-webhook deployments                                              |
| `scripts/smoke.ts`, `../shared/scripts/smokeHttp.ts`    | the HTML and preview checks; the HTTP checks every starter runs                                  |

Images use the variants Shapio renders (`srcset` of WebP widths) with their intrinsic size, lazily below the
fold; the pages have no client-side JavaScript except the preview page. Astro's telemetry is turned off in
the package's scripts.
