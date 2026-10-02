import type { LinkOptions } from '@tanstack/react-router';
import type { PaletteGroupKey } from '../types';

/** A place the admin went through the palette; stored without icons or callbacks. */
export type RecentItem = {
  id: string;
  label: string;
  hint?: string;
  group: PaletteGroupKey;
  link: LinkOptions;
};

export const RECENT_STORAGE_KEY = 'shapio.palette.recent';
export const RECENT_LIMIT = 6;

const isRecentItem = (value: unknown): value is RecentItem => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.label === 'string' &&
    typeof item.group === 'string' &&
    typeof item.link === 'object' &&
    item.link !== null
  );
};

/**
 * Recent items are a convenience: storage can be missing (private windows, blocked site data) or hold
 * anything, so every read and write is guarded and falls back to nothing.
 */
export const readRecentItems = (): RecentItem[] => {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isRecentItem).slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
};

/** Puts `item` first, without duplicates, and keeps the newest few. Returns the new list. */
export const rememberRecentItem = (item: RecentItem): RecentItem[] => {
  const next = [item, ...readRecentItems().filter((existing) => existing.id !== item.id)].slice(
    0,
    RECENT_LIMIT,
  );
  try {
    window.localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Not remembered this time; the palette works without it.
  }
  return next;
};
