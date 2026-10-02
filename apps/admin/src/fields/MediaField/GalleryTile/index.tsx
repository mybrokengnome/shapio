import { ArrowLeft, ArrowRight, ImageOff, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useMediaAsset } from '@/api/media';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Thumbnail } from '@/features/Media/Thumbnail';

type GalleryTileProps = {
  assetId: string;
  index: number;
  count: number;
  editable: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
};

/** One file of a canvas gallery: its thumbnail and name, with move and remove on hover or focus. */
export const GalleryTile = ({ assetId, index, count, editable, onMove, onRemove }: GalleryTileProps) => {
  const { t } = useTranslation();
  const asset = useMediaAsset(assetId);
  const name = asset.data?.filename ?? assetId;
  return (
    <li className="group/tile relative space-y-1.5">
      {asset.data ? (
        <Thumbnail asset={asset.data} className="aspect-square w-full rounded-xl" />
      ) : asset.isPending ? (
        <Skeleton className="aspect-square w-full rounded-xl" />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-xl bg-muted text-muted-foreground">
          <ImageOff aria-hidden="true" className="size-5" />
        </div>
      )}
      <p className="truncate text-meta text-muted-foreground">
        {asset.isError ? t('content.media.missing') : name}
      </p>
      {editable ? (
        <div className="absolute top-2 right-2 flex gap-1 rounded-lg bg-popover p-0.5 opacity-0 shadow-sm transition-opacity group-focus-within/tile:opacity-100 group-hover/tile:opacity-100">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('content.items.moveUp', { item: name, position: index + 1 })}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('content.items.moveDown', { item: name, position: index + 1 })}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t('content.media.remove', { name })}
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ) : null}
    </li>
  );
};
