# Example site

A static [Astro](https://astro.build) site built from Shapio content: sectioned pages and articles with an
author, in English and French, built against one pinned publication snapshot, with draft preview and signed
build callbacks for Shapio's generic deployment webhook.

```sh
SHAPIO_URL=http://localhost:4300 SHAPIO_ADMIN_EMAIL=you@example.com SHAPIO_ADMIN_PASSWORD='…' pnpm seed
pnpm build      # → dist/
pnpm preview    # serves dist/ in the background (pnpm preview:stop)
pnpm smoke      # checks dist/ and the preview path (needs SHAPIO_ADMIN_EMAIL/PASSWORD)
```

The walkthrough, including deploying to Cloudflare Pages: [documentation/example-site.md](../../documentation/example-site.md).
