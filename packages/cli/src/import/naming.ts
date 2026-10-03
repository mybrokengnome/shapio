import {
  foldApiKey,
  MAX_API_KEY_LENGTH,
  RESERVED_DEFINITION_API_KEYS,
  RESERVED_FIELD_API_KEYS,
  RESERVED_TYPE_NAMES,
  toTypeName,
} from '@shapio/schema';

/** `blog-post`, `Blog post`, `blog_post` → `blogPost`; a leading digit gets an `n` prefix. */
export const toCamelCase = (value: string): string => {
  const words = value.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0);
  const joined = words
    .map((word, index) =>
      index === 0
        ? word.charAt(0).toLowerCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join('');
  const key = /^[0-9]/.test(joined) ? `n${joined}` : joined;
  return (key || 'item').slice(0, MAX_API_KEY_LENGTH);
};

const withSuffix = (key: string, suffix: string) =>
  `${key.slice(0, MAX_API_KEY_LENGTH - suffix.length)}${suffix}`;

/** Makes `candidate` unique within `taken` (case-folded), numbering repeats; records the result in `taken`. */
const claim = (candidate: string, taken: Set<string>): string => {
  let key = candidate;
  for (let n = 2; taken.has(foldApiKey(key)); n += 1) {
    key = withSuffix(candidate, String(n));
  }
  taken.add(foldApiKey(key));
  return key;
};

const RESERVED_FIELDS = new Set(RESERVED_FIELD_API_KEYS.map(foldApiKey));
const RESERVED_DEFINITIONS = new Set(RESERVED_DEFINITION_API_KEYS.map(foldApiKey));
const RESERVED_TYPES = new Set(RESERVED_TYPE_NAMES.map(foldApiKey));

/** A valid, unreserved field API ID (`status` → `statusField`), unique among `taken`. */
export const fieldApiKey = (source: string, taken: Set<string>): string => {
  const key = toCamelCase(source);
  return claim(RESERVED_FIELDS.has(foldApiKey(key)) ? withSuffix(key, 'Field') : key, taken);
};

/** A valid, unreserved model or component API ID, unique among `taken`. */
export const definitionApiKey = (source: string, taken: Set<string>): string => {
  const key = toCamelCase(source);
  const reserved =
    RESERVED_DEFINITIONS.has(foldApiKey(key)) || RESERVED_TYPES.has(foldApiKey(toTypeName(key)));
  return claim(reserved ? withSuffix(key, 'Item') : key, taken);
};

/** Shapio's slug form (`SLUG_PATTERN`): lower-case ASCII words joined by hyphens; percent-encoding decoded. */
export const toSlug = (value: string): string => {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Not percent-encoded text: slugify it as it is.
  }
  return decoded
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200)
    .replace(/-+$/, '');
};

/** A slug unique among `taken`: `hello`, `hello-2`, ...; `fallback` when the value has no usable characters. */
export const uniqueSlug = (value: string, fallback: string, taken: Set<string>): string => {
  const base = toSlug(value) || toSlug(fallback);
  let slug = base;
  for (let n = 2; taken.has(slug); n += 1) {
    slug = `${base}-${n}`;
  }
  taken.add(slug);
  return slug;
};
