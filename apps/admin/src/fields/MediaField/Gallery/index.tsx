import { ImagePlus } from 'lucide-react';
import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/helpers/cn';
import { logError } from '@/helpers/reportError';
import { useFieldsEnvironment } from '../../form/context';
import { moveItem } from '../../helpers/values';
import { GalleryTile } from '../GalleryTile';

type GalleryProps = {
  ids: readonly string[];
  labelId: string;
  inputId: string;
  editable: boolean;
  /** More files fit (under the field's `max`). */
  canAdd: boolean;
  onPick: () => void;
  commit: (ids: string[]) => void;
};

/**
 * Several files as a gallery block of the canvas: thumbnails in a grid, a tile to add more from the
 * library, and files dropped onto it uploaded straight in (with `media.write`).
 */
export const Gallery = ({ ids, labelId, inputId, editable, canAdd, onPick, commit }: GalleryProps) => {
  const { t } = useTranslation();
  const { uploadMedia } = useFieldsEnvironment();
  const [dropping, setDropping] = useState(false);
  const [uploading, setUploading] = useState(0);
  const acceptsFiles = editable && canAdd && uploadMedia !== undefined;
  const onDrop = async (event: DragEvent) => {
    setDropping(false);
    const files = [...event.dataTransfer.files];
    if (!acceptsFiles || files.length === 0 || !uploadMedia) {
      return;
    }
    event.preventDefault();
    setUploading((count) => count + files.length);
    const added: string[] = [];
    for (const file of files) {
      try {
        added.push((await uploadMedia(file)).id);
      } catch (error) {
        logError(error, `uploading ${file.name} into a gallery`);
        toast.error(t('entry.upload.failed', { name: file.name }));
      } finally {
        setUploading((count) => count - 1);
      }
    }
    if (added.length > 0) {
      commit([...ids, ...added]);
    }
  };
  return (
    <div
      className={cn('rounded-xl font-sans', dropping && 'ring-[3px] ring-ring/50')}
      onDragOver={(event) => {
        if (acceptsFiles && event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => void onDrop(event)}
    >
      <ul aria-labelledby={labelId} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {ids.map((id, index) => (
          <GalleryTile
            key={id}
            assetId={id}
            index={index}
            count={ids.length}
            editable={editable}
            onMove={(to) => commit(moveItem(ids, index, to))}
            onRemove={() => commit(ids.filter((item) => item !== id))}
          />
        ))}
      </ul>
      {editable && canAdd ? (
        <button
          id={inputId}
          type="button"
          onClick={onPick}
          className={cn(
            'mt-3 flex h-20 w-full items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground outline-none hover:bg-muted/50 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50',
          )}
        >
          <ImagePlus aria-hidden="true" className="size-4" />
          {uploading > 0
            ? t('entry.upload.uploadingCount', { count: uploading })
            : uploadMedia
              ? t('entry.gallery.addOrDrop')
              : t('content.media.add')}
        </button>
      ) : null}
    </div>
  );
};
