import type { AdminEntry, MediaAsset, ShapioApiError } from '@shapio/client';
import type { ComponentDefinition, ModelDefinition } from '@shapio/schema';
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useSaveEntry } from '@/api/content';
import type { EntryFormStore } from '@/fields/form/store';
import { contentIssuesOf, isEditConflict } from '@/fields/helpers/apiErrors';
import { buildPatch, dirtyKeysOf, toFormValues } from '@/fields/helpers/formValues';
import { logError, reportError } from '@/helpers/reportError';

export type SaveKind = 'autosave' | 'save';
export type SaveOutcome = 'saved' | 'unchanged' | 'invalid' | 'conflict' | 'failed';
export type SaveState = {
  status: 'idle' | 'saving' | 'saved' | 'failed';
  kind: SaveKind | undefined;
  at: string | undefined;
};

type EntrySaverOptions = {
  model: ModelDefinition;
  components: ReadonlyMap<string, ComponentDefinition>;
  entryId: string;
  locale: string | null;
  store: EntryFormStore;
  /** The draft version last seen; null while this locale has no version yet. */
  versionRef: MutableRefObject<number | null>;
  onSaved: (entry: AdminEntry, kind: SaveKind) => void;
  onConflict: (error: ShapioApiError) => void;
  onAsset: (asset: MediaAsset) => void;
};

/**
 * Saving one locale's draft. Saves run one at a time (an explicit save waits for a running autosave), so
 * every request carries the latest version and nothing races. Only changed fields are sent (the API takes
 * a patch). Autosave moves the draft without a revision and skips `required`; Save creates a revision and
 * validates everything. 422 issues land on the fields; 409 conflicts go to the conflict dialog.
 */
export const useEntrySaver = ({
  model,
  components,
  entryId,
  locale,
  store,
  versionRef,
  onSaved,
  onConflict,
  onAsset,
}: EntrySaverOptions) => {
  const { mutateAsync } = useSaveEntry(model.apiKey);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [state, setState] = useState<SaveState>({ status: 'idle', kind: undefined, at: undefined });
  const latest = useRef({ onSaved, onConflict, onAsset });
  useEffect(() => {
    latest.current = { onSaved, onConflict, onAsset };
  });

  const runSave = useCallback(
    async (kind: SaveKind): Promise<SaveOutcome> => {
      const { values, baseline } = store.getState();
      const keys = dirtyKeysOf(values, baseline);
      if (kind === 'autosave' && keys.length === 0) {
        return 'unchanged';
      }
      if (kind === 'save') {
        store.getState().reveal();
      }
      setState({ status: 'saving', kind, at: undefined });
      try {
        const entry = await mutateAsync({
          id: entryId,
          input: {
            ...(locale ? { locale } : {}),
            expectedVersion: versionRef.current,
            data: buildPatch(values, keys),
            ...(kind === 'autosave' ? { autosave: true } : {}),
          },
        });
        versionRef.current = entry.version;
        store
          .getState()
          .acceptSaved(values, toFormValues(model.fields, entry.data, components, latest.current.onAsset));
        if (kind === 'save') {
          store.getState().setIssues([]);
        }
        latest.current.onSaved(entry, kind);
        setState({ status: 'saved', kind, at: entry.updatedAt });
        return 'saved';
      } catch (error) {
        setState({ status: 'failed', kind, at: undefined });
        const issues = contentIssuesOf(error);
        if (issues.length > 0) {
          store.getState().setIssues(issues);
          store.getState().reveal();
          return 'invalid';
        }
        if (isEditConflict(error)) {
          latest.current.onConflict(error);
          return 'conflict';
        }
        (kind === 'save' ? reportError : logError)(
          error,
          kind === 'save' ? 'saving an entry' : 'autosaving an entry',
        );
        return 'failed';
      }
    },
    [mutateAsync, store, entryId, locale, versionRef, model.fields, components],
  );

  /** Runs `task` after any save in progress, so publish/restore never overlap a save. */
  const exclusive = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(task);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  const save = useCallback((kind: SaveKind) => exclusive(() => runSave(kind)), [exclusive, runSave]);

  return { save, exclusive, state };
};
