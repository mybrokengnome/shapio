import { useEffect } from 'react';
import { usePaletteStore } from '../store';

/**
 * ⌘K (Ctrl+K elsewhere) toggles the palette from anywhere, inputs and editors included: it listens in the
 * capture phase so it runs before an editor's own key handling (rich text links moved to ⌘⇧K).
 */
export const usePaletteShortcut = () => {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
      ) {
        event.preventDefault();
        const { open, setOpen } = usePaletteStore.getState();
        setOpen(!open);
      }
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);
};
