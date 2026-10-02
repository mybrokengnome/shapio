/**
 * Regenerates the Shapio mark SVGs in this directory: `node brand/build.mjs`.
 *
 * The geometry is defined in mockup pixels (the logo sheet in the admin design mockup), centred on (0,0)
 * with y down, then scaled onto a 64 × 64 grid. Each band is a rounded polygon whose edges run at ±30°;
 * the lower band is the upper band rotated 180°. The periwinkle flap is drawn first and the cobalt band on
 * top, so the fold line is a single crisp edge. The wordmark's lettering is already outlined in
 * shapio-wordmark.svg (see README.md); this script keeps that path and redraws the mark beside it.
 *
 * The admin Logo component and the site's LogoMark.astro inline FLAP_PATH and BAND_PATH printed by
 * `node brand/build.mjs --paths`; update them together.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = import.meta.dirname;
const COLORS = { cobalt: '#2563EB', periwinkle: '#A5B4FC', ink: '#0F172A', ivory: '#FAF9F6' };
const SLOPE = Math.tan(Math.PI / 6);
const SCALE = 56 / 190; // mark height 56 on the 64 grid

const P = {
  apex: [9, -98],
  xLeft: -74.75, // outer left side
  xRight: 79.5, // flap end
  xInner: -23.75, // inner left side
  innerUpperLeft: [8.5, -47.3], // also the fold line
  flapLower: [21, -43.1],
  innerLowerLeft: [-15, -7],
  endCut: [-13.5, 7.8],
  outerLowerLeft: [-55.5, 4.7],
  radius: { apex: 30, left: 36, innerTop: 11, innerBottom: 9, tip: 5, foot: 11, flapTop: 28, flapBottom: 16 },
};

// Lines as functions of x: d1 rises to the right, d2 falls to the right.
const d1 =
  ([x0, y0]) =>
  (x) =>
    y0 - SLOPE * (x - x0);
const d2 =
  ([x0, y0]) =>
  (x) =>
    y0 + SLOPE * (x - x0);
const meet = (rising, falling) => {
  const x = (rising(0) - falling(0)) / (2 * SLOPE);
  return [x, rising(x)];
};

const outerUpperLeft = d1(P.apex);
const outerUpperRight = d2(P.apex);
const innerUpperLeft = d1(P.innerUpperLeft);
const flapLower = d2(P.flapLower);
const innerLowerLeft = d2(P.innerLowerLeft);
const endCut = d1(P.endCut);
const outerLowerLeft = d2(P.outerLowerLeft);

const foldOuter = meet(innerUpperLeft, outerUpperRight);
const foldInner = meet(innerUpperLeft, flapLower);
const r = P.radius;

const band = [
  [P.apex, r.apex],
  [foldOuter, 0],
  [[P.xInner, innerUpperLeft(P.xInner)], r.innerTop],
  [[P.xInner, innerLowerLeft(P.xInner)], r.innerBottom],
  [meet(endCut, innerLowerLeft), r.tip],
  [meet(endCut, outerLowerLeft), r.foot],
  [[P.xLeft, outerLowerLeft(P.xLeft)], r.left],
  [[P.xLeft, outerUpperLeft(P.xLeft)], r.left],
];
// The flap's closing edge runs under the band, so only its outer edges show.
const flapStart = foldOuter[0] - 14;
const flapEnd = foldInner[0] - 6;
const flap = [
  [[flapStart, outerUpperRight(flapStart)], 0],
  [[P.xRight, outerUpperRight(P.xRight)], r.flapTop],
  [[P.xRight, flapLower(P.xRight)], r.flapBottom],
  [[flapEnd, flapLower(flapEnd)], 0],
];

const toGrid = ([x, y], rotated) =>
  rotated ? [32 - x * SCALE, 32 - y * SCALE] : [32 + x * SCALE, 32 + y * SCALE];
const num = (n) => String(+n.toFixed(2));
const unit = ([x, y]) => {
  const length = Math.hypot(x, y);
  return [x / length, y / length];
};

/** A closed path through the vertices, each corner rounded with an arc of its radius. */
const roundedPath = (polygon, rotated) => {
  const points = polygon.map(([vertex, radius]) => [toGrid(vertex, rotated), radius * SCALE]);
  const commands = points.map(([v, radius], i) => {
    const prev = points[(i + points.length - 1) % points.length][0];
    const next = points[(i + 1) % points.length][0];
    const move = i === 0 ? 'M' : 'L';
    if (!radius) return `${move}${num(v[0])} ${num(v[1])}`;
    const toPrev = unit([prev[0] - v[0], prev[1] - v[1]]);
    const toNext = unit([next[0] - v[0], next[1] - v[1]]);
    const angle = Math.acos(Math.max(-1, Math.min(1, toPrev[0] * toNext[0] + toPrev[1] * toNext[1])));
    const tangent = radius / Math.tan(angle / 2);
    const a = [v[0] + toPrev[0] * tangent, v[1] + toPrev[1] * tangent];
    const b = [v[0] + toNext[0] * tangent, v[1] + toNext[1] * tangent];
    const clockwise = (v[0] - prev[0]) * (next[1] - v[1]) - (v[1] - prev[1]) * (next[0] - v[0]) > 0;
    return `${move}${num(a[0])} ${num(a[1])}A${num(radius)} ${num(radius)} 0 0 ${clockwise ? 1 : 0} ${num(b[0])} ${num(b[1])}`;
  });
  return `${commands.join('')}Z`;
};
const segment = (from, to, rotated) => {
  const [a, b] = [toGrid(from, rotated), toGrid(to, rotated)];
  return `M${num(a[0])} ${num(a[1])}L${num(b[0])} ${num(b[1])}`;
};

