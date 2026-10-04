import type { ThemeVariant } from '@shapio/schema';
import { cva } from 'class-variance-authority';
import { cn } from '@/helpers/cn';
import { resolveScheme } from '@/helpers/theme';
import { useSystemPrefersDark } from '@/hooks/useSystemPrefersDark';
import { useThemeStore } from '@/stores/theme';
import { Logo } from '../Logo';

const swatchVariants = cva('shrink-0 border border-border bg-background', {
  variants: {
    size: {
      /** Menus: ground, surface and primary as three dots on the ground. */
      sm: 'inline-flex items-center gap-0.5 rounded-full p-0.5',
      /** Theme cards: the logo, a surface and a primary pill on the ground. */
      lg: 'flex h-14 w-full items-center gap-2 rounded-lg px-2.5',
    },
  },
  defaultVariants: { size: 'sm' },
});

type ThemeSwatchesProps = {
  themeKey: string;
  variants: readonly ThemeVariant[];
  size?: 'sm' | 'lg';
  className?: string;
};

/**
 * A theme's colours, drawn from its own tokens: the subtree carries `data-theme` (and `dark` for the variant
 * it would render with the current appearance). Swatches only, never live components: `dark:` variants
 * match ancestors, so a component inside a light preview on a dark page would mix both. Decorative.
 */
export const ThemeSwatches = ({ themeKey, variants, size, className }: ThemeSwatchesProps) => {
  const appearance = useThemeStore((state) => state.appearance);
  const systemPrefersDark = useSystemPrefersDark();
  const scheme = resolveScheme(appearance, variants, systemPrefersDark);
  return (
    <span
      aria-hidden="true"
      data-theme={themeKey}
      data-slot="theme-swatches"
      className={cn(swatchVariants({ size }), scheme === 'dark' && 'dark', className)}
    >
      {size === 'lg' ? (
        <>
          <Logo className="size-6" />
          <span className="h-7 flex-1 rounded-md border border-border bg-card" />
          <span className="h-4 w-8 rounded-full bg-primary" />
        </>
      ) : (
        <>
          <span className="size-2.5 rounded-full bg-card ring-1 ring-border" />
          <span className="size-2.5 rounded-full bg-primary" />
        </>
      )}
    </span>
  );
};
