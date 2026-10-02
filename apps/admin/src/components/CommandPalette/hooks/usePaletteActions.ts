import type { PaletteItem } from '../types';
import { usePaletteItems } from './usePaletteItems';

/**
 * Actions on the current page, listed first in the palette while the screen is mounted (Publish, Open
 * settings, Start French…). Memoize the array; give each action a `run`, and a `hint` with its shortcut
 * when it has one.
 *
 * ```tsx
 * const actions = useMemo(() => [{ id: 'publish', label: t('entry.publish'), icon: Send, hint: '⌘⇧P', run: openPublish }], [t, openPublish]);
 * usePaletteActions(actions);
 * ```
 */
export const usePaletteActions = (actions: readonly PaletteItem[]) => usePaletteItems('page', actions);
