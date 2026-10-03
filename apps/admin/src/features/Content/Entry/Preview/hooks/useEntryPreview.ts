import type { ComponentDefinition, ModelDefinition } from '@shapio/schema';
import { VISUAL_PROTOCOL_VERSION, type AdminMessage } from '@shapio/visual';
import { useCallback, useMemo, useRef, useState } from 'react';
import { usePreviewTargets } from '@/api/preview';
import type { EntryFormStore } from '@/fields/form/store';
import { useIsMobile } from '@/hooks/use-mobile';
import type { SaveState } from '../../hooks/useEntrySaver';
import { canFramePreview, framedPreviewUrl, httpOriginOf } from '../helpers/previewFrame';
import { useFrameBlocked } from './useFrameBlocked';
import { usePreviewFocus } from './usePreviewFocus';
import { usePreviewMessages } from './usePreviewMessages';
import { usePreviewRefresh } from './usePreviewRefresh';
import { usePreviewSession } from './usePreviewSession';

type EntryPreviewOptions = {
  model: ModelDefinition;
  components: ReadonlyMap<string, ComponentDefinition>;
  /** null until the entry exists (creating): no preview then. */
  entryId: string | null;
  locale: string | null;
  store: EntryFormStore;
  saveStatus: SaveState['status'];
  reveal: (path: string) => void;
};

const REFRESH: AdminMessage = { type: 'shapio:refresh', v: VISUAL_PROTOCOL_VERSION };

/**
 * The entry document's preview: which connection it opens on, its token (refreshed before expiry), the framed
 * URL, the conversation with the site (ready, focus, refresh after saves), and, on phones, whether the
 * document is slid in over it.
 */
export const useEntryPreview = (options: EntryPreviewOptions) => {
  const { model, entryId, locale, saveStatus } = options;
  const targets = usePreviewTargets();
  const mobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [documentShown, setDocumentShown] = useState(false);
  const [chosen, setChosen] = useState<string | undefined>();
  const list = useMemo(() => targets.data ?? [], [targets.data]);
  const target =
    list.find((item) => item.connectionId === chosen) ?? list.find((item) => item.framable) ?? list[0];
  const active = open && entryId !== null && target !== undefined;
  const session = usePreviewSession(
    { modelKey: model.apiKey, entryId: entryId ?? '', locale, connectionId: target?.connectionId },
    active,
  );
  const siteUrl = session.status === 'ready' ? (session.url ?? undefined) : undefined;
  const framable = siteUrl !== undefined && canFramePreview(siteUrl, window.location.origin);
  const frameUrl = framable ? framedPreviewUrl(siteUrl) : undefined;
  const origin = frameUrl ? httpOriginOf(frameUrl) : undefined;
  const frameRef = useRef<HTMLIFrameElement>(null);

  const reveal = options.reveal;
  const focusField = useCallback(
    (path: string) => {
      if (!mobile) {
        reveal(path);
        return;
      }
      // On phones the document slides in over the preview first; reveal once it is on screen.
      setDocumentShown(true);
      window.setTimeout(() => reveal(path), 200);
    },
    [mobile, reveal],
  );
  const onFocus = usePreviewFocus({ ...options, entryId: entryId ?? '', reveal: focusField });
  const messages = usePreviewMessages(frameRef, frameUrl, origin, onFocus);
  const blocked = useFrameBlocked(origin);
  // With @shapio/visual the site re-renders itself; without it the frame is simply loaded again.
  const refresh = useCallback(() => {
    const frame = frameRef.current;
    if (!frame || !origin || !frameUrl) {
      return;
    }
    if (messages.ready) {
      frame.contentWindow?.postMessage(REFRESH, origin);
    } else {
      frame.setAttribute('src', frameUrl);
    }
  }, [origin, frameUrl, messages.ready]);
  usePreviewRefresh(saveStatus, frameUrl !== undefined, refresh);

  return {
    available: entryId !== null && list.length > 0,
    open: active,
    toggle: () => {
      setDocumentShown(false);
      setOpen((current) => !(current && (!mobile || !documentShown)));
    },
    close: () => setOpen(false),
    targets: list,
    target,
    chooseTarget: setChosen,
    session,
    siteUrl,
    frameUrl,
    frameRef,
    ready: messages.ready,
    missing: messages.missing,
    onFrameLoad: messages.onFrameLoad,
    blocked,
    refresh,
    documentShown: mobile && documentShown,
    showDocument: () => setDocumentShown(true),
  };
};

export type EntryPreview = ReturnType<typeof useEntryPreview>;
