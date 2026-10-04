// Regenerates the admin's favicons from the mark: pnpm --filter @shapio/admin brand:icons
//   public/favicon.svg          a copy of src/assets/brand/mark.svg
//   public/favicon-32.png       the mark, 32 × 32, transparent around the tile
//   public/apple-touch-icon.png 180 × 180, the plum S on the tile's acid yellow, full bleed (iOS rounds the corners)
// brandAssets.test.ts checks that favicon.svg matches mark.svg.
import { copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ADMIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARK_FILE = join(ADMIN_DIR, 'src', 'assets', 'brand', 'mark.svg');
const PUBLIC_DIR = join(ADMIN_DIR, 'public');
/** The tile's share of the touch icon: the S then sits about a quarter in from every edge. */
const TOUCH_ICON_MARK_SCALE = 0.84;

const markSvg = readFileSync(MARK_FILE, 'utf8');
const viewBox = /viewBox="([^"]+)"/.exec(markSvg)?.[1];
const body = /<\/title>\n([\s\S]*)<\/svg>/.exec(markSvg)?.[1];
// The tile is the mark's last path; its fill (the logo yellow) is the touch icon's background.
const tileFill = [...markSvg.matchAll(/fill="([^"]+)"/g)].at(-1)?.[1];
if (!viewBox || !body || !tileFill) throw new Error(`${MARK_FILE}: viewBox, paths or tile fill not found`);
const [minX, minY, size] = viewBox.split(' ').map(Number);

/** The mark centred on a square canvas of `size` units, optionally on a full-bleed background. */
const markOnCanvas = (scale, background) => {
  const canvas = size / scale;
  const offset = (canvas - size) / 2;
  const fill = background
    ? `<rect x="${minX - offset}" y="${minY - offset}" width="${canvas}" height="${canvas}" fill="${background}"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - offset} ${minY - offset} ${canvas} ${canvas}">${fill}${body}</svg>`;
};

const renderPng = (svg, pixels, file) =>
  sharp(Buffer.from(svg), { density: 600 })
    .resize(pixels, pixels)
    .png({ compressionLevel: 9 })
    .toFile(join(PUBLIC_DIR, file));

copyFileSync(MARK_FILE, join(PUBLIC_DIR, 'favicon.svg'));
await renderPng(markOnCanvas(1), 32, 'favicon-32.png');
await renderPng(markOnCanvas(TOUCH_ICON_MARK_SCALE, tileFill), 180, 'apple-touch-icon.png');
process.stdout.write('brand: wrote public/favicon.svg, public/favicon-32.png, public/apple-touch-icon.png\n');
