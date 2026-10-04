import { cva } from 'class-variance-authority';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';
import { Logo } from '../Logo';
import { LETTER_PATHS, LETTERS_VIEWBOX } from './letters';

/**
 * Mark and letters share one height, so the letters keep the logo's own proportions (x-height ≈ 0.35 × the
 * mark); the gap is the logo's own (about 0.15 × the mark).
 */
const wordmarkVariants = cva('inline-flex shrink-0 items-center [&>svg]:w-auto', {
  variants: {
    size: {
      /** Sidebar and the auth screens' compact header: 36px. */
      default: 'gap-1.5 [&>svg]:h-9',
      /** Status bar and the phone header: 24px. */
      sm: 'gap-1 [&>svg]:h-6',
      /** The auth brand panel: 52px. */
      lg: 'gap-2 [&>svg]:h-13',
    },
    variant: {
      /** Logo-blue mark, letters ink on light and ivory on dark. */
      default: 'text-ink dark:text-ivory',
      /** For cobalt surfaces: reverse mark, letters in the surface's text colour. */
      reverse: '',
    },
  },
  defaultVariants: { size: 'default', variant: 'default' },
});

type WordmarkProps = {
  size?: 'default' | 'sm' | 'lg';
  variant?: 'default' | 'reverse';
  className?: string;
};

/**
 * The Shapio logo: mark + "shapio" letters (src/assets/brand/logo-horizontal.svg). The letters take
 * `currentColor`. Announced as "Shapio"; the letters carry `data-slot="wordmark-letters"` so a container can
 * hide them (the collapsed sidebar shows the mark only).
 */
export const Wordmark = ({ size, variant, className }: WordmarkProps) => {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t('app.name')}
      className={cn(wordmarkVariants({ size, variant }), className)}
    >
      <Logo variant={variant ?? 'default'} />
      <svg
        viewBox={LETTERS_VIEWBOX}
        aria-hidden="true"
        focusable="false"
        data-slot="wordmark-letters"
        className="fill-current"
      >
        {LETTER_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
    </span>
  );
};
