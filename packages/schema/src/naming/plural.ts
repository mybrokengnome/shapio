import pluralize from 'pluralize';
import { foldApiKey, MAX_API_KEY_LENGTH } from '../validators/apiKey.js';

/** Appended when English has no distinct plural (`news` → `newsItems`, `series` → `seriesItems`). */
export const PLURAL_FALLBACK_SUFFIX = 'Items';

/**
 * Suggests the plural API ID of a collection from its singular one (`article` → `articles`,
 * `category` → `categories`). Only a suggestion for the admin and the value filled into definitions that
 * predate plural API IDs: the plural is stored on the definition and nothing pluralises at request time.
 * Deterministic for a given `pluralize` version, which is pinned exactly for that reason.
 */
export const suggestPlural = (apiKey: string): string => {
  if (apiKey === '') {
    return '';
  }
  const plural = pluralize(apiKey);
  if (plural.length <= MAX_API_KEY_LENGTH && foldApiKey(plural) !== foldApiKey(apiKey)) {
    return plural;
  }
  return `${apiKey.slice(0, MAX_API_KEY_LENGTH - PLURAL_FALLBACK_SUFFIX.length)}${PLURAL_FALLBACK_SUFFIX}`;
};
