/**
 * Regenerates the Shapio logo files from the source lockup, brand/classic-logo.svg: `node brand/build.mjs`.
 *
 * The source is the original blue logo. It has one blue path (the rounded tile; its later subpaths cut the S
 * out of it) and seven navy paths (the "shapio" letters); those two fills are how the paths are found. Paths
 * are copied exactly; only viewBoxes and fills change. Every generated colour mark draws the S again
 * underneath the tile, so the S keeps its colour on any background (README.md).
 *
 * Two palettes (PALETTES below): `shapio` (acid yellow and plum, the current brand) and `classic` (the
 * original blue, kept for reference). Writes brand/shapio-logo.svg, shapio-mark.svg, shapio-mark-mono.svg,
 * shapio-wordmark.svg, the same four as classic-* (classic-logo.svg is the source and is not rewritten) and
 * the admin copies in apps/admin/src/assets/brand/ (Shapio palette). Then run
 * `pnpm --filter @shapio/admin brand:icons` for the favicons. The admin components inline the same path data
 * (Logo/paths.ts, Wordmark/letters.ts); Logo/brandAssets.test.ts fails if any of these drift apart.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BRAND_DIR = import.meta.dirname;
const ADMIN_DIR = join(BRAND_DIR, '..', 'apps', 'admin', 'src', 'assets', 'brand');
const SOURCE_FILE = 'classic-logo.svg';
/** The source's fills, used only to find its paths. */
const SOURCE_TILE_FILL = '#2F5BFF';
const SOURCE_LETTERS_FILL = '#0F1B3D';
/**
 * Output fills per palette. `letters` is the letters' colour on light grounds, `lettersOnDark` under a dark
 * colour scheme (the letters are `currentColor`, so an embedding page can set its own); `mono` is the
 * single-colour mark with the S cut out.
 */
const PALETTES = {
  shapio: {
    tile: '#E9F26E',
    s: '#231527',
    letters: '#231527',
    lettersOnDark: '#F5EBD8',
    mono: '#231527',
  },
  classic: {
    tile: '#2F5BFF',
    s: '#FFFFFF',
    letters: '#0F1B3D',
    lettersOnDark: '#FFFFFF',
    mono: '#0F1B3D',
  },
};
/** Tight boxes around the source geometry; the mark's is widened to a square, centred. */
const MARK_VIEWBOX = '165.9 188.4 391.6 391.6';
const WORDMARK_VIEWBOX = '616.1 280.1 737.1 240.5';
const LOGO_VIEWBOX = '182.6 188.4 1170.6 391.6';
/** The source's own canvas, kept for the full lockup files. */
const CANVAS_VIEWBOX = '0 0 1536 768';
const CANVAS_SIZE = ' width="1536" height="768"';

const source = readFileSync(join(BRAND_DIR, SOURCE_FILE), 'utf8');
const paths = [...source.matchAll(/<path fill="([^"]+)" d="([^"]+)"\/>/g)].map(([, fill, d]) => ({
  fill,
  d,
}));
const tile = paths.find(({ fill }) => fill.toUpperCase() === SOURCE_TILE_FILL)?.d;
const letters = paths.filter(({ fill }) => fill.toUpperCase() === SOURCE_LETTERS_FILL).map(({ d }) => d);
if (!tile || letters.length !== 7)
  throw new Error(
    `${SOURCE_FILE}: expected one ${SOURCE_TILE_FILL} path and seven ${SOURCE_LETTERS_FILL} paths`,
  );
// Every subpath after the first (the tile's outline) is part of the S.
const sCounters = `M${tile.split('M').filter(Boolean).slice(1).join('M')}`;

const svg = (viewBox, body, attributes = '') =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}"${attributes} role="img" aria-label="Shapio">\n  <title>Shapio</title>\n${body}</svg>\n`;
const letterBody = `  <g fill="currentColor">\n${letters.map((d) => `    <path d="${d}"/>`).join('\n')}\n  </g>\n`;

/** The files of one palette, keyed by role. */
const renderPalette = (palette) => {
  const markBody = `  <path fill="${palette.s}" d="${sCounters}"/>\n  <path fill="${palette.tile}" d="${tile}"/>\n`;
  // The letters take currentColor: the light-ground colour by default, the dark-ground one under a dark scheme.
  const lettersColor = ` color="${palette.letters}"`;
  const darkStyle = `  <style>@media (prefers-color-scheme: dark) { svg { color: ${palette.lettersOnDark}; } }</style>\n`;
  const lockupBody = darkStyle + markBody + letterBody;
  return {
    logo: svg(CANVAS_VIEWBOX, lockupBody, CANVAS_SIZE + lettersColor),
    horizontal: svg(LOGO_VIEWBOX, lockupBody, lettersColor),
    mark: svg(MARK_VIEWBOX, markBody),
    markMono: svg(MARK_VIEWBOX, `  <path fill="${palette.mono}" d="${tile}"/>\n`),
    wordmark: svg(WORDMARK_VIEWBOX, darkStyle + letterBody, lettersColor),
  };
};

const shapio = renderPalette(PALETTES.shapio);
const classic = renderPalette(PALETTES.classic);
const files = {
  [join(BRAND_DIR, 'shapio-logo.svg')]: shapio.logo,
  [join(BRAND_DIR, 'shapio-mark.svg')]: shapio.mark,
  [join(BRAND_DIR, 'shapio-mark-mono.svg')]: shapio.markMono,
  [join(BRAND_DIR, 'shapio-wordmark.svg')]: shapio.wordmark,
  [join(BRAND_DIR, 'classic-mark.svg')]: classic.mark,
  [join(BRAND_DIR, 'classic-mark-mono.svg')]: classic.markMono,
  [join(BRAND_DIR, 'classic-wordmark.svg')]: classic.wordmark,
  [join(ADMIN_DIR, 'mark.svg')]: shapio.mark,
  [join(ADMIN_DIR, 'wordmark.svg')]: shapio.wordmark,
  [join(ADMIN_DIR, 'logo-horizontal.svg')]: shapio.horizontal,
};
for (const [file, content] of Object.entries(files)) writeFileSync(file, content);
process.stdout.write(`brand: wrote ${Object.keys(files).length} files\n`);
