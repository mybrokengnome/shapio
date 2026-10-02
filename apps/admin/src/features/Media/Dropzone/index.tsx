import { Upload } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/helpers/cn';

type DropzoneProps = {
  enabled: boolean;
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
};

const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');

/**
 * Drop files anywhere over the library to upload them. A pointer shortcut only: the Upload button is the
 * keyboard and screen-reader path, so the overlay is hidden from assistive technology.
 */
export const Dropzone = ({ enabled, onFiles, children, className }: DropzoneProps) => {
  const { t } = useTranslation();
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  if (!enabled) {
    return <div className={className}>{children}</div>;
  }
  return (
    <div
      className={cn('relative', className)}
      onDragEnter={(event) => {
        if (hasFiles(event)) {
          depth.current += 1;
          setDragging(true);
        }
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) {
          setDragging(false);
        }
      }}
      onDragOver={(event) => {
        if (hasFiles(event)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        const files = [...event.dataTransfer.files];
        if (files.length > 0) {
          onFiles(files);
        }
      }}
    >
      {children}
      {dragging ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary bg-background/90 text-primary"
        >
          <Upload className="size-8" />
          <p className="font-semibold">{t('media.upload.dropHere')}</p>
        </div>
      ) : null}
    </div>
  );
};
