import { describe, expect, it } from 'vitest';
import en from '@/locales/en/translation.json';
import { readSourceFiles } from './sourceFiles';

type Tree = { [key: string]: string | Tree };

const flatten = (tree: Tree, prefix = ''): string[] =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}${key}`] : flatten(value, `${prefix}${key}.`),
  );

/** i18next plural forms (`_one`, `_other`) are used through their base key. */
const baseKey = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, '');

describe('translation.json', () => {
  it('has no empty strings', () => {
    const empty = flatten(en as Tree).filter((key) => {
      const value = key.split('.').reduce<unknown>((node, part) => (node as Tree)[part], en);
      return typeof value === 'string' && value.trim() === '';
    });
    expect(empty).toEqual([]);
  });

  it('has no unused keys', () => {
    const sources = readSourceFiles(['.ts', '.tsx'])
      .map(({ text }) => text)
      .join('\n');
    // Keys used dynamically: built from a known prefix (`nav.${key}`) or looked up by error code.
    const dynamicPrefixes = [
      'nav.',
      'settings.',
      'theme.',
      'appearance.',
      'errors.codes.',
      'audit.actorTypes.',
      'validation.',
      'roles.actions.',
      // Names that come from @shapio/schema at runtime (data types, editors, settings, change kinds...).
      'models.dataTypes.',
      'models.typeGroups.',
      'models.properties.',
      'models.values.',
      'models.editors.',
      'models.issues.',
      'models.steps.',
      'models.changes.',
    ];
    const unused = flatten(en as Tree)
      .map(baseKey)
      .filter((key) => !sources.includes(`'${key}'`) && !sources.includes(`"${key}"`))
      .filter((key) => !dynamicPrefixes.some((prefix) => key.startsWith(prefix)));
    expect([...new Set(unused)]).toEqual([]);
  });
});
