import type { MediaFolder } from '@shapio/client';
import { describe, expect, it } from 'vitest';
import { buildFolderTree, descendantIds, flattenFolderTree } from './folderTree';

const folder = (id: string, name: string, parentId: string | null = null): MediaFolder => ({
  id,
  name,
  parentId,
  assetCount: 0,
  version: 1,
  createdAt: '',
  updatedAt: '',
});

const FOLDERS = [
  folder('b', 'Brand'),
  folder('l', 'Logos', 'b'),
  folder('a', 'Archive'),
  folder('i', 'Icons', 'l'),
  folder('o', 'Orphan', 'missing'),
];

describe('folder tree', () => {
  it('nests folders under their parents, sorted by name, orphans at the root', () => {
    const tree = buildFolderTree(FOLDERS);
    expect(tree.map((node) => node.name)).toEqual(['Archive', 'Brand', 'Orphan']);
    expect(flattenFolderTree(tree).map((node) => [node.name, node.depth])).toEqual([
      ['Archive', 0],
      ['Brand', 0],
      ['Logos', 1],
      ['Icons', 2],
      ['Orphan', 0],
    ]);
  });

  it('finds a folder and all its descendants', () => {
    expect([...descendantIds(FOLDERS, 'b')].sort()).toEqual(['b', 'i', 'l']);
    expect([...descendantIds(FOLDERS, 'a')]).toEqual(['a']);
  });
});
