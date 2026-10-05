# Shapio starter: Astro

A static [Astro](https://astro.build) site built from [Shapio](https://github.com/mybrokengnome/shapio)
content: pages made of sections, a journal of articles with an author, and the `siteSettings` singleton, in
English and French. Every build reads one pinned publication snapshot. Drafts preview through `/preview/`.

You need a running Shapio (>= 0.1) with an owner account.

```sh
npm install
SHAPIO_URL=http://localhost:4300 SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD='…' npm run seed
npm run build       # → dist/
npm run preview     # serves dist/ in the foreground (Ctrl+C stops it)
npm run smoke       # checks dist/ and the preview path (needs SHAPIO_ADMIN_EMAIL/PASSWORD)
npm run smoke:http  # checks the served pages over HTTP (in another terminal, while preview runs)
```

`npm run seed` applies the models in `shapio/` to Shapio live, creates the content and writes `SHAPIO_URL` and
`SHAPIO_DELIVERY_TOKEN` to `.env`. Other settings (`SHAPIO_SNAPSHOT`, `SHAPIO_SITE`, `PUBLIC_SHAPIO_URL`) are
in `.env.example`. Astro's telemetry is turned off in the npm scripts.

Drafts mode, for your development server: set `SHAPIO_DRAFTS=true` in `.env` and `npm run dev` shows saved
drafts instead of published content, fresh on every reload, with a **Drafts** badge on every page. Save in
Shapio, reload, and the change is there; publishing still rebuilds the live site. It reads with
`SHAPIO_DEV_DELIVERY_TOKEN`, the seed's `<site> dev` token, whose delivery role grants Read drafts (a token
without it fails with `DRAFTS_FORBIDDEN`). Never put that token or the flag in a production environment.
`npm run smoke:drafts` checks a running drafts-mode dev server
(http://localhost:4321; needs `SHAPIO_ADMIN_EMAIL`/`PASSWORD` to save a test change, which it puts back). Guide:
[drafts mode](https://github.com/mybrokengnome/shapio/blob/main/documentation/starters.md#drafts-mode).

Preview: the seed creates a deployment connection named **Preview** that opens drafts at
`http://localhost:4321/preview/` (set `SITE_URL` when seeding for another address). Add that origin to Shapio's
`CORS_ORIGINS`. In Shapio's preview pane, clicking the title, body or cover focuses that field and saves
re-render the draft ([visual editing](https://github.com/mybrokengnome/shapio/blob/main/documentation/visual-editing.md)). `astro.config.mjs` sends `frame-ancestors` (only the site and
Shapio may frame it) and writes it to `dist/_headers`.

Guides: [site starters](https://github.com/mybrokengnome/shapio/blob/main/documentation/starters.md) and the
[walkthrough](https://github.com/mybrokengnome/shapio/blob/main/documentation/example-site.md) (model, preview,
deploy to Cloudflare Pages, build callbacks). Inside the Shapio repository, run the scripts with
`pnpm --filter example-astro <script>` after `pnpm build`.
