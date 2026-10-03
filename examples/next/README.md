# Shapio starter: Next.js

A [Next.js](https://nextjs.org) (App Router) site built from [Shapio](https://github.com/mybrokengnome/shapio)
content: pages made of sections, a journal of articles with an author, and the `siteSettings` singleton, in
English and French. Every page is generated at build time from one pinned publication snapshot and served by
`next start`.

You need a running Shapio (>= 0.1) with an owner account.

```sh
npm install
SHAPIO_URL=http://localhost:4300 SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD='…' npm run seed
npm run build
npm run start       # http://localhost:3000/ (redirects to /en/)
npm run smoke       # in another shell: checks the served pages over HTTP
```

`npm run seed` applies the models in `shapio/` to Shapio live, creates the content and writes `SHAPIO_URL` and
`SHAPIO_DELIVERY_TOKEN` to `.env`. `SHAPIO_SNAPSHOT` pins a build to an exact snapshot (by default
`next.config.ts` pins the latest one when the build starts); `SHAPIO_SITE` picks the site on a multi-site
instance. Next.js telemetry is off: `NEXT_TELEMETRY_DISABLED=1` in the npm scripts and `.env.example`.

| File                         | Role                                                                |
| ---------------------------- | ------------------------------------------------------------------- |
| `next.config.ts`             | pins the snapshot for the whole build; `/` redirects to `/en/`      |
| `src/lib/shapio.ts`          | reads the delivery API with `@shapio/client` at the pinned snapshot |
| `src/app/[locale]/…`         | the layout (site settings), pages, articles and the colophon        |
| `src/components/…`           | sections, articles and responsive images                            |
| `shapio/`, `scripts/seed.ts` | the models and the seed                                             |

Draft preview, `revalidatePath` on publish and visual editing (`@shapio/visual`) arrive with Shapio's
visual-editing SDK; it plugs in at the marked spot in `src/app/[locale]/layout.tsx`.

Guide: [site starters](https://github.com/mybrokengnome/shapio/blob/main/documentation/starters.md). Inside the
Shapio repository, run the scripts with `pnpm --filter example-next <script>` after `pnpm build`.
