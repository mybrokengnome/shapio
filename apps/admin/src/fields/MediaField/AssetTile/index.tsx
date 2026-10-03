import { ArrowDown, ArrowUp, Layers, Trash2 } from 'lucide-react';
import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isNotFound } from '@/api/errors';
import { useMediaAsset, useUpdateMediaAsset } from '@/api/media';
import { SuggestAltButton } from '@/components/SuggestAltButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Variants } from '@/features/Media/Details/Variants';
import { Thumbnail } from '@/features/Media/Thumbnail';
import { describeError } from '@/helpers/describeError';
import { FieldsEnvironmentContext } from '../../form/context';

type AssetTileProps = {
  assetId: string;
  inputId: string;
  index: number;
  count: number;
  editable: boolean;
  canEditAlt: boolean;
  onMove?: (to: number) => void;
  onRemove: () => void;
};

/** One chosen file: preview, name, alt text (library metadata, editable here), its variants, and actions. */
export const AssetTile = ({
  assetId,
  inputId,
  index,
  count,
  editable,
  canEditAlt,
  onMove,
  onRemove,
}: AssetTileProps) => {
  const { t } = useTranslation();
  const asset = useMediaAsset(assetId);
  const update = useUpdateMediaAsset();
  const [alt, setAlt] = useState<string | undefined>();
  const locale = useContext(FieldsEnvironmentContext)?.locale;
  const name = asset.data?.filename ?? assetId;
  const altId = `${inputId}-alt-${index}`;
  return (
    <li className="flex items-center gap-3 rounded-lg border bg-card p-2">
      {asset.data ? (
        <Thumbnail asset={asset.data} className="size-14 shrink-0 rounded-lg" />
      ) : asset.isPending ? (
        <Skeleton className="size-14 shrink-0 rounded-lg" />
      ) : (
        <div className="size-14 shrink-0 rounded-lg bg-muted" />
      )}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-semibold">{name}</p>
        {asset.isError ? (
          <p className="text-meta text-destructive">
            {isNotFound(asset.error) ? t('content.media.missing') : describeError(asset.error)}
          </p>
        ) : asset.data ? (
          <p className="truncate text-meta text-muted-foreground">
            {asset.data.alt ? t('content.media.altValue', { alt: asset.data.alt }) : t('content.media.noAlt')}
          </p>
        ) : null}
      </div>
      {asset.data ? (
        <Popover onOpenChange={(open) => setAlt(open ? asset.data?.alt : undefined)}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="sm" aria-label={t('content.media.details', { name })}>
              <Layers aria-hidden="true" />
              <span className="hidden sm:inline">{t('content.media.detailsShort')}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-3">
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (asset.data && alt !== undefined) {
                  update.mutate({ id: asset.data.id, input: { expectedVersion: asset.data.version, alt } });
                }
              }}
            >
              <Label htmlFor={altId}>{t('content.media.altLabel')}</Label>
              <Input
                id={altId}
                value={alt ?? ''}
                readOnly={!canEditAlt}
                onChange={(event) => setAlt(event.target.value)}
                aria-describedby={`${altId}-hint`}
              />
              <p id={`${altId}-hint`} className="text-meta text-muted-foreground">
                {t('content.media.altHint')}
              </p>
              {update.isError ? (
                <p className="text-meta text-destructive">{describeError(update.error)}</p>
              ) : null}
              {canEditAlt ? (
                <SuggestAltButton
                  assetId={asset.data.id}
                  mimeType={asset.data.mimeType}
                  locale={locale}
                  onSuggest={setAlt}
                />
              ) : null}
              {canEditAlt ? (
                <Button type="submit" size="sm" disabled={update.isPending || alt === asset.data.alt}>
                  {update.isPending ? t('common.saving') : t('content.media.saveAlt')}
                </Button>
              ) : null}
            </form>
            <div className="space-y-1">
              <p className="text-sm font-semibold">{t('content.media.variants')}</p>
              <Variants asset={asset.data} />
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
      {editable && onMove ? (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('content.items.moveUp', { item: name, position: index + 1 })}
            disabled={index === 0}
            onClick={() => onMove(index - 1)}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t('content.items.moveDown', { item: name, position: index + 1 })}
            disabled={index === count - 1}
            onClick={() => onMove(index + 1)}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
        </>
      ) : null}
      {editable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('content.media.remove', { name })}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      ) : null}
    </li>
  );
};
