import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';

/**
 * Static output: `pnpm build` writes plain HTML to dist/ (any static host: Cloudflare Pages, Netlify, a
 * bucket). SITE_URL sets absolute URLs (canonical links) when known. Astro's telemetry is turned off in this
 * package's scripts (ASTRO_TELEMETRY_DISABLED=1).
 *
 * Inside the Shapio repository `@shapio/client` is read from its TypeScript source, so the site builds from a
 * fresh clone without building the workspace packages first. A site outside the repository installs
 * `@shapio/client` from npm and drops the alias.
 */
export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL || undefined,
  trailingSlash: 'always',
  build: { format: 'directory' },
  vite: {
    resolve: {
      alias: {
        '@shapio/client': fileURLToPath(new URL('../../packages/client/src/index.ts', import.meta.url)),
      },
    },
  },
});
