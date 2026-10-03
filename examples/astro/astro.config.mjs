import { defineConfig } from 'astro/config';

/**
 * Static output: `npm run build` writes plain HTML to dist/ (any static host: Cloudflare Pages, Netlify, a
 * bucket). SITE_URL sets absolute URLs (canonical links) when known. Astro's telemetry is turned off in this
 * package's scripts (ASTRO_TELEMETRY_DISABLED=1).
 */
export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL || undefined,
  trailingSlash: 'always',
  build: { format: 'directory' },
});
