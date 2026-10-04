import { cn } from '@/helpers/cn';
import { MARK_PATH, MARK_S_PATH, MARK_VIEWBOX } from './paths';

type LogoVariant = 'default' | 'reverse';

type LogoProps = {
  /**
   * `default`: the logo-blue tile with a white S, on light and dark. `reverse`: an ivory tile with the S cut out,
   * for cobalt surfaces (the auth brand panel), where the blue tile would not stand out.
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
    {variant === 'reverse' ? (
      <path className="fill-ivory" d={MARK_PATH} />
    ) : (
      <>
        <path className="fill-brand-logo-foreground" d={MARK_S_PATH} />
        <path className="fill-brand-logo" d={MARK_PATH} />
      </>
    )}
  </svg>
);
