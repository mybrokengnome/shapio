import { useValueFromSource } from '@/hooks/useValueFromSource';
import { deriveApiKey } from '../helpers/deriveApiKey';

/** The API key follows the label until the user types a key of their own (see useValueFromSource). */
export const useApiKeyFromLabel = (
  label: string,
  getApiKey: () => string,
  setApiKey: (apiKey: string) => void,
) => useValueFromSource(label, getApiKey, setApiKey, deriveApiKey);
