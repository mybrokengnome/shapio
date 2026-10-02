import type { MediaAsset } from '@shapio/client';
import { useTranslation } from 'react-i18next';
import { useRangeSelection } from '../hooks/useRangeSelection';
import { Card } from './Card';

type AssetGridProps = {
  assets: readonly MediaAsset[];
  selected: ReadonlySet<string>;
  selectable: boolean;
  activeId: string | undefined;
  onSelectChange: (id: string, checked: boolean) => void;
  onOpen: (asset: MediaAsset) => void;
};

/** Square tiles that fill the width; shift-click (tile or checkbox) selects a range. */
export const AssetGrid = ({
  assets,
  selected,
  selectable,
  activeId,
  onSelectChange,
  onOpen,
}: AssetGridProps) => {
  const { t } = useTranslation();
  const range = useRangeSelection(
    assets.map((asset) => asset.id),
    onSelectChange,
  );
  return (
    <ul
      aria-label={t('media.assetsLabel', { count: assets.length })}
      className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-4"
    >
      {assets.map((asset) => (
        <Card
          key={asset.id}
          asset={asset}
          selected={selected.has(asset.id)}
          selectable={selectable}
          active={asset.id === activeId}
          onSelect={(checked, shiftKey) => range.select({ id: asset.id, checked, shiftKey })}
          onOpen={() => onOpen(asset)}
        />
      ))}
    </ul>
  );
};
