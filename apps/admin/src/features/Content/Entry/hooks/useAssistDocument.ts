import type { ModelDefinition } from '@shapio/schema';
import { useCallback, useMemo } from 'react';
import type { AssistDocument, SaveBeforeAssist } from '@/fields/form/assistTarget';
import type { EntryFormStore } from '@/fields/form/store';
import { dirtyKeysOf } from '@/fields/helpers/formValues';
import type { EntryMode } from '../types';
import type { SaveKind, SaveOutcome } from './useEntrySaver';

type AssistDocumentOptions = {
  model: ModelDefinition;
  mode: EntryMode;
  store: EntryFormStore;
  save: (kind: SaveKind) => Promise<SaveOutcome>;
};

/**
 * The entry document's side of the assist target: unsaved changes are saved as a draft (the autosave
 * path: no revision, no `required` check) before an assist reads the entry. Null outside edit mode.
 */
export const useAssistDocument = ({ model, mode, store, save }: AssistDocumentOptions) => {
  const saveIfDirty = useCallback(async (): Promise<SaveBeforeAssist> => {
    const { values, baseline } = store.getState();
    if (dirtyKeysOf(values, baseline).length === 0) {
      return 'ready';
    }
    if (!model.draftAndPublish) {
      return 'saveFirst';
    }
    const outcome = await save('autosave');
    return outcome === 'saved' || outcome === 'unchanged' ? 'ready' : 'failed';
  }, [model.draftAndPublish, store, save]);
  const entryId = mode.kind === 'edit' ? mode.entry.id : null;
  return useMemo<AssistDocument | null>(
    () => (entryId ? { entryId, saveIfDirty } : null),
    [entryId, saveIfDirty],
  );
};
