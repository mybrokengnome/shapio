import { MAX_API_KEY_LENGTH } from '@shapio/schema';

/**
 * Suggests an API key for a label: camelCase ASCII words (`Blog post` → `blogPost`), a leading `_` when the
 * label starts with a digit, at most MAX_API_KEY_LENGTH characters. Validity is still checked by
 * `checkApiKeySyntax`; this only proposes a value the user can edit.
 */
export const deriveApiKey = (label: string): string => {
  const words = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const key = words
    .map((word, index) => {
      if (index > 0) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      // An acronym leading the label reads better fully lower-cased: `SEO title` → `seoTitle`.
      return word === word.toUpperCase() ? word.toLowerCase() : word.charAt(0).toLowerCase() + word.slice(1);
    })
    .join('');
  const prefixed = /^[0-9]/.test(key) ? `_${key}` : key;
  return prefixed.slice(0, MAX_API_KEY_LENGTH);
};
