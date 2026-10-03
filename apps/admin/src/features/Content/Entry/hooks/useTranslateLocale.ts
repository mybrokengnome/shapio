import type { ModelDefinition } from '@shapio/schema';
import { useState } from 'react';
import { useTranslateEntry } from '@/api/assist';
import { useSaveEntry } from '@/api/content';
import { proposalKey, useAssistProposalsStore } from '@/stores/assistProposals';
import type { SaveBeforeAssist } from './useAssistTarget';

type TranslateLocaleOptions = {
  model: ModelDefinition;
  entryId: string;
  /** Saves the document first when it is the source locale; omit when the source isn't open. */
  prepare?: () => Promise<SaveBeforeAssist>;
  /** Opens the new locale's draft. */
  onOpen: (locale: string) => void;
};

/**
 * "Translate from {locale}": the model translates the source locale's saved draft, the result is saved as
 * the target locale's first draft (nothing publishes), and the document opens it with the proposal banner.
 */
export const useTranslateLocale = ({ model, entryId, prepare, onOpen }: TranslateLocaleOptions) => {
  const translate = useTranslateEntry();
  const saveEntry = useSaveEntry(model.apiKey);
  const propose = useAssistProposalsStore((state) => state.propose);
  const [preparing, setPreparing] = useState(false);
  const [blocked, setBlocked] = useState<Exclude<SaveBeforeAssist, 'ready'> | null>(null);
  const [target, setTarget] = useState<string | null>(null);

  const run = async (from: string, to: string) => {
    setBlocked(null);
    translate.reset();
    saveEntry.reset();
    setTarget(to);
    if (prepare) {
      setPreparing(true);
      const prepared = await prepare().finally(() => setPreparing(false));
      if (prepared !== 'ready') {
        setBlocked(prepared);
        return;
      }
    }
    try {
      const result = await translate.mutateAsync({ modelKey: model.apiKey, entryId, from, to });
      await saveEntry.mutateAsync({
        id: entryId,
        input: { locale: to, expectedVersion: null, data: result.data },
      });
      propose(proposalKey(model.apiKey, entryId, to), { model: result.model, from, issues: result.issues });
      onOpen(to);
    } catch {
      // Shown inline from the mutations' errors (both are silent: no toast, logged by the query client).
    }
  };
  return {
    run: (from: string, to: string) => void run(from, to),
    /** The locale being (or last) translated into. */
    target,
    pending: preparing || translate.isPending || saveEntry.isPending,
    error: translate.error ?? saveEntry.error,
    blocked,
  };
};
