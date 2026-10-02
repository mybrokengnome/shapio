import { zodResolver } from '@hookform/resolvers/zod';
import type { MediaFolder } from '@shapio/client';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { useCreateMediaFolder, useUpdateMediaFolder } from '@/api/media';
import { i18next } from '@/app/i18n';
import { settle } from '@/helpers/settle';
import { requiredText } from '@/helpers/validation';

const MAX_NAME_LENGTH = 255;

const folderSchema = z.object({ name: requiredText().max(MAX_NAME_LENGTH, 'validation.tooLong') });

export type FolderValues = z.infer<typeof folderSchema>;

/** What the inline folder row edits: a new folder (under `parentId`) or the name of `folder`. */
export type FolderEdit =
  { mode: 'create'; parentId: string | null } | { mode: 'rename'; folder: MediaFolder };

/** The inline folder row's form: creates a folder or renames one, then calls `onDone`. */
export const useFolderForm = (edit: FolderEdit, onDone: () => void) => {
  const createFolder = useCreateMediaFolder();
  const updateFolder = useUpdateMediaFolder();
  const initialName = edit.mode === 'rename' ? edit.folder.name : '';
  const form = useForm<FolderValues>({
    resolver: zodResolver(folderSchema),
    defaultValues: { name: initialName },
  });
  const onSubmit = form.handleSubmit(async ({ name }) => {
    const trimmed = name.trim();
    if (edit.mode === 'rename' && trimmed === edit.folder.name) {
      onDone();
      return;
    }
    const result = await settle(
      edit.mode === 'rename'
        ? updateFolder.mutateAsync({
            id: edit.folder.id,
            input: { expectedVersion: edit.folder.version, name: trimmed },
          })
        : createFolder.mutateAsync({ name: trimmed, parentId: edit.parentId }),
    );
    if (result.ok) {
      toast.success(
        i18next.t(edit.mode === 'rename' ? 'media.folders.renamed' : 'media.folders.created', {
          name: trimmed,
        }),
      );
      onDone();
    }
  });
  const mutation = edit.mode === 'rename' ? updateFolder : createFolder;
  return { form, onSubmit, initialName, pending: mutation.isPending, error: mutation.error };
};
