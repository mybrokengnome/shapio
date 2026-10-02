import type { MediaAsset } from '@shapio/client';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { RowTitle } from '@/components/RowTitle';
import { StatusChip } from '@/components/StatusChip';
import { TableCard } from '@/components/TableCard';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime, formatRelativeTime } from '@/helpers/formatDate';
import { fileKindLabel } from '../helpers/fileKind';
import { formatBytes } from '../helpers/formatBytes';
import { MEDIA_STATUS_DISPLAY } from '../helpers/statusDisplay';
import { useRangeSelection } from '../hooks/useRangeSelection';
import { Thumbnail } from '../Thumbnail';

type AssetTableProps = {
  assets: readonly MediaAsset[];
  selected: ReadonlySet<string>;
  selectable: boolean;
  onSelectChange: (id: string, checked: boolean) => void;
  onOpen: (asset: MediaAsset) => void;
};

/** The list view: name, type, size, status and date per asset; shift-click a checkbox to select a range. */
export const AssetTable = ({ assets, selected, selectable, onSelectChange, onOpen }: AssetTableProps) => {
  const { t } = useTranslation();
  const range = useRangeSelection(
    assets.map((asset) => asset.id),
    onSelectChange,
  );
  return (
    <TableCard>
      <Table>
        <TableHeader>
          <TableRow>
            {selectable ? (
              <TableHead className="w-10">
                <span className="sr-only">{t('media.selection')}</span>
              </TableHead>
            ) : null}
            <TableHead>{t('media.fields.filename')}</TableHead>
            <TableHead>{t('media.fields.type')}</TableHead>
            <TableHead className="text-right">{t('media.fields.size')}</TableHead>
            <TableHead>{t('media.fields.status')}</TableHead>
            <TableHead>{t('media.fields.uploaded')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets.map((asset) => {
            const status = MEDIA_STATUS_DISPLAY[asset.status];
            const isSelected = selected.has(asset.id);
            return (
              <TableRow key={asset.id} data-state={isSelected ? 'selected' : undefined}>
                {selectable ? (
                  <TableCell>
                    <Checkbox
                      checked={isSelected}
                      onClick={(event) => {
                        if (event.shiftKey) {
                          event.preventDefault();
                          range.select({ id: asset.id, checked: !isSelected, shiftKey: true });
                        }
                      }}
                      onCheckedChange={(checked) =>
                        range.select({ id: asset.id, checked: checked === true, shiftKey: false })
                      }
                      aria-label={t('media.select', { name: asset.filename })}
                    />
                  </TableCell>
                ) : null}
                <TableCell className="max-w-96">
                  <span className="flex min-w-0 items-center gap-3">
                    <Thumbnail asset={asset} className="size-8 shrink-0 rounded-md" />
                    <RowTitle asChild className="min-w-0 truncate text-left">
                      <button type="button" onClick={() => onOpen(asset)}>
                        {asset.filename}
                      </button>
                    </RowTitle>
                    {asset.visibility === 'private' ? (
                      <Lock
                        role="img"
                        aria-label={t('media.visibility.private')}
                        className="size-3.5 shrink-0 text-muted-foreground"
                      />
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground" title={asset.mimeType}>
                  {fileKindLabel(asset.filename, asset.mimeType)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatBytes(asset.sizeBytes)}</TableCell>
                <TableCell>
                  <StatusChip tone={status.tone} label={t(status.labelKey)} size="sm" />
                </TableCell>
                <TableCell className="whitespace-nowrap" title={formatDateTime(asset.createdAt)}>
                  {formatRelativeTime(asset.createdAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableCard>
  );
};
