import { useEffect, useRef } from 'react';

type DocumentShortcuts = {
  /** ⌘⇧P: open the publish pre-flight. */
  onPublish?: () => void;
  /** ⌘/: open or close the settings drawer. */
  onToggleSettings: () => void;
  /** ⌘⇧L: the next locale. */
  onCycleLocale?: () => void;
};

type Shortcut = {
  key: string;
  shift: boolean;
  run: (handlers: DocumentShortcuts) => (() => void) | undefined;
};

const SHORTCUTS: readonly Shortcut[] = [
  { key: 'p', shift: true, run: (handlers) => handlers.onPublish },
  { key: '/', shift: false, run: (handlers) => handlers.onToggleSettings },
  { key: 'l', shift: true, run: (handlers) => handlers.onCycleLocale },
];

/**
 * The document's keyboard shortcuts besides ⌘S (`useSaveShortcut`): ⌘⇧P publish, ⌘/ settings, ⌘⇧L next
 * locale. ⌘K stays the command palette; the rich-text link shortcut is ⌘⇧K.
 */
export const useDocumentShortcuts = (handlers: DocumentShortcuts, enabled: boolean) => {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }
      const shortcut = SHORTCUTS.find(
        (candidate) => candidate.key === event.key.toLowerCase() && candidate.shift === event.shiftKey,
      );
      const run = shortcut?.run(latest.current);
      if (run) {
        event.preventDefault();
        run();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
};
