import type { Media } from '../../lib/types';

type ResponsiveImageProps = { media: Media; sizes: string; eager?: boolean; className?: string };

/** WebP variants in `srcSet`, intrinsic size set (no layout shift), lazy unless eager. */
export const ResponsiveImage = ({ media, sizes, eager = false, className }: ResponsiveImageProps) => {
  const widths = media.variants
    .filter((variant) => variant.name.startsWith('w') && variant.width !== null)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  const largest = widths.at(-1);
  return (
    <img
      src={largest?.url ?? media.url}
      srcSet={
        widths.length > 0 ? widths.map((variant) => `${variant.url} ${variant.width}w`).join(', ') : undefined
      }
      sizes={widths.length > 0 ? sizes : undefined}
      width={media.width ?? undefined}
      height={media.height ?? undefined}
      alt={media.alt}
      loading={eager ? 'eager' : 'lazy'}
      fetchPriority={eager ? 'high' : undefined}
      decoding="async"
      className={className}
    />
  );
};
