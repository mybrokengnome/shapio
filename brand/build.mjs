/**
 * Regenerates the Shapio logo files from the source lockup, brand/shapio-logo.svg: `node brand/build.mjs`.
 *
 * The source has one blue path (the rounded tile; its later subpaths cut the S out of it) and seven navy
 * paths (the "shapio" letters). Paths are copied exactly; only viewBoxes change. The S is drawn again in
 * white under the tile so it stays white on dark backgrounds (README.md).
 *
 * Writes brand/shapio-mark.svg, shapio-mark-mono.svg, shapio-wordmark.svg and the admin copies in
 * apps/admin/src/assets/brand/. Then run `pnpm --filter @shapio/admin brand:icons` for the favicons. The
 * admin components inline the same path data (Logo/paths.ts, Wordmark/letters.ts); Logo/brandAssets.test.ts
 * fails if any of these drift apart.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BRAND_DIR = import.meta.dirname;
const ADMIN_DIR = join(BRAND_DIR, '..', 'apps', 'admin', 'src', 'assets', 'brand');
const LOGO_BLUE = '#2F5BFF';
const NAVY = '#0F1B3D';
const WHITE = '#FFFFFF';
/** Tight boxes around the source geometry; the mark's is widened to a square, centred. */
const MARK_VIEWBOX = '165.9 188.4 391.6 391.6';
const WORDMARK_VIEWBOX = '616.1 280.1 737.1 240.5';
const LOGO_VIEWBOX = '182.6 188.4 1170.6 391.6';

const source = readFileSync(join(BRAND_DIR, 'shapio-logo.svg'), 'utf8');
const paths = [...source.matchAll(/<path fill="([^"]+)" d="([^"]+)"\/>/g)].map(([, fill, d]) => ({
  fill,
  d,
}));
const tile = paths.find(({ fill }) => fill.toUpperCase() === LOGO_BLUE)?.d;
const letters = paths.filter(({ fill }) => fill.toUpperCase() === NAVY).map(({ d }) => d);
if (!tile || letters.length !== 7)
  throw new Error('shapio-logo.svg: expected one blue path and seven navy paths');
// Every subpath after the first (the tile's outline) is part of the S.
const sCounters = `M${tile.split('M').filter(Boolean).slice(1).join('M')}`;

const svg = (viewBox, body, attributes = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${attributes} role="img" aria-label="Shapio">\n  <title>Shapio</title>\n${body}</svg>\n`;
const markBody = `  <path fill="${WHITE}" d="${sCounters}"/>\n  <path fill="${LOGO_BLUE}" d="${tile}"/>\n`;
// The letters take currentColor: navy by default, white under a dark colour scheme.
const navyLetters = ` color="${NAVY}"`;
const darkStyle = `  <style>@media (prefers-color-scheme: dark) { svg { color: ${WHITE}; } }</style>\n`;
const letterBody = `  <g fill="currentColor">\n${letters.map((d) => `    <path d="${d}"/>`).join('\n')}\n  </g>\n`;

const mark = svg(MARK_VIEWBOX, markBody);
const wordmark = svg(WORDMARK_VIEWBOX, darkStyle + letterBody, navyLetters);
const files = {
  [join(BRAND_DIR, 'shapio-mark.svg')]: mark,
  [join(BRAND_DIR, 'shapio-mark-mono.svg')]: svg(MARK_VIEWBOX, `  <path fill="${NAVY}" d="${tile}"/>\n`),
  [join(BRAND_DIR, 'shapio-wordmark.svg')]: wordmark,
  [join(ADMIN_DIR, 'mark.svg')]: mark,
  [join(ADMIN_DIR, 'wordmark.svg')]: wordmark,
  [join(ADMIN_DIR, 'logo-horizontal.svg')]: svg(LOGO_VIEWBOX, darkStyle + markBody + letterBody, navyLetters),
};
for (const [file, content] of Object.entries(files)) writeFileSync(file, content);
process.stdout.write(`brand: wrote ${Object.keys(files).length} files\n`);
