import type { DraftState } from '@shapio/client';
import { useEffect } from 'react';

/** CONTENT_VERSION_CONFLICT: the code a 409 on save or publish carries, so the same banner shows. */
const EDIT_CONFLICT = 'CONTENT_VERSION_CONFLICT';

export type RemoteChange = Pick<DraftState, 'savedAt' | 'savedBy'>;

type RemoteDraftChangeOptions = {
  /** Every locale's draft as the last heartbeat saw it. */
  drafts: readonly DraftState[];
  /** The locale of the draft this document shows (the entry's own, also for a model without locales). */
  locale: string | undefined;
  /** The draft version this document shows (kept with `versionRef` by every save and publish). */
  shownVersion: number | undefined;
  dirty: boolean;
  /** A save, publish or restore of this tab is under way: its own new version may not be shown yet. */
  busy: boolean;
  conflict: string | undefined;
  onConflict: (code: string) => void;
};

/**
 * Notices a draft that moved on the server past the version this document shows (another tab or person
 * saved it). With no unsaved edits it returns the change, for a quiet "Changed by … Reload" notice; with
 * unsaved edits it raises the conflict banner a save would have raised, so nothing is lost or overwritten.
 */
export const useRemoteDraftChange = ({
  drafts,
  locale,
  shownVersion,
  dirty,
  busy,
  conflict,
  onConflict,
}: RemoteDraftChangeOptions): { remoteChange: RemoteChange | null } => {
  const server = drafts.find((draft) => draft.locale === locale);
  // Only newer counts: this tab's own saves raise the version it shows and never look like someone else's.
  const moved =
    !busy &&
    conflict === undefined &&
    server !== undefined &&
    shownVersion !== undefined &&
    server.version > shownVersion;
  const raise = moved && dirty;
  useEffect(() => {
    if (raise) {
      onConflict(EDIT_CONFLICT);
    }
  }, [raise, onConflict]);
  return { remoteChange: moved && !dirty ? { savedAt: server.savedAt, savedBy: server.savedBy } : null };
};
