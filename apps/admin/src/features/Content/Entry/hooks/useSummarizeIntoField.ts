import type { FieldDefinition } from '@shapio/schema';
import { useState } from 'react';
import { useSummarizeField } from '@/api/assist';
import { useTopLevelValue } from '@/fields/hooks/useTopLevelValue';
import { useAssistTarget, type SaveBeforeAssist } from './useAssistTarget';

/**
 * "Summarize from body" for one property: saves unsaved changes first (the server reads the saved draft),
 * then fills the field with the summary as an ordinary edit the person reviews and saves.
 */
export const useSummarizeIntoField = (field: FieldDefinition) => {
  const target = useAssistTarget();
  const { onChange } = useTopLevelValue(field);
  const summarize = useSummarizeField();
  const [preparing, setPreparing] = useState(false);
  const [blocked, setBlocked] = useState<Exclude<SaveBeforeAssist, 'ready'> | null>(null);
  const [truncated, setTruncated] = useState(false);
  const run = async () => {
    if (!target) {
      return;
    }
    setBlocked(null);
    setTruncated(false);
    summarize.reset();
    setPreparing(true);
    const prepared = await target.saveIfDirty().finally(() => setPreparing(false));
    if (prepared !== 'ready') {
      setBlocked(prepared);
      return;
    }
    summarize.mutate(
      {
        modelKey: target.modelKey,
        entryId: target.entryId,
        fieldApiKey: field.apiKey,
        ...(target.locale ? { locale: target.locale } : {}),
      },
      {
        onSuccess: (result) => {
          onChange(result.text);
          setTruncated(result.truncated);
        },
      },
    );
  };
  return {
    available: target !== null,
    run: () => void run(),
    pending: preparing || summarize.isPending,
    error: summarize.error,
    blocked,
    truncated,
  };
};
