import type { Editor } from '@tiptap/core';
import type { UploadedMedia } from '@/hooks/useMediaUploader';
import { addUploadPlaceholder, findUploadPlaceholder, removeUploadPlaceholder } from './uploadPlaceholder';

/** Image types the canvas accepts by drop or paste (what the media library makes variants of). */
export const DROPPABLE_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/svg+xml',
];

/**
 * Files dropped or pasted into rich text: a placeholder for each where it landed, the uploads in parallel,
 * then an image node (the new asset's ID and library alt text) where the placeholder has moved to. A failed
 * upload just removes its placeholder and is reported.
 */
export const uploadIntoEditor = (
  editor: Editor,
  files: readonly File[],
  pos: number,
  upload: (file: File) => Promise<UploadedMedia>,
  onFailed: (file: File, error: unknown) => void,
) =>
  Promise.all(
    files.map(async (file) => {
      const id = crypto.randomUUID();
      editor.view.dispatch(addUploadPlaceholder(editor.state.tr, id, pos, file.name));
      try {
        const media = await upload(file);
        if (editor.isDestroyed) {
          return;
        }
        const at = findUploadPlaceholder(editor.state, id);
        editor.view.dispatch(removeUploadPlaceholder(editor.state.tr, id));
        if (at !== undefined) {
          editor
            .chain()
            .insertContentAt(at, { type: 'image', attrs: { mediaId: media.id, alt: media.alt, title: null } })
            .run();
        }
      } catch (error) {
        if (!editor.isDestroyed) {
          editor.view.dispatch(removeUploadPlaceholder(editor.state.tr, id));
        }
        onFailed(file, error);
      }
    }),
  );
