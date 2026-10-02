import { useEffect, useRef } from 'react';
import { deriveApiKey } from '../helpers/deriveApiKey';

/**
 * The API key follows the label until the user types a key of their own: it is replaced only while it is
 * empty or still the key derived from the previous label. (React Hook Form's dirty state cannot tell: it
 * marks the derived key dirty as soon as the label changes again, so typing a label key by key stopped
 * the key after its first letter.)
 */
export const useApiKeyFromLabel = (
  label: string,
  getApiKey: () => string,
  setApiKey: (apiKey: string) => void,
) => {
  const previousLabel = useRef(label);
  useEffect(() => {
    const current = getApiKey();
    if (current === '' || current === deriveApiKey(previousLabel.current)) {
      setApiKey(deriveApiKey(label));
    }
    previousLabel.current = label;
  }, [label, getApiKey, setApiKey]);
};
