# Shapio starter: SvelteKit

A [SvelteKit 3](https://svelte.dev) site built from [Shapio](https://github.com/mybrokengnome/shapio) content:
pages made of sections, a journal of articles with an author, and the `siteSettings` singleton, in English and
French. Every page is prerendered to static HTML (adapter-static) from one pinned publication snapshot.

You need a running Shapio (>= 0.1) with an owner account.

```sh
npm install
SHAPIO_URL=http://localhost:4300 SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD='…' npm run seed
npm run build       # → build/
npm run preview     # http://localhost:4173/ (redirects to /en/)
npm run smoke       # in another shell: checks the served pages over HTTP
```

`npm run seed` applies the models in `shapio/` to Shapio live, creates the content and writes `SHAPIO_URL` and
`SHAPIO_DELIVERY_TOKEN` to `.env`. `SHAPIO_SNAPSHOT` pins a build to an exact snapshot (by default the latest
one, read once when prerendering starts); `SHAPIO_SITE` picks the site on a multi-site instance.

| File                         | Role                                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| `src/env.ts`                 | the settings the build reads (`SHAPIO_*`, from the environment)     |
| `src/lib/server/shapio.ts`   | reads the delivery API with `@shapio/client` at the pinned snapshot |
| `src/routes/[locale]/…`      | the layout (site settings), pages, articles and the colophon        |
| `src/lib/components/…`       | sections, articles and responsive images                            |
| `src/routes/preview/`        | draft preview with visual editing (`@shapio/visual`)                |
| `vite.config.ts`             | `frame-ancestors` for the servers and `build/_headers`              |
| `shapio/`, `scripts/seed.ts` | the models and the seed                                             |

Drafts mode, for your development server: set `SHAPIO_DRAFTS=true` in `.env` and `npm run dev` shows saved
drafts instead of published content, fresh on every reload, with a **Drafts** badge on every page. Save in
Shapio, reload, and the change is there; publishing still rebuilds the live site. It reads with
`SHAPIO_DEV_DELIVERY_TOKEN`, the seed's `<site> dev` token, whose delivery role grants Read drafts (a token
without it fails with `DRAFTS_FORBIDDEN`). Never put that token or the flag in a production environment.
`npm run smoke:drafts` checks a running drafts-mode dev server
(http://localhost:5173; needs `SHAPIO_ADMIN_EMAIL`/`PASSWORD` to save a test change, which it puts back). Guide:
[drafts mode](https://github.com/mybrokengnome/shapio/blob/main/documentation/starters.md#drafts-mode).

Preview: the seed creates a deployment connection named **Preview** that opens drafts at
`http://localhost:5173/preview/` (`npm run dev`; set `SITE_URL` when seeding for another address). Add that
origin to Shapio's `CORS_ORIGINS`. In Shapio's preview pane, clicking the title, body or cover focuses that
field and saves re-render the draft ([visual editing](https://github.com/mybrokengnome/shapio/blob/main/documentation/visual-editing.md)). `PUBLIC_SHAPIO_URL` sets the Shapio URL the
browser calls, when it differs from `SHAPIO_URL`.

Guide: [site starters](https://github.com/mybrokengnome/shapio/blob/main/documentation/starters.md). Inside the
Shapio repository, run the scripts with `pnpm --filter example-sveltekit <script>` after `pnpm build`.
