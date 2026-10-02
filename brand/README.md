# Shapio brand assets

The Shapio mark is two folded bands that form an S. Each band is cobalt; its folded-back end (the flap) is
periwinkle. The geometry follows the logo sheet in the admin design mockup and is drawn on a 64 × 64 grid,
optically centred, with band edges at ±30°.

| File                      | Use                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `shapio-mark.svg`         | Full colour. The default mark, on light and dark backgrounds.                                                    |
| `shapio-mark-mono.svg`    | Monochrome (ink). Single-colour printing, or on ivory where colour is not wanted.                                |
| `shapio-mark-reverse.svg` | Reverse: ivory bands on a cobalt rounded tile. App icons and favicons (reads best at 16–32 px).                  |
| `shapio-wordmark.svg`     | Full-colour mark + "shapio" in Manrope ExtraBold (outlined, no font needed). Ink text: use on light backgrounds. |

## Palette

| Name       | Hex       | Role                                  |
| ---------- | --------- | ------------------------------------- |
| Cobalt     | `#2563EB` | Primary; the bands                    |
| Periwinkle | `#A5B4FC` | Accent; the folded flaps              |
| Ink        | `#0F172A` | Text and the monochrome mark          |
| Ivory      | `#FAF9F6` | Light background and the reverse mark |

## Usage

- Keep clear space of at least a quarter of the mark's height on every side.
- Don't recolour the bands, rotate or skew the mark, or add effects. On dark backgrounds use the full-colour
  mark as is, or the reverse tile.
- Typeface: Manrope (SIL Open Font License); ExtraBold for the wordmark, Regular/Medium/Semibold for UI text.
- Copies of these files live in the admin (`apps/admin/src/components/Logo`, `apps/admin/public/favicon.svg`)
  and in the shapio_home site (`brand/`, `src/components/LogoMark.astro`, `public/`). Update them together.

## Regenerating

`node brand/build.mjs` rebuilds every SVG here from the geometry defined in the script (Node only, no
dependencies); `node brand/build.mjs --paths` prints the two path strings that the admin `Logo` component
and the site's `LogoMark.astro` inline. The wordmark's lettering is not regenerated: it was outlined once
from Manrope at weight 800 (instanced from the variable font with fontTools, shaped with HarfBuzz, tracking
−0.02em, x-height scaled to 0.595 × the mark height) and the script keeps that path as is, redrawing only
the mark beside it. Re-outline it only if the typeface or weight changes.
