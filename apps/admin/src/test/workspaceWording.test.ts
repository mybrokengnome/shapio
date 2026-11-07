import { describe, expect, it } from 'vitest';
import en from '@/locales/en/translation.json';
import { WEBSITE_STRING_KEYS } from './websiteStringKeys';

type Tree = { [key: string]: string | Tree };

const flattenEntries = (tree: Tree, prefix = ''): Array<[string, string]> =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : flattenEntries(value, `${prefix}${key}.`),
  );

/** The word as a whole word, so "prerequisite" and "website" never match. */
const SITE_WORD = /\bsites?\b/i;
/** `{{site}}` is an interpolation's name (code), not text anyone reads. */
const INTERPOLATION = /\{\{[^}]*\}\}/g;

const entries = flattenEntries(en);
const sayingSite = entries
  .filter(([, value]) => SITE_WORD.test(value.replace(INTERPOLATION, '')))
  .map(([key]) => key);

describe('workspace wording in translation.json', () => {
  it('says workspace for the Shapio concept: "site" only in website strings', () => {
    const allowed = new Set(WEBSITE_STRING_KEYS);
    expect(sayingSite.filter((key) => !allowed.has(key))).toEqual([]);
  });

  it('has no stale allowlist entries', () => {
    const saying = new Set(sayingSite);
    expect(WEBSITE_STRING_KEYS.filter((key) => !saying.has(key))).toEqual([]);
  });
});