const FLAP_PATH = roundedPath(flap) + roundedPath(flap, true);
const BAND_PATH = roundedPath(band) + roundedPath(band, true);
const FOLD_PATH = segment(foldInner, foldOuter) + segment(foldInner, foldOuter, true);

if (process.argv.includes('--paths')) {
  process.stdout.write(`FLAP_PATH = '${FLAP_PATH}'\nBAND_PATH = '${BAND_PATH}'\n`);
  process.exit(0);
}

const svg = (viewBox, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="Shapio">\n  <title>Shapio</title>\n${body}</svg>\n`;
const mark = (flapFill, bandFill, indent = '  ') =>
  `${indent}<path fill="${flapFill}" d="${FLAP_PATH}"/>\n${indent}<path fill="${bandFill}" d="${BAND_PATH}"/>\n`;
const write = (name, content) => writeFileSync(join(DIR, name), content);

write('shapio-mark.svg', svg('0 0 64 64', mark(COLORS.periwinkle, COLORS.cobalt)));
write('shapio-mark-mono.svg', svg('0 0 64 64', mark(COLORS.ink, COLORS.ink)));
write(
  'shapio-mark-reverse.svg',
  svg(
    '0 0 64 64',
    `  <rect width="64" height="64" rx="14" fill="${COLORS.cobalt}"/>\n` +
      '  <g transform="translate(32 32) scale(0.72) translate(-32 -32)">\n' +
      mark(COLORS.ivory, COLORS.ivory, '    ') +
      `    <path fill="none" stroke="${COLORS.cobalt}" stroke-width="1.1" d="${FOLD_PATH}"/>\n  </g>\n`,
  ),
);

// Wordmark: keep the outlined lettering (and its viewBox) from the existing file, redraw the mark.
const wordmarkFile = join(DIR, 'shapio-wordmark.svg');
const existing = readFileSync(wordmarkFile, 'utf8');
const viewBox = existing.match(/viewBox="([^"]+)"/)?.[1];
const lettering = existing.split('\n').find((line) => line.includes('<path') && line.includes('transform='));
if (!viewBox || !lettering) throw new Error('shapio-wordmark.svg: lettering path not found');
write('shapio-wordmark.svg', svg(viewBox, mark(COLORS.periwinkle, COLORS.cobalt) + `${lettering}\n`));

process.stdout.write(
  'brand: wrote shapio-mark.svg, shapio-mark-mono.svg, shapio-mark-reverse.svg, shapio-wordmark.svg\n',
);
