import { useEffect, useRef } from 'react';
import { followPlural } from '../helpers/followPlural';

/**
 * The plural API ID follows the singular API ID until the user types one of their own (same rule as the
 * API ID following the label, see `useApiKeyFromLabel`).
 */
export const usePluralFromApiKey = (
  apiKey: string,
  getPlural: () => string,
  setPlural: (plural: string) => void,
) => {
  const previousApiKey = useRef(apiKey);
  useEffect(() => {
    const current = getPlural();
    const next = followPlural(previousApiKey.current, apiKey, current);
    if (next !== current) {
      setPlural(next);
    }
    previousApiKey.current = apiKey;
  }, [apiKey, getPlural, setPlural]);
};
