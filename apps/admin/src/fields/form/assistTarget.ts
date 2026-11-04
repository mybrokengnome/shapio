import { createContext, useContext, useMemo } from 'react';
import { useFieldsEnvironment } from './context';

/**
 * Whether the server's copy is current before an assist reads it (suggest and translate read the saved
 * draft): `ready`, `saveFirst` (unsaved changes on a model without drafts, where saving publishes, so the
 * person saves), or `failed` (the save didn't go through).
 */
export type SaveBeforeAssist = 'ready' | 'saveFirst' | 'failed';

/** The entry document an assist can read: which entry it is, and how to save it first. */
export type AssistDocument = { entryId: string; saveIfDirty: () => Promise<SaveBeforeAssist> };

/** Provided by the entry document (Entry/index.tsx) only for an entry whose locale exists (edit mode). */
export const AssistDocumentContext = createContext<AssistDocument | null>(null);

export type AssistTarget = {
  modelKey: string;
  entryId: string;
  locale: string | null;
  saveIfDirty: () => Promise<SaveBeforeAssist>;
};

/**
 * What an entry-scoped assist (suggest, translate) acts on: the entry open in the document, in its locale.
 * Null outside an editable, existing entry (a new entry, a locale not started, read-only), and inside another
 * form on the same page (an inline-create sheet), whose entry isn't the document's.
 */
export const useAssistTarget = (): AssistTarget | null => {
  const environment = useFieldsEnvironment();
  const assistDocument = useContext(AssistDocumentContext);
  const { model, entryId, locale, readOnly } = environment;
  return useMemo(
    () =>
      assistDocument && entryId && entryId === assistDocument.entryId && !readOnly
        ? { modelKey: model.apiKey, entryId, locale, saveIfDirty: assistDocument.saveIfDirty }
        : null,
    [assistDocument, entryId, readOnly, model.apiKey, locale],
  );
};
