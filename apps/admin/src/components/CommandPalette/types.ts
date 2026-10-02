import type { LinkOptions } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';

/**
 * One thing the palette can do: go somewhere (`link`, remembered as a recent item) or act on the current
 * page (`run`, e.g. Publish, registered by the screen with `usePaletteActions`).
 */
export type PaletteItem = {
  /** Unique within its group; recent items are told apart by it. */
  id: string;
  label: string;
  /** Extra words that should find the item (an API ID, the section it lives in). */
  keywords?: readonly string[];
  /** Short text on the right: where the item lives, or its keyboard shortcut. */
  hint?: string;
  icon?: LucideIcon;
  link?: LinkOptions;
  run?: () => void;
};

/** Groups that screens and the shell fill; the palette adds recent items, entries and media itself. */
export type RegisteredGroup = 'page' | 'create' | 'goto';

export type PaletteGroupKey = RegisteredGroup | 'recent' | 'entries' | 'media';

export type PaletteGroup = { key: PaletteGroupKey; items: PaletteItem[] };
