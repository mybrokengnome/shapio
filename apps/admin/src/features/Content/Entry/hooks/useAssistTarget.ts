import type { ModelDefinition } from '@shapio/schema';
import { createContext, useCallback, useContext, useMemo } from 'react';
import { useFieldsEnvironment } from '@/fields/form/context';
import type { EntryFormStore } from '@/fields/form/store';
import { dirtyKeysOf } from '@/fields/helpers/formValues';
import type { EntryMode } from '../types';
import type { SaveKind, SaveOutcome } from './useEntrySaver';

/**
 * Whether the server's copy is current before an assist reads it (summarize and translate read the saved
 * draft): `ready`, `saveFirst` (unsaved changes on a model without drafts, where saving publishes, so the
 * person saves), or `failed` (the save didn't go through).
 */
export type SaveBeforeAssist = 'ready' | 'saveFirst' | 'failed';

type AssistDocument = { saveIfDirty: () => Promise<SaveBeforeAssist> };

/** Provided by the entry document (Entry/index.tsx) only for an entry whose locale exists (edit mode). */
export const AssistDocumentContext = createContext<AssistDocument | null>(null);

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
  return useMemo(() => (mode.kind === 'edit' ? { saveIfDirty } : null), [mode.kind, saveIfDirty]);
};

export type AssistTarget = {
  modelKey: string;
  entryId: string;
  locale: string | null;
  saveIfDirty: () => Promise<SaveBeforeAssist>;
};

/**
 * What an entry-scoped assist (summarize, translate) acts on: the entry open in the document, in its
 * locale. Null outside an editable, existing entry (a new entry, a locale not started, read-only).
 */
export const useAssistTarget = (): AssistTarget | null => {
  const environment = useFieldsEnvironment();
  const assistDocument = useContext(AssistDocumentContext);
  const { model, entryId, locale, readOnly } = environment;
  return useMemo(
    () =>
      assistDocument && entryId && !readOnly
        ? { modelKey: model.apiKey, entryId, locale, saveIfDirty: assistDocument.saveIfDirty }
        : null,
    [assistDocument, entryId, readOnly, model.apiKey, locale],
  );
};
