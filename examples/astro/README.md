# Shapio starter: Astro

A static [Astro](https://astro.build) site built from [Shapio](https://github.com/mybrokengnome/shapio)
content: pages made of sections, a journal of articles with an author, and the `siteSettings` singleton, in
English and French. Every build reads one pinned publication snapshot. Drafts preview through `/preview/`.

You need a running Shapio (>= 0.1) with an owner account.

```sh
npm install
SHAPIO_URL=http://localhost:4300 SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD='…' npm run seed
npm run build       # → dist/
npm run preview     # serves dist/ in the background (npm run preview:stop)
npm run smoke       # checks dist/ and the preview path (needs SHAPIO_ADMIN_EMAIL/PASSWORD)
npm run smoke:http  # checks the served pages over HTTP
```

`npm run seed` applies the models in `shapio/` to Shapio live, creates the content and writes `SHAPIO_URL` and
`SHAPIO_DELIVERY_TOKEN` to `.env`. Other settings (`SHAPIO_SNAPSHOT`, `SHAPIO_SITE`, `PUBLIC_SHAPIO_URL`) are
in `.env.example`. Astro's telemetry is turned off in the npm scripts.

Visual editing: Shapio's visual-editing SDK (`@shapio/visual`) plugs in at the marked spot in
`src/layouts/Base.astro` once it is released.

Guides: [site starters](https://github.com/mybrokengnome/shapio/blob/main/documentation/starters.md) and the
[walkthrough](https://github.com/mybrokengnome/shapio/blob/main/documentation/example-site.md) (model, preview,
deploy to Cloudflare Pages, build callbacks). Inside the Shapio repository, run the scripts with
`pnpm --filter example-astro <script>` after `pnpm build`.
