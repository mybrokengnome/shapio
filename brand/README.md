# Shapio brand assets

The Shapio logo is a rounded blue tile with a white S, followed by the lowercase "shapio" letters in navy.
`shapio-logo.svg` is the source lockup (a 1536 × 768 canvas); every other file is generated from it.

| File                   | Use                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `shapio-logo.svg`      | Source: mark + letters on the original canvas. Edit this one only, then regenerate.                                   |
| `shapio-mark.svg`      | The mark, square viewBox: blue tile, white S. The default mark on light and dark backgrounds, and the favicon source. |
| `shapio-mark-mono.svg` | Monochrome: navy tile with the S cut out. Single-colour printing, or where colour is not wanted.                      |
| `shapio-wordmark.svg`  | The "shapio" letters only, tight viewBox, in `currentColor` (navy; white under a dark colour scheme).                 |

## Palette

| Name      | Hex       | Role                                                      |
| --------- | --------- | --------------------------------------------------------- |
| Logo blue | `#2F5BFF` | The tile. The logo's own blue, not a UI colour.           |
| Navy      | `#0F1B3D` | The letters on light backgrounds, and the monochrome mark |
| White     | `#FFFFFF` | The S, and the letters on dark backgrounds                |

The admin UI's palette (Cobalt `#2563EB`, Periwinkle, Ink, Ivory) is separate: the logo keeps its own blue
beside it, and the admin draws the letters in ink on light and ivory on dark.

## Usage

- In the source the S is a hole cut out of the tile, so on a dark background it would show the background.
  Every generated mark draws the same S in white underneath the tile; do the same anywhere the mark is
  placed on a dark or coloured surface. Only the monochrome mark keeps the S as a cut-out.
- On a surface close to the logo blue (a cobalt panel), use a light tile with the S cut out instead, as the
  admin's sign-in brand panel does.
- Keep clear space of at least a quarter of the mark's height on every side. Don't recolour, rotate, skew
  or add effects. Never set "shapio" as live text in place of the outlined letters.

## Copies in the admin

`apps/admin/src/assets/brand/` holds `mark.svg` and `wordmark.svg` (identical to `shapio-mark.svg` and
`shapio-wordmark.svg`) and `logo-horizontal.svg` (mark + letters, tight viewBox). The admin's `Logo` and
`Wordmark` components inline the same path data (`Logo/paths.ts`, `Wordmark/letters.ts`), and
`public/favicon.svg`, `favicon-32.png` and `apple-touch-icon.png` are rendered from the mark.
`apps/admin/src/components/Logo/brandAssets.test.ts` fails if `brand/`, the admin files, the component
geometry or the favicon drift apart.

## Regenerating

1. `node brand/build.mjs` (Node only, no dependencies) writes the files above from `shapio-logo.svg`, and the
   three admin copies.
2. `pnpm --filter @shapio/admin brand:icons` renders the admin favicons from `mark.svg` (uses `sharp`).
3. If the geometry changed, copy the path data into `Logo/paths.ts` and `Wordmark/letters.ts`; the brand test
   names any mismatch.
