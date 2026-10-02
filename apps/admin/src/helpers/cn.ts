import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Font sizes added in styles/index.css (`--text-*`). tailwind-merge treats an unknown `text-*` as a colour,
 * so without this `cn('text-title', 'text-muted-foreground')` would drop one of them.
 */
const CUSTOM_FONT_SIZES = ['display', 'title', 'canvas', 'meta', '2xs'];

const twMerge = extendTailwindMerge({ extend: { theme: { text: CUSTOM_FONT_SIZES } } });

/** Joins conditional class names and resolves Tailwind conflicts (a caller's `p-2` beats a default `p-4`). */
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
