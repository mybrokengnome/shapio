import { Dialog as DialogPrimitive } from 'radix-ui';
import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { LoadingState } from '../LoadingState';
import { usePaletteShortcut } from './hooks/usePaletteShortcut';
import { usePaletteStore } from './store';

const Body = lazy(() => import('./Body').then((module) => ({ default: module.Body })));

/**
 * ⌘K: go anywhere (places, entries, media, settings), create, and act on the current page. The one
 * centred overlay the admin allows (DESIGN.md): a transient launcher with nothing to lose, so it never
 * holds a form. Modal for assistive technology (focus trapped, page inert); Escape or a click outside
 * closes it and focus returns to where it was. Mounted once by the Shell.
 */
export const CommandPalette = () => {
  const { t } = useTranslation();
  const open = usePaletteStore((state) => state.open);
  const setOpen = usePaletteStore((state) => state.setOpen);
  usePaletteShortcut();
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-overlay/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Opened by a shortcut there is no trigger to return to: focus goes back to what had it, if it is
          // still on the page (a palette choice may have navigated away).
          onCloseAutoFocus={(event) => {
            const target = usePaletteStore.getState().returnFocus;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          className="fixed top-4 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-lg outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 sm:top-[12dvh]"
        >
          <DialogPrimitive.Title className="sr-only">{t('palette.title')}</DialogPrimitive.Title>
          <Suspense fallback={<LoadingState rows={3} className="p-4" />}>
            <Body onClose={() => setOpen(false)} />
          </Suspense>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
