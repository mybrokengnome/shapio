import type { FieldProposal } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { fillGroupsOf } from './fillGroups';

const proposal = (entryId: string, locale: string, fieldPath: string): FieldProposal => ({
  key: `entry:${entryId}:${locale}:${fieldPath}`,
  entryId,
  modelKey: 'story',
  entryTitle: `Story ${entryId}`,
  locale,
  fieldPath,
  fieldLabel: fieldPath.slice(1),
  fieldType: 'string',
  proposedValue: 'value',
  entryVersion: 1,
});

describe('fillGroupsOf', () => {
  it('groups by entry locale in the order of the run', () => {
    const groups = fillGroupsOf([
      proposal('a', 'en', '/summary'),
      proposal('b', 'en', '/summary'),
      proposal('a', 'en', '/subtitle'),
      proposal('a', 'fr', '/summary'),
    ]);
    expect(groups.map((group) => [group.key, group.proposals.map((item) => item.fieldPath)])).toEqual([
      ['a:en', ['/summary', '/subtitle']],
      ['b:en', ['/summary']],
      ['a:fr', ['/summary']],
    ]);
    expect(groups[0]).toMatchObject({ entryId: 'a', modelKey: 'story', entryTitle: 'Story a', locale: 'en' });
  });
});
