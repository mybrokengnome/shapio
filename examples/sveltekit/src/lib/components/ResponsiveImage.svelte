<script lang="ts">
  import type { Media } from '../types';

  type Props = { media: Media; sizes: string; eager?: boolean; class?: string };
  let { media, sizes, eager = false, class: className }: Props = $props();

  // WebP variants in srcset, intrinsic size set (no layout shift), lazy unless eager.
  const widths = $derived(
    media.variants
      .filter((variant) => variant.name.startsWith('w') && variant.width !== null)
      .sort((a, b) => (a.width ?? 0) - (b.width ?? 0)),
  );
  const srcset = $derived(widths.map((variant) => `${variant.url} ${variant.width}w`).join(', '));
</script>

<img
  src={widths.at(-1)?.url ?? media.url}
  srcset={srcset || undefined}
  sizes={srcset ? sizes : undefined}
  width={media.width ?? undefined}
  height={media.height ?? undefined}
  alt={media.alt}
  loading={eager ? 'eager' : 'lazy'}
  fetchpriority={eager ? 'high' : undefined}
  decoding="async"
  class={className}
/>
