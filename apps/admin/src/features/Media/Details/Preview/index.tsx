import type { MediaAsset } from '@shapio/client';
import { ExternalLink } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { FileIcon } from '../../FileIcon';
import { isImage } from '../../helpers/fileKind';

type PreviewProps = { asset: MediaAsset };

/** The widest ready variant up to 1280 px, else the original. */
const previewImageUrl = (asset: MediaAsset): string =>
  asset.variants.find((variant) => variant.name === 'w1280' && variant.url)?.url ??
  asset.variants.find((variant) => variant.name === 'w640' && variant.url)?.url ??
  asset.url;

/** Images, video and audio play inline; other files show their type and an Open link. */
export const Preview = ({ asset }: PreviewProps) => {
  const { t } = useTranslation();
  if (isImage(asset.mimeType)) {
    return (
      <img
        src={previewImageUrl(asset)}
        alt={asset.alt || t('media.details.previewOf', { name: asset.filename })}
        className="max-h-72 w-full rounded-lg border bg-muted object-contain"
      />
    );
  }
  if (asset.mimeType.startsWith('video/')) {
    return (
      <video
        src={asset.url}
        controls
        preload="metadata"
        className="max-h-72 w-full rounded-lg border bg-muted"
      />
    );
  }
  if (asset.mimeType.startsWith('audio/')) {
    return <audio src={asset.url} controls preload="metadata" className="w-full" />;
  }
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted px-4 py-8">
      <FileIcon mimeType={asset.mimeType} className="size-10 text-muted-foreground" />
      <Button asChild variant="outline" size="sm">
        <a href={asset.url} target="_blank" rel="noopener noreferrer">
          <ExternalLink aria-hidden="true" />
          {t('media.details.openFile')}
        </a>
      </Button>
    </div>
  );
};
