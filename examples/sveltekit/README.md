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
| `shapio/`, `scripts/seed.ts` | the models and the seed                                             |

Draft preview and visual editing (`@shapio/visual`) arrive with Shapio's visual-editing SDK; it plugs in at the
marked spot in `src/routes/[locale]/+layout.svelte`.

Guide: [site starters](https://github.com/mybrokengnome/shapio/blob/main/documentation/starters.md). Inside the
Shapio repository, run the scripts with `pnpm --filter example-sveltekit <script>` after `pnpm build`.
