import type { Editor, Extensions } from '@tiptap/core';
import { FileHandler } from '@tiptap/extension-file-handler';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { richTextExtensions } from '../extensions';
import { BlockMoveKeys } from './blockMove';
import { CanvasImageView } from './CanvasImageView';
import { SlashCommand, type SlashBridge } from './slashCommand';
import { DROPPABLE_IMAGE_TYPES } from './uploadFiles';
import { UploadPlaceholder } from './uploadPlaceholder';

type CanvasExtensionOptions = {
  placeholder: string;
  uploadingLabel: (name: string) => string;
  slash: SlashBridge;
  /** Absent without `media.write`: then files are not accepted. */
  onFiles?: (editor: Editor, files: File[], pos: number) => void;
};

/**
 * The canvas's editor: the same stored schema as the form editor (`richTextExtensions`), plus behaviour
 * that never reaches the document: `/` menu, ⌥↑↓ block moves, upload placeholders and file drop/paste.
 */
export const canvasExtensions = ({
  placeholder,
  uploadingLabel,
  slash,
  onFiles,
}: CanvasExtensionOptions): Extensions => [
  ...richTextExtensions({ placeholder, imageView: ReactNodeViewRenderer(CanvasImageView) }),
  BlockMoveKeys,
  SlashCommand.configure({ bridge: slash }),
  UploadPlaceholder.configure({ label: uploadingLabel }),
  ...(onFiles
    ? [
        FileHandler.configure({
          allowedMimeTypes: DROPPABLE_IMAGE_TYPES,
          consumePasteEvent: true,
          onDrop: (editor, files, pos) => onFiles(editor, files, pos),
          onPaste: (editor, files) => onFiles(editor, files, editor.state.selection.to),
        }),
      ]
    : []),
];
