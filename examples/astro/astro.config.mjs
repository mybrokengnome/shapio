import { writeFile } from 'node:fs/promises';
import { defineConfig } from 'astro/config';

// `.env` (written by `npm run seed`) for the settings this file reads; the environment wins.
try {
  process.loadEnvFile();
} catch {
  // No .env: the environment alone.
}

const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/**
 * Only this site and Shapio may frame its pages (Shapio's preview pane shows them beside the document). Sent
 * by `astro dev` and `astro preview`, and written to dist/_headers for hosts that read it (Cloudflare Pages,
 * Netlify); set the same header on any other host.
 */
const shapioOrigin = originOf(
  process.env.PUBLIC_SHAPIO_URL || process.env.SHAPIO_URL || 'http://localhost:4300',
);
const FRAME_ANCESTORS = `frame-ancestors 'self'${shapioOrigin ? ` ${shapioOrigin}` : ''}`;

const frameAncestorsHeaders = {
  name: 'shapio-frame-ancestors',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      await writeFile(new URL('_headers', dir), `/*\n  Content-Security-Policy: ${FRAME_ANCESTORS}\n`);
    },
  },
};

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
  server: { headers: { 'Content-Security-Policy': FRAME_ANCESTORS } },
  integrations: [frameAncestorsHeaders],
});
