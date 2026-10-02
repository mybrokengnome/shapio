import type { MediaAsset } from '@shapio/client';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { StatusChip } from '@/components/StatusChip';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/helpers/cn';
import { fileKindLabel } from '../../helpers/fileKind';
import { formatBytes } from '../../helpers/formatBytes';
import { MEDIA_STATUS_DISPLAY } from '../../helpers/statusDisplay';
import { Thumbnail } from '../../Thumbnail';

type CardProps = {
  asset: MediaAsset;
  selected: boolean;
  selectable: boolean;
  active: boolean;
  /** `shiftKey`: extend the selection to here from the last item toggled. */
  onSelect: (checked: boolean, shiftKey: boolean) => void;
  onOpen: () => void;
};

/**
 * One asset tile: a button that opens its details (shift-click selects instead), and a checkbox for bulk
 * actions. The square thumbnail, then the name and "PNG · 120 kB".
 */
export const Card = ({ asset, selected, selectable, active, onSelect, onOpen }: CardProps) => {
  const { t } = useTranslation();
  const status = MEDIA_STATUS_DISPLAY[asset.status];
  return (
    <li
      className={cn(
        'group relative overflow-hidden rounded-xl border bg-card transition-shadow focus-within:ring-[3px] focus-within:ring-ring/50 hover:border-input',
        (selected || active) && 'border-primary ring-2 ring-primary hover:border-primary',
      )}
    >
      <button
        type="button"
        onClick={(event) => {
          if (event.shiftKey && selectable) {
            onSelect(!selected, true);
            return;
          }
          onOpen();
        }}
        className="flex w-full flex-col text-left outline-none"
        aria-label={t('media.openDetails', { name: asset.filename })}
      >
        <Thumbnail asset={asset} className="aspect-square w-full border-b" />
        <span className="flex min-w-0 flex-col gap-0.5 px-3 py-2.5">
          <span className="truncate text-sm font-medium" title={asset.filename}>
            {asset.filename}
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted-foreground">
            <span className="truncate">
              {fileKindLabel(asset.filename, asset.mimeType)} · {formatBytes(asset.sizeBytes)}
            </span>
            {asset.visibility === 'private' ? (
              <Lock aria-hidden="true" className="size-3.5 shrink-0" />
            ) : null}
          </span>
        </span>
      </button>
      {asset.status === 'ready' ? null : (
        <StatusChip
          tone={status.tone}
          label={t(status.labelKey)}
          size="sm"
          className="pointer-events-none absolute top-2 right-2"
        />
      )}
      {selectable ? (
        <Checkbox
          checked={selected}
          onClick={(event) => {
            if (event.shiftKey) {
              event.preventDefault();
              onSelect(!selected, true);
            }
          }}
          onCheckedChange={(checked) => onSelect(checked === true, false)}
          aria-label={t('media.select', { name: asset.filename })}
          className="absolute top-2 left-2 bg-card"
        />
      ) : null}
    </li>
  );
};
