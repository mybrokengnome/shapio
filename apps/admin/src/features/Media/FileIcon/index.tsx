import { File, FileAudio, FileImage, FileText, FileVideo } from 'lucide-react';

type FileIconProps = { mimeType: string; className?: string };

/** An icon for files without a preview. Decorative: the file's name or type is always shown beside it. */
export const FileIcon = ({ mimeType, className }: FileIconProps) => {
  if (mimeType.startsWith('image/')) {
    return <FileImage aria-hidden="true" className={className} />;
  }
  if (mimeType.startsWith('video/')) {
    return <FileVideo aria-hidden="true" className={className} />;
  }
  if (mimeType.startsWith('audio/')) {
    return <FileAudio aria-hidden="true" className={className} />;
  }
  if (mimeType === 'application/pdf' || mimeType.startsWith('text/')) {
    return <FileText aria-hidden="true" className={className} />;
  }
  return <File aria-hidden="true" className={className} />;
};
