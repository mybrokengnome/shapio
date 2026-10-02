import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import type { ThemePreference } from '@/stores/theme';

export const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<
  ThemePreference,
  LucideIcon
>;
