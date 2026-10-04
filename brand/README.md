# Shapio brand assets

The Shapio logo is a rounded acid-yellow tile with a plum S, followed by the lowercase "shapio" letters: plum on
light backgrounds, cream on dark ones. The original blue logo is kept as the `classic-*` set. Both sets share
one geometry; only the fills differ. `classic-logo.svg` is the source lockup (a 1536 × 768 canvas); every other
file is generated from it.

## Files

| File                    | Use                                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| `shapio-logo.svg`       | The lockup on the original canvas: mark + letters (`currentColor`: plum; cream under a dark scheme).  |
| `shapio-mark.svg`       | The mark, square viewBox: yellow tile, plum S. The default mark on light and dark, and the favicon.   |
| `shapio-mark-mono.svg`  | Monochrome: plum tile with the S cut out. Single-colour printing, or where colour is not wanted.      |
| `shapio-wordmark.svg`   | The "shapio" letters only, tight viewBox, in `currentColor` (plum; cream under a dark colour scheme). |
| `classic-logo.svg`      | Source: the original blue lockup, S cut out of the tile. Edit this one only, then regenerate.         |
| `classic-mark.svg`      | The original mark: blue tile, white S.                                                                |
| `classic-mark-mono.svg` | The original monochrome mark: navy tile with the S cut out.                                           |
| `classic-wordmark.svg`  | The original letters in `currentColor` (navy; white under a dark colour scheme).                      |

## Palettes

**Shapio** (the brand, used everywhere: the admin in every theme, favicons, docs)

| Name        | Hex       | Role                                                             |
| ----------- | --------- | ---------------------------------------------------------------- |
| Acid yellow | `#E9F26E` | The tile                                                         |
| Plum        | `#231527` | The S, the letters on light backgrounds, and the monochrome mark |
| Cream       | `#F5EBD8` | The letters on dark backgrounds                                  |

**Classic** (the original logo, kept for reference; not used by the admin)

| Name      | Hex       | Role                                                      |
| --------- | --------- | --------------------------------------------------------- |
| Logo blue | `#2F5BFF` | The tile                                                  |
| Navy      | `#0F1B3D` | The letters on light backgrounds, and the monochrome mark |
| White     | `#FFFFFF` | The S, and the letters on dark backgrounds                |

The admin's Cobalt UI theme (cobalt primary) is a colour theme, not the old logo: it shows the Shapio logo too.

## Usage

- In the source the S is a hole cut out of the tile, so on its own it would show whatever is behind it. Every
  generated colour mark draws the S underneath the tile in its own colour: plum for Shapio, white for Classic.
  On a dark background the Shapio S stays plum, never white. Only the monochrome marks keep the S as a cut-out.
- Letters: plum on light grounds, cream on dark grounds. The letter files use `currentColor`, so a page that
  embeds them inline sets the colour; standalone, they follow the viewer's colour scheme.
- Keep clear space of at least a quarter of the mark's height on every side. Don't recolour, rotate, skew
  or add effects. Never set "shapio" as live text in place of the outlined letters.

## Copies in the admin

`apps/admin/src/assets/brand/` holds `mark.svg` and `wordmark.svg` (identical to `shapio-mark.svg` and
`shapio-wordmark.svg`) and `logo-horizontal.svg` (mark + letters, tight viewBox), all in the Shapio palette. The
admin's `Logo` and `Wordmark` components inline the same path data (`Logo/paths.ts`, `Wordmark/letters.ts`) and
colour it from the theme's brand tokens; `public/favicon.svg`, `favicon-32.png` and `apple-touch-icon.png` are
rendered from the mark (the touch icon puts the plum S on a full-bleed yellow square).
`apps/admin/src/components/Logo/brandAssets.test.ts` fails if `brand/`, the admin files, the component geometry
or the favicon drift apart, or if the Shapio and Classic sets stop sharing one geometry.

## Regenerating

1. `node brand/build.mjs` (Node only, no dependencies) writes the files above from `classic-logo.svg`, and the
   three admin copies. It finds the source's paths by their fills (blue tile, navy letters), so keep those
   fills in the source; the output colours are the `PALETTES` table in the script.
2. `pnpm --filter @shapio/admin brand:icons` renders the admin favicons from `mark.svg` (uses `sharp`).
3. If the geometry changed, copy the path data into `Logo/paths.ts` and `Wordmark/letters.ts`; the brand test
   names any mismatch.
