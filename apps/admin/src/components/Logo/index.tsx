import { cn } from '@/helpers/cn';
import { MARK_PATH, MARK_S_PATH, MARK_VIEWBOX } from './paths';

type LogoVariant = 'default' | 'reverse';

type LogoProps = {
  /**
   * `default`: the brand tile with its S, on any ground. `reverse`: for the auth brand panel, the tile in the
   * theme's brand-panel-mark colour (the S stays the brand's, so the mark reads the same in every theme).
   */
  variant?: LogoVariant;
  className?: string;
};

/** The Shapio mark (src/assets/brand/mark.svg), 32px by default. Decorative; pair it with the wordmark or a visible label. */
export const Logo = ({ variant = 'default', className }: LogoProps) => (
  <svg
    viewBox={MARK_VIEWBOX}
    aria-hidden="true"
    focusable="false"
    data-slot="logo"
    className={cn('size-8 shrink-0', className)}
  >
    <path className="fill-brand-logo-foreground" d={MARK_S_PATH} />
    <path className={variant === 'reverse' ? 'fill-brand-panel-mark' : 'fill-brand-logo'} d={MARK_PATH} />
  </svg>
);
