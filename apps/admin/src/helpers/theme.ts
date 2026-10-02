import type { ThemePreference } from '@/stores/theme';

/** The theme actually rendered: light or dark, never "system". */
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

/** What a preference renders as, given whether the OS currently prefers dark. */
export const resolveTheme = (preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme =>
  preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;

/** The explicit theme a one-click switch moves to: the opposite of what is rendered now. */
export const oppositeTheme = (theme: ResolvedTheme): ResolvedTheme => (theme === 'dark' ? 'light' : 'dark');
