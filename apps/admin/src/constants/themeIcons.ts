import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import type { Appearance } from './themes';

export const THEME_ICONS = { system: Monitor, light: Sun, dark: Moon } satisfies Record<
  Appearance,
  LucideIcon
>;
