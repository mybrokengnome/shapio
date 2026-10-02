import type { MediaFolder } from '@shapio/client';

export type FolderNode = MediaFolder & { children: FolderNode[]; depth: number };

/** Builds the folder tree from the flat list, siblings sorted by name. Orphans (parent missing) go to the root. */
export const buildFolderTree = (folders: readonly MediaFolder[]): FolderNode[] => {
  const byParent = Map.groupBy(folders, (folder) =>
    folder.parentId && folders.some((candidate) => candidate.id === folder.parentId) ? folder.parentId : null,
  );
  const build = (parentId: string | null, depth: number): FolderNode[] =>
    [...(byParent.get(parentId) ?? [])]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((folder) => ({ ...folder, depth, children: build(folder.id, depth + 1) }));
  return build(null, 0);
};

/** Depth-first: every folder with its depth, for pickers that show the tree as an indented list. */
export const flattenFolderTree = (nodes: readonly FolderNode[]): FolderNode[] =>
  nodes.flatMap((node) => [node, ...flattenFolderTree(node.children)]);

/** The folder and everything under it (a folder cannot move into these). */
export const descendantIds = (folders: readonly MediaFolder[], id: string): Set<string> => {
  const result = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId && result.has(folder.parentId) && !result.has(folder.id)) {
        result.add(folder.id);
        grew = true;
      }
    }
  }
  return result;
};
