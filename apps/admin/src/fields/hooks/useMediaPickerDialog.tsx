import type { MediaPickOptions, PickedMedia } from '@shapio/editor-sdk';
import { useCallback, useRef, useState } from 'react';
import { toPickedMedia } from '../helpers/media';
import { MediaPickerSheet } from '../MediaPickerSheet';

type PendingPick = { options: MediaPickOptions; resolve: (assets: PickedMedia[] | null) => void };

/**
 * `pickMedia` for editors (the editor contract's media capability): opens the library in a sheet and resolves
 * with the chosen assets, or null when cancelled. Render `dialog` once in the form.
 */
export const useMediaPickerDialog = () => {
  const [pending, setPending] = useState<PendingPick | null>(null);
  const pendingRef = useRef<PendingPick | null>(null);
  const settle = useCallback((assets: PickedMedia[] | null) => {
    pendingRef.current?.resolve(assets);
    pendingRef.current = null;
    setPending(null);
  }, []);
  const pickMedia = useCallback(
    (options: MediaPickOptions = {}) =>
      new Promise<PickedMedia[] | null>((resolve) => {
        pendingRef.current?.resolve(null);
        const next = { options, resolve };
        pendingRef.current = next;
        setPending(next);
      }),
    [],
  );
  const dialog = (
    <MediaPickerSheet
      open={pending !== null}
      options={pending?.options ?? {}}
      onPick={(assets) => settle(assets.map(toPickedMedia))}
      onCancel={() => settle(null)}
    />
  );
  return { pickMedia, dialog };
};
