import { slugify } from '@/fields/helpers/slugify';

const MAX_KEY_LENGTH = 63;

/**
 * Suggests a site or role key for a name: lower-case words joined by hyphens, starting with a letter, at
 * most 63 characters (`Marketing team` → `marketing-team`). The form still validates it; this only proposes
 * a value the user can edit.
 */
export const deriveKey = (name: string): string =>
  slugify(name)
    .replace(/^[^a-z]+/, '')
    .slice(0, MAX_KEY_LENGTH)
    .replace(/-+$/, '');
