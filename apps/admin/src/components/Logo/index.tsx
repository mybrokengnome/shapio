import { cn } from '@/helpers/cn';

type LogoVariant = 'default' | 'reverse';

type LogoProps = {
  /** `default`: full colour (periwinkle flaps, cobalt bands). `reverse`: ivory bands on a cobalt tile, for cobalt surfaces. */
  variant?: LogoVariant;
  className?: string;
};

/**
 * Geometry from brand/shapio-mark.svg and brand/shapio-mark-reverse.svg: two folded bands forming an S; the
 * flaps are the folded-back ends. Keep in step with `node brand/build.mjs --paths`.
 */
const FLAP_PATH =
  'M43.39 8.16L51.31 12.73A8.25 8.25 0 0 1 55.43 19.88L55.43 21.08A4.72 4.72 0 0 1 48.36 25.17L33.51 16.59ZM20.61 55.84L12.69 51.27A8.25 8.25 0 0 1 8.57 44.12L8.57 42.92A4.72 4.72 0 0 1 15.64 38.83L30.49 47.41Z';
const BAND_PATH =
  'M30.23 5.67A8.84 8.84 0 0 1 39.07 5.67L47.52 10.54L26.62 22.61A3.24 3.24 0 0 0 25 25.42L25 26.92A2.65 2.65 0 0 0 26.33 29.21L29.37 30.97A1.47 1.47 0 0 1 29.37 33.52L24.24 36.48A3.24 3.24 0 0 1 21 36.48L15.27 33.17A10.61 10.61 0 0 1 9.97 23.98L9.97 23.49A10.61 10.61 0 0 1 15.27 14.3ZM33.77 58.33A8.84 8.84 0 0 1 24.93 58.33L16.48 53.46L37.38 41.39A3.24 3.24 0 0 0 39 38.58L39 37.08A2.65 2.65 0 0 0 37.67 34.79L34.63 33.03A1.47 1.47 0 0 1 34.63 30.48L39.76 27.52A3.24 3.24 0 0 1 43 27.52L48.73 30.83A10.61 10.61 0 0 1 54.03 40.02L54.03 40.51A10.61 10.61 0 0 1 48.73 49.7Z';
/** Reverse only: the cobalt seams where the ivory flaps meet the bands. */
const SEAM_PATH = 'M35.28 17.61L47.52 10.54M28.72 46.39L16.48 53.46';

/** The Shapio mark. Decorative; pair it with the wordmark or a visible label. */
export const Logo = ({ variant = 'default', className }: LogoProps) => (
  <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" className={cn('size-8 shrink-0', className)}>
    {variant === 'reverse' ? (
      <>
        <rect width="64" height="64" rx="14" className="fill-cobalt" />
        <g transform="translate(32 32) scale(0.72) translate(-32 -32)">
          <path className="fill-ivory" d={FLAP_PATH} />
          <path className="fill-ivory" d={BAND_PATH} />
          <path className="fill-none stroke-cobalt" strokeWidth="1.1" d={SEAM_PATH} />
        </g>
      </>
    ) : (
      <>
        <path className="fill-periwinkle" d={FLAP_PATH} />
        <path className="fill-cobalt" d={BAND_PATH} />
      </>
    )}
  </svg>
);
