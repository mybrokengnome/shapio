import type { MediaFolder } from '@shapio/client';
import { useState } from 'react';
import { toast } from 'sonner';
import { useDeleteMediaFolder } from '@/api/media';
import { i18next } from '@/app/i18n';
import type { FolderActions } from '../FolderTree/Menu';
import type { FolderEdit } from './useFolderForm';

/**
 * Where focus returns after an inline folder row: the page header's "New folder" button (`data-new-folder`)
 * for a top-level folder, otherwise the folder's actions button (`data-folder-menu` = its ID).
 */
const openerOf = (edit: FolderEdit): HTMLElement | null => {
  const id = edit.mode === 'rename' ? edit.folder.id : edit.parentId;
  const selector = id === null ? '[data-new-folder]' : `[data-folder-menu="${CSS.escape(id)}"]`;
  return document.querySelector<HTMLElement>(selector);
};

/**
 * Create, rename and delete folders: the inline row being edited (create/rename happen in the tree, not a
 * dialog) and the folder whose delete confirmation is open.
 */
export const useFolderActions = (onDeleted: (folder: MediaFolder) => void) => {
  const [editing, setEditing] = useState<FolderEdit | undefined>(undefined);
  const [deletingId, setDeletingId] = useState<string | undefined>(undefined);
  const deleteFolder = useDeleteMediaFolder();
  const actions: FolderActions = {
    onCreate: (parentId) => setEditing({ mode: 'create', parentId }),
    onRename: (folder) => setEditing({ mode: 'rename', folder }),
    deletingId,
    onDeleteOpenChange: (folder, open) => setDeletingId(open ? folder.id : undefined),
    onDelete: (folder) =>
      deleteFolder.mutateAsync(folder.id).then(() => {
        toast.success(i18next.t('media.folders.deleted', { name: folder.name }));
        onDeleted(folder);
      }),
  };
  return {
    actions,
    editing,
    /**
     * Closes the inline row. With `returnFocus`, focus goes back to what opened it (the header button or
     * the folder's actions button) once the tree has re-rendered; not when focus already moved elsewhere.
     */
    stopEditing: (returnFocus: boolean) => {
      const edit = editing;
      setEditing(undefined);
      if (edit && returnFocus) {
        requestAnimationFrame(() => openerOf(edit)?.focus());
      }
    },
  };
};
