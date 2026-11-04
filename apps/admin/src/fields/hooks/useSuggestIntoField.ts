import { useEffect, useRef, useState } from 'react';
import { useSuggestValue } from '@/api/assist';
import { useAssistTarget, type SaveBeforeAssist } from '../form/assistTarget';

/**
 * "Suggest" for one field (`path`, a JSON pointer in API IDs): saves unsaved changes first (the server reads
 * the saved draft), then fills the field with the model's value as an ordinary edit the person reviews and
 * saves. The latest `onChange` is used when the value arrives, so a sibling edited meanwhile (another field
 * of the same component) is kept.
 */
export const useSuggestIntoField = (path: string, onChange: (value: unknown) => void) => {
  const target = useAssistTarget();
  const suggest = useSuggestValue();
  const [preparing, setPreparing] = useState(false);
  const [blocked, setBlocked] = useState<Exclude<SaveBeforeAssist, 'ready'> | null>(null);
  const [truncated, setTruncated] = useState(false);
  const latestOnChange = useRef(onChange);
  useEffect(() => {
    latestOnChange.current = onChange;
  });
  const run = async () => {
    if (!target) {
      return;
    }
    setBlocked(null);
    setTruncated(false);
    suggest.reset();
    setPreparing(true);
    const prepared = await target.saveIfDirty().finally(() => setPreparing(false));
    if (prepared !== 'ready') {
      setBlocked(prepared);
      return;
    }
    suggest.mutate(
      {
        modelKey: target.modelKey,
        entryId: target.entryId,
        fieldPath: path,
        ...(target.locale ? { locale: target.locale } : {}),
      },
      {
        onSuccess: (result) => {
          latestOnChange.current(result.value);
          setTruncated(result.truncated);
        },
      },
    );
  };
  return {
    available: target !== null,
    run: () => void run(),
    pending: preparing || suggest.isPending,
    error: suggest.error,
    blocked,
    truncated,
  };
};
