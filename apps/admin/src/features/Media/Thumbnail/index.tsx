import type { MediaAsset } from '@shapio/client';
import { cn } from '@/helpers/cn';
import { FileIcon } from '../FileIcon';
import { isImage } from '../helpers/fileKind';

type ThumbnailProps = { asset: MediaAsset; className?: string };

/** The library thumbnail: the `thumbnail` variant once ready, the original for small images and SVGs. */
const thumbnailUrl = (asset: MediaAsset): string | undefined => {
  const variant = asset.variants.find((candidate) => candidate.name === 'thumbnail' && candidate.url);
  if (variant?.url) {
    return variant.url;
  }
  return isImage(asset.mimeType) ? asset.url : undefined;
};

/** Decorative: the asset's name is always shown beside it, so the image has empty alt text. */
export const Thumbnail = ({ asset, className }: ThumbnailProps) => {
  const url = thumbnailUrl(asset);
  return (
    <div className={cn('flex items-center justify-center overflow-hidden bg-muted', className)}>
      {url ? (
        <img src={url} alt="" loading="lazy" decoding="async" className="size-full object-cover" />
      ) : (
        <FileIcon mimeType={asset.mimeType} className="size-8 text-muted-foreground" />
      )}
    </div>
  );
};
